import { createHash } from 'node:crypto';
import {
  lstatSync,
  readFileSync,
  realpathSync,
} from 'node:fs';
import { join, posix, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildTrustedProviderOwnerBundle,
} from '../browser-relay-trusted-provider-process/owner-bundle.mjs';
import {
  rejectTrustedProviderOwner,
} from './contract.mjs';

const REPOSITORY_ROOT = realpathSync.native(fileURLToPath(new URL('../../../', import.meta.url)));
const PLAYWRIGHT_ROOT = realpathSync.native(join(
  REPOSITORY_ROOT,
  'node_modules/playwright-core',
));
const ENTRY_PATH = 'infrastructure/staging/browser-relay-trusted-provider-owner/entry.mjs';
const OWNER_PACKAGE = 'infrastructure/staging/browser-relay-trusted-provider-owner';
const MODULE_ALLOWLIST_PATH = `${OWNER_PACKAGE}/module-allowlist.json`;
const MODULE_ALLOWLIST_SCHEMA =
  'miakapp.browser-relay-trusted-provider-owner-module-allowlist/1';
const CODE_EXTENSIONS = new Set(['.cjs', '.js', '.mjs']);
const DEPENDENCY_MODULE_EXTENSIONS = new Set(['.cjs', '.js', '.json', '.mjs', '.node']);
const PLAYWRIGHT_RUNTIME_FILES = Object.freeze([
  'LICENSE',
  'NOTICE',
  'ThirdPartyNotices.txt',
  'browsers.json',
  'index.js',
  'index.mjs',
  'lib/bootstrap.js',
  'lib/coreBundle.js',
  'lib/utilsBundle.js',
  'lib/utilsBundle.js.LICENSE',
  'package.json',
  'types/protocol.d.ts',
  'types/types.d.ts',
]);
const IMPORT_PATTERN = /(?:\bfrom\s*|\bimport\s*)(['"])([^'"\n]+)\1/gu;
const DYNAMIC_IMPORT_PATTERN = /\bimport\s*\(\s*(['"])([^'"\n]+)\1\s*\)/gu;
const URL_PATTERN = /new\s+URL\s*\(\s*(['"])([^'"\n]+)\1\s*,\s*import\.meta\.url\s*,?\s*\)/gu;
const LOCAL_VALIDATION_ASSETS = Object.freeze(['guard.mjs', 'testing.mjs']);
const EXPLICIT_VALIDATION_ASSETS = Object.freeze([
  'infrastructure/staging/browser-relay-edge/README.md',
  'infrastructure/staging/browser-relay-edge/cloud.mjs',
  'infrastructure/staging/browser-relay-services/.terraform.lock.hcl',
  'infrastructure/staging/browser-relay-services/bootstrap-failure-v1.json',
  'infrastructure/staging/browser-relay-services/foundation.tf',
  'infrastructure/staging/browser-relay-services/locals.tf',
  'infrastructure/staging/browser-relay-services/main.tf',
  'infrastructure/staging/browser-relay-services/memory-recovery-failure-v1.json',
  'infrastructure/staging/browser-relay-services/outputs.tf',
  'infrastructure/staging/browser-relay-services/private-ready-result-v1.json',
  'infrastructure/staging/browser-relay-services/profile-v3.json',
  'infrastructure/staging/browser-relay-services/profile-v4.json',
  'infrastructure/staging/browser-relay-services/profile-v5.json',
  'infrastructure/staging/browser-relay-services/profile.json',
  'infrastructure/staging/browser-relay-services/providers.tf',
  'infrastructure/staging/browser-relay-services/terraform-cli.tfrc',
  'infrastructure/staging/browser-relay-services/variables.tf',
  'infrastructure/staging/browser-relay-services/versions.tf',
]);
const PARENT_ONLY_FILES = new Set([
  '.github/workflows/browser-relay-trusted-provider-owner.yml',
  `${OWNER_PACKAGE}/guard.mjs`,
  `${OWNER_PACKAGE}/testing.mjs`,
  'infrastructure/staging/test/browser-relay-trusted-provider-owner.test.mjs',
  'infrastructure/staging/test/browser-relay-trusted-provider-owner-bundle.test.mjs',
  'infrastructure/staging/test/browser-relay-trusted-provider-owner-browser.mjs',
]);

function reject() {
  return rejectTrustedProviderOwner();
}

function extension(path) {
  const index = path.lastIndexOf('.');
  return index < 0 ? '' : path.slice(index);
}

function repositoryPath(relativePath) {
  const output = resolve(REPOSITORY_ROOT, ...relativePath.split('/'));
  if (output !== REPOSITORY_ROOT && !output.startsWith(`${REPOSITORY_ROOT}${sep}`)) reject();
  return output;
}

function regularBytes(relativePath) {
  const path = repositoryPath(relativePath);
  let canonical;
  let entry;
  try {
    canonical = realpathSync.native(path);
    entry = lstatSync(path);
  } catch {
    return reject();
  }
  if (canonical !== path || !entry.isFile() || entry.isSymbolicLink()
    || entry.size < 1 || entry.size > 8 * 1024 * 1024) reject();
  return readFileSync(path);
}

function resolveRelative(importer, specifier) {
  if (!specifier.startsWith('.')) reject();
  return resolveContained(importer, specifier);
}

function resolveContained(importer, specifier) {
  if (specifier.startsWith('/') || specifier.includes(':') || specifier.includes('\\')) reject();
  const output = posix.normalize(posix.join(posix.dirname(importer), specifier));
  if (output === '..' || output.startsWith('../') || output.startsWith('/')) reject();
  return output;
}

function collectRepositoryGraph() {
  const files = new Map();
  const parsed = new Set();
  const modules = new Set([ENTRY_PATH]);
  const queue = [ENTRY_PATH];

  const addData = (relativePath) => {
    if (PARENT_ONLY_FILES.has(relativePath) || files.has(relativePath)) return;
    files.set(relativePath, regularBytes(relativePath));
  };
  const addCode = (relativePath) => {
    if (!CODE_EXTENSIONS.has(extension(relativePath))) reject();
    modules.add(relativePath);
    addData(relativePath);
    if (!parsed.has(relativePath)) queue.push(relativePath);
  };

  while (queue.length > 0) {
    const importer = queue.shift();
    if (parsed.has(importer)) continue;
    parsed.add(importer);
    addData(importer);
    const source = files.get(importer).toString('utf8');
    for (const pattern of [IMPORT_PATTERN, DYNAMIC_IMPORT_PATTERN]) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(source)) !== null) {
        const specifier = match[2];
        if (specifier.startsWith('node:')) continue;
        if (specifier === 'playwright-core' || specifier.startsWith('playwright-core/')) {
          continue;
        }
        addCode(resolveRelative(importer, specifier));
      }
    }
    URL_PATTERN.lastIndex = 0;
    let match;
    while ((match = URL_PATTERN.exec(source)) !== null) {
      const candidate = resolveContained(importer, match[2]);
      if (candidate === 'node_modules/playwright-core'
        || candidate.startsWith('node_modules/playwright-core/')) continue;
      let entry;
      try { entry = lstatSync(repositoryPath(candidate)); } catch { continue; }
      if (entry.isFile() && !entry.isSymbolicLink()) addData(candidate);
    }
    for (const name of LOCAL_VALIDATION_ASSETS) {
      if (!source.includes(`'${name}'`) && !source.includes(`"${name}"`)) continue;
      const candidate = resolveContained(importer, name);
      let entry;
      try { entry = lstatSync(repositoryPath(candidate)); } catch { continue; }
      if (entry.isFile() && !entry.isSymbolicLink()) addData(candidate);
    }
  }
  for (const required of [
    `${OWNER_PACKAGE}/profile.json`,
    `${OWNER_PACKAGE}/contract.mjs`,
    `${OWNER_PACKAGE}/internal.mjs`,
    `${OWNER_PACKAGE}/source-truth.mjs`,
    `${OWNER_PACKAGE}/operation.mjs`,
    `${OWNER_PACKAGE}/page-host.mjs`,
    `${OWNER_PACKAGE}/browser.mjs`,
    `${OWNER_PACKAGE}/owner.mjs`,
  ]) {
    if (!files.has(required)) reject();
  }
  for (const path of EXPLICIT_VALIDATION_ASSETS) addData(path);
  for (const forbidden of [
    `${OWNER_PACKAGE}/testing.mjs`,
    `${OWNER_PACKAGE}/bundle.mjs`,
    `${OWNER_PACKAGE}/guard.mjs`,
  ]) {
    if (files.has(forbidden)) reject();
  }
  return { files, modules };
}

function collectPlaywrightRuntime(files, modules) {
  for (const relativePath of PLAYWRIGHT_RUNTIME_FILES) {
    const path = `node_modules/playwright-core/${relativePath}`;
    if (files.has(path)) reject();
    files.set(path, regularBytes(path));
    if (DEPENDENCY_MODULE_EXTENSIONS.has(extension(path))) modules.add(path);
  }
}

function inventorySha256(files) {
  const hash = createHash('sha256');
  for (const [path, bytes] of [...files.entries()].sort(([left], [right]) => (
    left < right ? -1 : left > right ? 1 : 0
  ))) {
    hash.update(path);
    hash.update('\0');
    hash.update(createHash('sha256').update(bytes).digest('hex'));
    hash.update('\0');
  }
  return hash.digest('hex');
}

export function buildBrowserRelayTrustedProviderOwnerBundle() {
  if (arguments.length !== 0) reject();
  if (relative(REPOSITORY_ROOT, PLAYWRIGHT_ROOT)
    !== 'node_modules/playwright-core') reject();
  const packageMetadata = JSON.parse(
    readFileSync(join(PLAYWRIGHT_ROOT, 'package.json'), 'utf8'),
  );
  if (packageMetadata.name !== 'playwright-core' || packageMetadata.version !== '1.62.1') {
    reject();
  }
  const { files, modules } = collectRepositoryGraph();
  const repositoryFileCount = files.size;
  collectPlaywrightRuntime(files, modules);
  const playwrightFileCount = files.size - repositoryFileCount;
  if (files.has(MODULE_ALLOWLIST_PATH)) reject();
  files.set(MODULE_ALLOWLIST_PATH, Buffer.from(`${JSON.stringify({
    schema: MODULE_ALLOWLIST_SCHEMA,
    modules: [...modules].sort(),
  }, null, 2)}\n`, 'utf8'));
  const ordered = [...files.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([path, bytes]) => ({ path, bytes }));
  const bytes = buildTrustedProviderOwnerBundle({
    entry_path: ENTRY_PATH,
    files: ordered,
  });
  return Object.freeze({
    bytes,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    entry_path: ENTRY_PATH,
    file_count: ordered.length,
    repository_file_count: repositoryFileCount,
    playwright_file_count: playwrightFileCount,
    module_file_count: modules.size,
    payload_bytes: ordered.reduce((total, file) => total + file.bytes.byteLength, 0),
    inventory_sha256: inventorySha256(files),
  });
}
