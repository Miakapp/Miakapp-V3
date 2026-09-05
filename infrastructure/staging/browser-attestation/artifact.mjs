import { gzipSync } from 'node:zlib';
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
} from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

import {
  FIREBASE_SDK_VERSION,
  PLAYWRIGHT_VERSION,
  RUNNER_DIRECTORY,
  RUNNER_PATH,
  canonicalJson,
  readPrivateFile,
  sha256,
  writePrivateFile,
} from './contract.mjs';

const MAXIMUM_FILE_BYTES = 1024 * 1024;

function filesBelow(root, directory = root) {
  const output = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink() || lstatSync(path).isSymbolicLink()) {
      throw new Error('Browser-attestation artifact must not contain symbolic links');
    }
    if (entry.isDirectory()) output.push(...filesBelow(root, path));
    else if (entry.isFile()) output.push(relative(root, path));
    else throw new Error('Browser-attestation artifact contains an unsupported entry');
  }
  return output.sort();
}

function contentType(path) {
  if (path === 'index.html') return 'text/html; charset=utf-8';
  if (/^assets\/attestation-[0-9A-Za-z_-]+\.js$/u.test(path)) {
    return 'text/javascript; charset=utf-8';
  }
  throw new Error('Browser-attestation build produced an unreviewed file');
}

function validateFirebaseConfig(value) {
  const keys = Object.keys(value ?? {}).sort();
  if (JSON.stringify(keys) !== JSON.stringify([
    'apiKey',
    'appId',
    'authDomain',
    'messagingSenderId',
    'projectId',
    'storageBucket',
  ])
    || typeof value.apiKey !== 'string' || !/^AIza[0-9A-Za-z_-]{30,}$/u.test(value.apiKey)
    || value.appId !== '1:1072737219170:web:5053ca93bf25d7373cd73b'
    || value.authDomain !== 'miakapp-v4-staging.firebaseapp.com'
    || value.messagingSenderId !== '1072737219170'
    || value.projectId !== 'miakapp-v4-staging'
    || value.storageBucket !== 'miakapp-v4-staging.firebasestorage.app') {
    throw new Error('Firebase Web configuration differs from the reviewed staging app');
  }
  return Object.freeze({ ...value });
}

export async function buildAttestationArtifact(bundle, firebaseConfigValue, siteKey) {
  const firebaseConfig = validateFirebaseConfig(firebaseConfigValue);
  if (typeof siteKey !== 'string' || !/^[0-9A-Za-z_-]{20,128}$/u.test(siteKey)) {
    throw new Error('Browser-attestation site key is malformed');
  }
  const root = dirname(fileURLToPath(import.meta.url));
  const outputRoot = join(bundle, 'artifact');
  mkdirSync(outputRoot, { mode: 0o700 });
  await build({
    root,
    publicDir: false,
    configFile: false,
    base: `${RUNNER_DIRECTORY}/`,
    logLevel: 'silent',
    define: {
      __MIAKAPP_FIREBASE_CONFIG__: JSON.stringify(firebaseConfig),
      __MIAKAPP_RECAPTCHA_SITE_KEY__: JSON.stringify(siteKey),
    },
    build: {
      target: 'es2022',
      outDir: outputRoot,
      emptyOutDir: true,
      copyPublicDir: false,
      cssCodeSplit: false,
      minify: 'oxc',
      sourcemap: false,
      reportCompressedSize: false,
      rollupOptions: {
        input: join(root, 'index.html'),
        output: {
          entryFileNames: 'assets/attestation-[hash].js',
          chunkFileNames: 'assets/chunk-[hash].js',
          assetFileNames: 'assets/asset-[hash][extname]',
        },
      },
    },
  });

  const discoveredFiles = filesBelow(outputRoot);
  const assetPath = discoveredFiles.find((path) => path !== 'index.html');
  if (discoveredFiles.length !== 2
    || !discoveredFiles.includes('index.html')
    || !/^assets\/attestation-[0-9A-Za-z_-]+\.js$/u.test(assetPath ?? '')) {
    throw new Error('Browser-attestation build must contain exactly one HTML and one JavaScript file');
  }
  const relativeFiles = ['index.html', assetPath];

  const uploadRoot = join(bundle, 'uploads');
  mkdirSync(uploadRoot, { mode: 0o700 });
  const files = [];
  for (const relativePath of relativeFiles) {
    const rawPath = join(outputRoot, relativePath);
    const raw = readFileSync(rawPath);
    if (raw.byteLength === 0 || raw.byteLength > MAXIMUM_FILE_BYTES) {
      throw new Error('Browser-attestation build file exceeds the reviewed bounds');
    }
    const gzip = gzipSync(raw, { level: 9, mtime: 0 });
    const gzipSha256 = sha256(gzip);
    writePrivateFile(join(uploadRoot, gzipSha256), gzip, 0o400);
    chmodSync(rawPath, 0o400);
    files.push(Object.freeze({
      path: relativePath === 'index.html'
        ? RUNNER_PATH
        : `${RUNNER_DIRECTORY}/${relativePath}`,
      content_type: contentType(relativePath),
      content_sha256: sha256(raw),
      content_bytes: raw.byteLength,
      gzip_sha256: gzipSha256,
      gzip_bytes: gzip.byteLength,
    }));
  }

  return Object.freeze({
    firebase_config_sha256: sha256(Buffer.from(canonicalJson(firebaseConfig), 'utf8')),
    artifact: Object.freeze({
      file_count: files.length,
      files: Object.freeze(files),
      total_content_bytes: files.reduce((total, file) => total + file.content_bytes, 0),
      total_gzip_bytes: files.reduce((total, file) => total + file.gzip_bytes, 0),
    }),
  });
}

function localRelativePath(publicPath) {
  if (publicPath === RUNNER_PATH) return 'index.html';
  const prefix = `${RUNNER_DIRECTORY}/`;
  if (!publicPath.startsWith(prefix)) throw new Error('Browser-attestation public path is invalid');
  const path = publicPath.slice(prefix.length);
  if (path.includes('..') || path.startsWith('/') || path.includes(`.${sep}`)) {
    throw new Error('Browser-attestation public path escapes its artifact root');
  }
  return path;
}

export function readAndVerifyArtifact(bundle, metadata) {
  const entries = [];
  for (const file of metadata.artifact.files) {
    const relativePath = localRelativePath(file.path);
    const raw = readPrivateFile(join(bundle, 'artifact', relativePath), MAXIMUM_FILE_BYTES);
    const gzip = readPrivateFile(join(bundle, 'uploads', file.gzip_sha256), MAXIMUM_FILE_BYTES);
    if (raw.byteLength !== file.content_bytes || sha256(raw) !== file.content_sha256
      || gzip.byteLength !== file.gzip_bytes || sha256(gzip) !== file.gzip_sha256) {
      throw new Error('Browser-attestation artifact bytes differ from the reviewed metadata');
    }
    entries.push(Object.freeze({ ...file, raw, gzip }));
  }
  return Object.freeze(entries);
}

export function validatePinnedPackageVersions(packageJson) {
  if (packageJson?.dependencies?.firebase !== FIREBASE_SDK_VERSION
    || packageJson?.devDependencies?.playwright !== PLAYWRIGHT_VERSION) {
    throw new Error('Browser-attestation dependencies are not exactly pinned');
  }
}
