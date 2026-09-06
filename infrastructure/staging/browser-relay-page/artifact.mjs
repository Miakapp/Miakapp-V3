import { gzipSync } from 'node:zlib';
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'vite';

import {
  BROWSER_RELAY_PAGE_PROFILE_SHA256,
  CONTROL_PLANE_ORIGIN,
  FIREBASE_SDK_VERSION,
  MIAKAPI_BUNDLE_SHA256,
  PAGE_DIRECTORY,
  PAGE_PATH,
  RELAY_A_URL,
  RELAY_B_URL,
  VITE_VERSION,
  canonicalJson,
  sha256,
  validateBrowserRelayPageProfile,
} from './contract.mjs';

const MAXIMUM_FILE_BYTES = 2 * 1024 * 1024;
const FIREBASE_APP_ID = '1:1072737219170:web:5053ca93bf25d7373cd73b';
const ARTIFACT_SCHEMA = 'miakapp.staging-browser-relay-page-artifact/1';
const SHA256 = /^[0-9a-f]{64}$/u;
const JAVASCRIPT_PUBLIC_PATH =
  /^\/__acceptance\/browser-relay\/assets\/browser-relay-[0-9A-Za-z_-]+\.js$/u;

export const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "base-uri 'none'",
  [
    "connect-src 'self'",
    CONTROL_PLANE_ORIGIN,
    RELAY_A_URL,
    RELAY_B_URL,
    'https://identitytoolkit.googleapis.com',
    'https://securetoken.googleapis.com',
    'https://content-firebaseappcheck.googleapis.com',
    'https://www.google.com',
    'https://www.recaptcha.net',
  ].join(' '),
  "form-action 'none'",
  "frame-ancestors 'none'",
  'frame-src https://www.google.com https://recaptcha.google.com https://www.recaptcha.net',
  'img-src data: https://www.google.com https://www.gstatic.com',
  "script-src 'self' https://www.google.com https://www.gstatic.com",
  "style-src 'unsafe-inline'",
  'worker-src blob:',
].join('; ');

export const HOSTING_HEADERS = Object.freeze({
  'Cache-Control': 'no-store, max-age=0',
  'Content-Security-Policy': CONTENT_SECURITY_POLICY,
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
});

function filesBelow(root, directory = root) {
  const output = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink() || lstatSync(path).isSymbolicLink()) {
      throw new Error('Browser-relay page artifact must not contain symbolic links');
    }
    if (entry.isDirectory()) output.push(...filesBelow(root, path));
    else if (entry.isFile()) output.push(relative(root, path));
    else throw new Error('Browser-relay page artifact contains an unsupported entry');
  }
  return output.sort();
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
    || value.appId !== FIREBASE_APP_ID
    || value.authDomain !== 'miakapp-v4-staging.firebaseapp.com'
    || value.messagingSenderId !== '1072737219170'
    || value.projectId !== 'miakapp-v4-staging'
    || value.storageBucket !== 'miakapp-v4-staging.firebasestorage.app') {
    throw new Error('Firebase Web configuration differs from the reviewed staging app');
  }
  return Object.freeze({ ...value });
}

function validateSiteKey(value) {
  if (typeof value !== 'string' || !/^[0-9A-Za-z_-]{20,128}$/u.test(value)) {
    throw new Error('Browser-relay page reCAPTCHA site key is malformed');
  }
  return value;
}

function validateVendoredMiakApi(root) {
  const path = join(root, 'vendor', 'miakapi-browser-v4.mjs');
  const entry = lstatSync(path);
  if (!entry.isFile() || entry.isSymbolicLink()
    || entry.size === 0 || entry.size > 256 * 1024
    || sha256(readFileSync(path)) !== MIAKAPI_BUNDLE_SHA256) {
    throw new Error('Vendored MiakAPI browser bundle has drifted');
  }
}

function contentType(path) {
  if (path === 'index.html') return 'text/html; charset=utf-8';
  if (/^assets\/browser-relay-[0-9A-Za-z_-]+\.js$/u.test(path)) {
    return 'text/javascript; charset=utf-8';
  }
  throw new Error('Browser-relay page build produced an unreviewed file');
}

