import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  utimesSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'acorn';

const deploymentRoot = dirname(fileURLToPath(import.meta.url));
const controlPlaneRoot = realpathSync(resolve(deploymentRoot, '..'));
const repositoryRoot = realpathSync(resolve(controlPlaneRoot, '..'));
const builtRoot = join(controlPlaneRoot, 'lib');
const entrypoint = 'production-entrypoint.js';
const canonicalDate = new Date('1980-01-01T00:00:00.000Z');
const maximumArchiveBytes = 8 * 1024 * 1024;

function reject(message) {
  throw new Error(message);
}

function regularFile(path, description) {
  const entry = lstatSync(path);
  if (!entry.isFile() || entry.isSymbolicLink()) reject(`${description} must be a regular file`);
  return entry;
}

function safeEnvironment() {
  const environment = {};
  for (const name of ['HOME', 'LANG', 'LC_ALL', 'LC_CTYPE', 'PATH', 'TMPDIR']) {
    if (typeof process.env[name] === 'string' && process.env[name].length !== 0) {
      environment[name] = process.env[name];
    }
  }
  environment.CI = '1';
  return environment;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? controlPlaneRoot,
    env: options.env ?? safeEnvironment(),
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0 || result.signal !== null || result.error !== undefined) {
    reject(`${options.description ?? command} failed`);
  }
  return result.stdout;
}

function compile() {
  const version = run('bun', ['--version'], { description: 'Bun version check' }).trim();
  if (version !== '1.2.23') reject('Bun 1.2.23 is required to package the control plane');
  run('bun', ['run', 'build'], { description: 'Control-plane compilation' });
}

function localModuleSpecifiers(source, path) {
  let ast;
  try {
    ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
  } catch {
    return reject(`Compiled module ${path} is not valid ECMAScript`);
  }
  const specifiers = [];
  for (const statement of ast.body) {
    if (statement.type === 'ImportDeclaration'
      || statement.type === 'ExportAllDeclaration'
      || (statement.type === 'ExportNamedDeclaration' && statement.source !== null)) {
      const specifier = statement.source?.value;
      if (typeof specifier !== 'string') reject(`Compiled module ${path} has an invalid import`);
      if (specifier.startsWith('.')) specifiers.push(specifier);
    }
  }
  if (/\bimport\s*\(/u.test(source)) reject(`Compiled module ${path} must not use dynamic imports`);
  return specifiers;
}

export function productionModuleFiles() {
  const pending = [entrypoint];
  const visited = new Set();
  while (pending.length > 0) {
    const name = pending.pop();
    if (name === undefined || visited.has(name)) continue;
    if (!/^[a-z0-9-]+\.js$/u.test(name)) reject('Production module name is outside the closed build shape');
    const path = join(builtRoot, name);
    regularFile(path, `Compiled module ${name}`);
    visited.add(name);
    const source = readFileSync(path, 'utf8');
    for (const specifier of localModuleSpecifiers(source, name)) {
      const resolved = resolve(dirname(path), specifier);
      if (!resolved.startsWith(`${builtRoot}${sep}`) || !resolved.endsWith('.js')) {
        reject(`Compiled module ${name} escapes the production build root`);
      }
      const dependency = relative(builtRoot, resolved);
      if (!visited.has(dependency)) pending.push(dependency);
    }
  }
  for (const forbidden of ['config.js', 'index.js', 'staging-runtime-document-cli.js']) {
    if (visited.has(forbidden)) reject(`Emulator-only module ${forbidden} reached the production package`);
  }
  return Object.freeze([...visited].sort());
}

function validateManifest() {
  const packagePath = join(deploymentRoot, 'package.json');
  const lockPath = join(deploymentRoot, 'package-lock.json');
  regularFile(packagePath, 'Production package manifest');
  regularFile(lockPath, 'Production package lock');
  const manifest = JSON.parse(readFileSync(packagePath, 'utf8'));
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
  if (manifest.name !== '@miakapp/control-plane-production'
    || manifest.private !== true
    || manifest.type !== 'module'
    || manifest.main !== `lib/${entrypoint}`
    || manifest.engines?.node !== '22'
    || Object.keys(manifest).some((key) => ![
      'name', 'version', 'private', 'type', 'main', 'engines', 'dependencies',
    ].includes(key))
    || lock.lockfileVersion !== 3
    || lock.packages?.['']?.name !== manifest.name
    || lock.packages?.['']?.version !== manifest.version
    || JSON.stringify(lock.packages?.['']?.dependencies) !== JSON.stringify(manifest.dependencies)
    || lock.packages?.['']?.devDependencies !== undefined) {
    reject('Production package manifest and lock do not match the closed deployment shape');
  }
  return Object.freeze({ packagePath, lockPath });
}

function archiveTarget(path) {
  if (!isAbsolute(path)) reject('Production archive path must be absolute');
  const parent = realpathSync(dirname(path));
  if (parent === repositoryRoot || parent.startsWith(`${repositoryRoot}${sep}`)) {
    reject('Production archive must remain outside the repository');
  }
  if (existsSync(path)) reject('Production archive path must not already exist');
  return join(parent, path.slice(dirname(path).length + 1));
}

export function buildProductionArchive(outputPath, options = {}) {
  process.umask(0o077);
  if (options.compile !== false) compile();
  const target = archiveTarget(outputPath);
  const { packagePath, lockPath } = validateManifest();
  const modules = productionModuleFiles();
  const staging = mkdtempSync(join(tmpdir(), 'miakapp-control-plane-package-'));
  try {
    mkdirSync(join(staging, 'lib'), { mode: 0o700 });
    const files = ['package.json', 'package-lock.json', ...modules.map((name) => `lib/${name}`)];
    copyFileSync(packagePath, join(staging, 'package.json'));
    copyFileSync(lockPath, join(staging, 'package-lock.json'));
    for (const name of modules) copyFileSync(join(builtRoot, name), join(staging, 'lib', name));
    for (const name of files) {
      const path = join(staging, name);
      chmodSync(path, 0o600);
      utimesSync(path, canonicalDate, canonicalDate);
    }
    run('zip', ['-X', '-q', '-9', target, ...files], {
      cwd: staging,
      env: { ...safeEnvironment(), TZ: 'UTC' },
      description: 'Deterministic production archive creation',
    });
    const entry = regularFile(target, 'Production archive');
    if (entry.size === 0 || entry.size > maximumArchiveBytes) {
      return reject('Production archive has an invalid size');
    }
    const sha256 = createHash('sha256').update(readFileSync(target)).digest('hex');
    return Object.freeze({
      schema: 'miakapp.control-plane-package/1',
      archive_path: target,
      archive_sha256: sha256,
      archive_bytes: statSync(target).size,
      entrypoint: 'controlPlane',
      module: `lib/${entrypoint}`,
      files: Object.freeze(files),
    });
  } finally {
    rmSync(staging, { force: true, recursive: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3 || process.argv[2] === undefined) {
    console.error('Usage: node deployment/package.mjs /absolute/private/control-plane.zip');
    process.exitCode = 2;
  } else {
    try {
      const result = buildProductionArchive(process.argv[2]);
      process.stdout.write(`${JSON.stringify(result)}\n`);
    } catch (error) {
      console.error(error instanceof Error ? error.message : 'Production packaging failed');
      process.exitCode = 1;
    }
  }
}