function writePrivateFile(path, bytes, mode) {
  writeFileSync(path, bytes, { flag: 'wx', mode });
  chmodSync(path, mode);
}

function plainObject(value) {
  return value !== null && !Array.isArray(value) && typeof value === 'object';
}

function exactKeys(value, keys, description) {
  if (!plainObject(value)
    || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
    throw new Error(`${description} must contain exactly the reviewed fields`);
  }
  return value;
}

function boundedInteger(value, minimum, maximum, description) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${description} is outside the reviewed bounds`);
  }
  return value;
}

function validateArtifactMetadata(value) {
  const metadata = exactKeys(value, [
    'schema',
    'profile_sha256',
    'firebase_config_sha256',
    'recaptcha_site_key_sha256',
    'hosting_headers_sha256',
    'file_count',
    'files',
    'total_content_bytes',
    'total_gzip_bytes',
  ], 'Browser-relay page artifact metadata');
  if (metadata.schema !== ARTIFACT_SCHEMA
    || metadata.profile_sha256 !== BROWSER_RELAY_PAGE_PROFILE_SHA256
    || metadata.hosting_headers_sha256
      !== sha256(Buffer.from(canonicalJson(HOSTING_HEADERS), 'utf8'))
    || !SHA256.test(metadata.firebase_config_sha256)
    || !SHA256.test(metadata.recaptcha_site_key_sha256)
    || metadata.file_count !== 2
    || !Array.isArray(metadata.files)
    || metadata.files.length !== 2) {
    throw new Error('Browser-relay page artifact metadata is invalid');
  }
  const files = metadata.files.map((value, index) => {
    const file = exactKeys(value, [
      'path',
      'content_type',
      'content_sha256',
      'content_bytes',
      'gzip_sha256',
      'gzip_bytes',
    ], `Browser-relay page artifact file ${index}`);
    const isHtml = index === 0;
    if ((isHtml && (file.path !== PAGE_PATH
      || file.content_type !== 'text/html; charset=utf-8'))
      || (!isHtml && (!JAVASCRIPT_PUBLIC_PATH.test(file.path)
        || file.content_type !== 'text/javascript; charset=utf-8'))
      || !SHA256.test(file.content_sha256)
      || !SHA256.test(file.gzip_sha256)) {
      throw new Error('Browser-relay page artifact file metadata is invalid');
    }
    boundedInteger(file.content_bytes, 1, MAXIMUM_FILE_BYTES,
      'Browser-relay page content size');
    boundedInteger(file.gzip_bytes, 1, MAXIMUM_FILE_BYTES,
      'Browser-relay page gzip size');
    return file;
  });
  const totalContentBytes = files.reduce((total, file) => total + file.content_bytes, 0);
  const totalGzipBytes = files.reduce((total, file) => total + file.gzip_bytes, 0);
  if (metadata.total_content_bytes !== totalContentBytes
    || metadata.total_gzip_bytes !== totalGzipBytes) {
    throw new Error('Browser-relay page artifact totals are invalid');
  }
  return metadata;
}

export function validateBrowserRelayPageBuildDependencies(packageJson) {
  if (packageJson?.dependencies?.firebase !== FIREBASE_SDK_VERSION
    || packageJson?.devDependencies?.vite !== VITE_VERSION) {
    throw new Error('Browser-relay page build dependencies are not exactly pinned');
  }
  return true;
}

export async function buildBrowserRelayPageArtifact(bundle, firebaseConfigValue, siteKeyValue) {
  const profile = validateBrowserRelayPageProfile();
  const firebaseConfig = validateFirebaseConfig(firebaseConfigValue);
  const siteKey = validateSiteKey(siteKeyValue);
  const root = dirname(fileURLToPath(import.meta.url));
  validateVendoredMiakApi(root);
  validateBrowserRelayPageBuildDependencies(JSON.parse(
    readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'),
  ));
  const outputRoot = join(bundle, 'artifact');
  mkdirSync(outputRoot, { mode: 0o700 });
  await build({
    root,
    publicDir: false,
    configFile: false,
    base: `${PAGE_DIRECTORY}/`,
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
          entryFileNames: 'assets/browser-relay-[hash].js',
          chunkFileNames: 'assets/chunk-[hash].js',
          assetFileNames: 'assets/asset-[hash][extname]',
        },
      },
    },
  });

  const discovered = filesBelow(outputRoot);
  const assetPath = discovered.find((path) => path !== 'index.html');
  if (discovered.length !== 2
    || !discovered.includes('index.html')
    || !/^assets\/browser-relay-[0-9A-Za-z_-]+\.js$/u.test(assetPath ?? '')) {
    throw new Error('Browser-relay page build must contain exactly one HTML and one JavaScript file');
  }

  const uploadRoot = join(bundle, 'uploads');
  mkdirSync(uploadRoot, { mode: 0o700 });
  const files = [];
  for (const relativePath of ['index.html', assetPath]) {
    const rawPath = join(outputRoot, relativePath);
    const raw = readFileSync(rawPath);
    if (raw.byteLength === 0 || raw.byteLength > MAXIMUM_FILE_BYTES) {
      throw new Error('Browser-relay page build file exceeds the reviewed bounds');
    }
    const gzip = gzipSync(raw, { level: 9, mtime: 0 });
    const gzipSha256 = sha256(gzip);
    writePrivateFile(join(uploadRoot, gzipSha256), gzip, 0o400);
    chmodSync(rawPath, 0o400);
    files.push(Object.freeze({
      path: relativePath === 'index.html'
        ? PAGE_PATH
        : `${PAGE_DIRECTORY}/${relativePath}`,
      content_type: contentType(relativePath),
      content_sha256: sha256(raw),
      content_bytes: raw.byteLength,
      gzip_sha256: gzipSha256,
      gzip_bytes: gzip.byteLength,
    }));
  }

  return Object.freeze({
    schema: ARTIFACT_SCHEMA,
    profile_sha256: BROWSER_RELAY_PAGE_PROFILE_SHA256,
    firebase_config_sha256: sha256(Buffer.from(canonicalJson(firebaseConfig), 'utf8')),
    recaptcha_site_key_sha256: sha256(Buffer.from(siteKey, 'utf8')),
    hosting_headers_sha256: sha256(Buffer.from(canonicalJson(HOSTING_HEADERS), 'utf8')),
    file_count: files.length,
    files: Object.freeze(files),
    total_content_bytes: files.reduce((total, file) => total + file.content_bytes, 0),
    total_gzip_bytes: files.reduce((total, file) => total + file.gzip_bytes, 0),
  });
}

function localRelativePath(publicPath) {
  if (publicPath === PAGE_PATH) return 'index.html';
  const prefix = `${PAGE_DIRECTORY}/`;
  if (!publicPath.startsWith(prefix)) throw new Error('Browser-relay page path is invalid');
  const path = publicPath.slice(prefix.length);
  if (!/^assets\/browser-relay-[0-9A-Za-z_-]+\.js$/u.test(path)) {
    throw new Error('Browser-relay page path escapes its artifact root');
  }
  return path;
}

export function readAndVerifyBrowserRelayPageArtifact(bundle, metadata) {
  const validated = validateArtifactMetadata(metadata);
  return Object.freeze(validated.files.map((file) => {
    const relativePath = localRelativePath(file.path);
    const raw = readFileSync(join(bundle, 'artifact', relativePath));
    const gzip = readFileSync(join(bundle, 'uploads', file.gzip_sha256));
    if (raw.byteLength !== file.content_bytes || sha256(raw) !== file.content_sha256
      || gzip.byteLength !== file.gzip_bytes || sha256(gzip) !== file.gzip_sha256) {
      throw new Error('Browser-relay page artifact bytes differ from reviewed metadata');
    }
    return Object.freeze({ ...file, raw, gzip });
  }));
}
