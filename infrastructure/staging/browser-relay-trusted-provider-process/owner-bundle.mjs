import { createHash } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  constants as fsConstants,
  fchmodSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  readdirSync,
  realpathSync,
  writeSync,
} from 'node:fs';
import { isAbsolute, join, posix, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual, types } from 'node:util';

import {
  TRUSTED_PROVIDER_PROCESS_MAXIMUM_OWNER_BUNDLE_BYTES,
  TRUSTED_PROVIDER_PROCESS_MAXIMUM_OWNER_BUNDLE_FILE_BYTES,
  TRUSTED_PROVIDER_PROCESS_MAXIMUM_OWNER_BUNDLE_FILES,
  TRUSTED_PROVIDER_PROCESS_MAXIMUM_OWNER_BUNDLE_MANIFEST_BYTES,
  TRUSTED_PROVIDER_PROCESS_MAXIMUM_OWNER_BUNDLE_PATH_BYTES,
  TRUSTED_PROVIDER_PROCESS_MAXIMUM_OWNER_BUNDLE_SEGMENT_BYTES,
  rejectTrustedProviderProcess,
} from './contract.mjs';

export const TRUSTED_PROVIDER_OWNER_BUNDLE_SCHEMA =
  'miakapp.staging-browser-relay-trusted-provider-owner-bundle/1';
export const TRUSTED_PROVIDER_OWNER_BUNDLE_REVISION = 1;

const MAGIC = Buffer.from('MIAKOWN1', 'ascii');
const HEADER_BYTES = MAGIC.byteLength + 4;
const SHA256 = /^[0-9a-f]{64}$/u;
const SAFE_SEGMENT = /^[A-Za-z0-9@._+-]+$/u;
const CONTROL_OR_SURROGATE = /[\p{Cc}\p{Cs}]/u;
const INTRINSIC_IS_PROXY = types.isProxy;

function rejectIntegrity() {
  rejectTrustedProviderProcess('owner_integrity_failed');
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function plainObject(value) {
  try {
    if (value === null || Array.isArray(value) || typeof value !== 'object'
      || INTRINSIC_IS_PROXY(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function exactKeys(value, expected, ordered = false) {
  if (!plainObject(value)) rejectIntegrity();
  let ownKeys;
  let descriptors;
  try {
    ownKeys = Reflect.ownKeys(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    return rejectIntegrity();
  }
  if (ownKeys.some((key) => typeof key !== 'string')
    || !isDeepStrictEqual(ordered ? ownKeys : [...ownKeys].sort(),
      ordered ? expected : [...expected].sort())) {
    rejectIntegrity();
  }
  const snapshot = {};
  for (const key of expected) {
    const descriptor = descriptors[key];
    if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')
      || descriptor.enumerable !== true) rejectIntegrity();
    snapshot[key] = descriptor.value;
  }
  return snapshot;
}

function comparePaths(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function validateRelativePath(value, entry = false) {
  if (typeof value !== 'string' || value.length < 1
    || Buffer.byteLength(value, 'utf8') > TRUSTED_PROVIDER_PROCESS_MAXIMUM_OWNER_BUNDLE_PATH_BYTES
    || CONTROL_OR_SURROGATE.test(value) || value.includes('\\') || value.startsWith('/')
    || posix.normalize(value) !== value) rejectIntegrity();
  const segments = value.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..'
    || Buffer.byteLength(segment, 'utf8') >
      TRUSTED_PROVIDER_PROCESS_MAXIMUM_OWNER_BUNDLE_SEGMENT_BYTES
    || !SAFE_SEGMENT.test(segment))) rejectIntegrity();
  if (entry && !value.endsWith('.mjs')) rejectIntegrity();
  return value;
}

function validateOrderedPaths(paths) {
  const inventory = new Map();
  for (let index = 0; index < paths.length; index += 1) {
    const path = paths[index];
    if (index > 0 && comparePaths(paths[index - 1], path) >= 0) rejectIntegrity();
    const segments = path.split('/');
    for (let length = 1; length <= segments.length; length += 1) {
      const nodePath = segments.slice(0, length).join('/');
      const kind = length === segments.length ? 'file' : 'directory';
      const foldedPath = nodePath.toLowerCase();
      const existing = inventory.get(foldedPath);
      if (existing !== undefined
        && (existing.path !== nodePath || existing.kind !== kind)) rejectIntegrity();
      inventory.set(foldedPath, { path: nodePath, kind });
    }
  }
}

function canonicalManifest(manifest) {
  const text = `${JSON.stringify(manifest, null, 2)}\n`;
  const bytes = Buffer.from(text, 'utf8');
  if (bytes.byteLength > TRUSTED_PROVIDER_PROCESS_MAXIMUM_OWNER_BUNDLE_MANIFEST_BYTES) {
    rejectIntegrity();
  }
  return bytes;
}

export function buildTrustedProviderOwnerBundle(value) {
  const files = [];
  try {
    const input = exactKeys(value, ['entry_path', 'files']);
    const entryPath = validateRelativePath(input.entry_path, true);
    if (!Array.isArray(input.files) || INTRINSIC_IS_PROXY(input.files)
      || input.files.length < 1
      || input.files.length > TRUSTED_PROVIDER_PROCESS_MAXIMUM_OWNER_BUNDLE_FILES) {
      rejectIntegrity();
    }
    let payloadBytes = 0;
    for (const candidate of input.files) {
      const file = exactKeys(candidate, ['path', 'bytes']);
      const path = validateRelativePath(file.path);
      if (!Buffer.isBuffer(file.bytes) || INTRINSIC_IS_PROXY(file.bytes)) rejectIntegrity();
      const byteLength = file.bytes.byteLength;
      if (byteLength > TRUSTED_PROVIDER_PROCESS_MAXIMUM_OWNER_BUNDLE_FILE_BYTES
        || byteLength > TRUSTED_PROVIDER_PROCESS_MAXIMUM_OWNER_BUNDLE_BYTES
          - HEADER_BYTES - payloadBytes) rejectIntegrity();
      payloadBytes += byteLength;
      files.push(Object.freeze({ path, bytes: Buffer.from(file.bytes) }));
    }
    files.sort((left, right) => comparePaths(left.path, right.path));
    validateOrderedPaths(files.map(({ path }) => path));
    if (!files.some(({ path }) => path === entryPath)) rejectIntegrity();

    const manifest = {
      schema: TRUSTED_PROVIDER_OWNER_BUNDLE_SCHEMA,
      revision: TRUSTED_PROVIDER_OWNER_BUNDLE_REVISION,
      entry_path: entryPath,
      files: files.map((file) => ({
        path: file.path,
        bytes: file.bytes.byteLength,
        sha256: sha256(file.bytes),
      })),
    };
    const manifestBytes = canonicalManifest(manifest);
    const totalBytes = HEADER_BYTES + manifestBytes.byteLength + payloadBytes;
    if (totalBytes > TRUSTED_PROVIDER_PROCESS_MAXIMUM_OWNER_BUNDLE_BYTES) rejectIntegrity();
    const output = Buffer.allocUnsafe(totalBytes);
    MAGIC.copy(output, 0);
    output.writeUInt32BE(manifestBytes.byteLength, MAGIC.byteLength);
    manifestBytes.copy(output, HEADER_BYTES);
    let offset = HEADER_BYTES + manifestBytes.byteLength;
    for (const file of files) {
      file.bytes.copy(output, offset);
      offset += file.bytes.byteLength;
    }
    return output;
  } catch {
    rejectIntegrity();
  } finally {
    for (const file of files) file.bytes.fill(0);
  }
}

function readOwnerBundle(path, expectedSha256) {
  if (typeof fsConstants.O_NOFOLLOW !== 'number') rejectIntegrity();
  let descriptor;
  try {
    if (realpathSync.native(path) !== path) rejectIntegrity();
    descriptor = openSync(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const entry = fstatSync(descriptor);
    if (!entry.isFile() || (entry.mode & 0o111) !== 0 || entry.size < HEADER_BYTES + 2
      || entry.size > TRUSTED_PROVIDER_PROCESS_MAXIMUM_OWNER_BUNDLE_BYTES) {
      rejectIntegrity();
    }
    const bytes = Buffer.allocUnsafe(entry.size);
    let offset = 0;
    while (offset < bytes.byteLength) {
      const read = readSync(descriptor, bytes, offset, bytes.byteLength - offset, offset);
      if (read < 1) rejectIntegrity();
      offset += read;
    }
    if (fstatSync(descriptor).size !== entry.size || sha256(bytes) !== expectedSha256) {
      bytes.fill(0);
      rejectIntegrity();
    }
    return bytes;
  } catch {
    rejectIntegrity();
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function decodeOwnerBundle(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.byteLength < HEADER_BYTES + 2
    || bytes.byteLength > TRUSTED_PROVIDER_PROCESS_MAXIMUM_OWNER_BUNDLE_BYTES
    || !bytes.subarray(0, MAGIC.byteLength).equals(MAGIC)) rejectIntegrity();
  const manifestLength = bytes.readUInt32BE(MAGIC.byteLength);
  const payloadOffset = HEADER_BYTES + manifestLength;
  if (manifestLength < 2
    || manifestLength > TRUSTED_PROVIDER_PROCESS_MAXIMUM_OWNER_BUNDLE_MANIFEST_BYTES
    || payloadOffset > bytes.byteLength) rejectIntegrity();
  let manifestText;
  let manifest;
  try {
    manifestText = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
      .decode(bytes.subarray(HEADER_BYTES, payloadOffset));
    manifest = JSON.parse(manifestText);
  } catch {
    rejectIntegrity();
  }
  const root = exactKeys(
    manifest,
    ['schema', 'revision', 'entry_path', 'files'],
    true,
  );
  if (root.schema !== TRUSTED_PROVIDER_OWNER_BUNDLE_SCHEMA
    || root.revision !== TRUSTED_PROVIDER_OWNER_BUNDLE_REVISION) rejectIntegrity();
  const entryPath = validateRelativePath(root.entry_path, true);
  if (!Array.isArray(root.files) || root.files.length < 1
    || root.files.length > TRUSTED_PROVIDER_PROCESS_MAXIMUM_OWNER_BUNDLE_FILES) {
    rejectIntegrity();
  }
  const files = root.files.map((candidate) => {
    const file = exactKeys(candidate, ['path', 'bytes', 'sha256'], true);
    const path = validateRelativePath(file.path);
    if (!Number.isSafeInteger(file.bytes) || file.bytes < 0
      || file.bytes > TRUSTED_PROVIDER_PROCESS_MAXIMUM_OWNER_BUNDLE_FILE_BYTES
      || typeof file.sha256 !== 'string' || !SHA256.test(file.sha256)) {
      rejectIntegrity();
    }
    return Object.freeze({ path, bytes: file.bytes, sha256: file.sha256 });
  });
  validateOrderedPaths(files.map(({ path }) => path));
  if (!files.some(({ path }) => path === entryPath)
    || canonicalManifest(manifest).toString('utf8') !== manifestText) rejectIntegrity();

  let offset = payloadOffset;
  const decoded = files.map((file) => {
    const end = offset + file.bytes;
    if (end > bytes.byteLength) rejectIntegrity();
    const payload = bytes.subarray(offset, end);
    offset = end;
    if (sha256(payload) !== file.sha256) rejectIntegrity();
    return Object.freeze({ path: file.path, bytes: payload });
  });
  if (offset !== bytes.byteLength) rejectIntegrity();
  return Object.freeze({ entry_path: entryPath, files: Object.freeze(decoded) });
}

function validateWorkspace(path) {
  if (typeof path !== 'string' || !isAbsolute(path) || resolve(path) !== path
    || realpathSync.native(path) !== path) rejectIntegrity();
  const entry = lstatSync(path);
  if (!entry.isDirectory() || entry.isSymbolicLink() || (entry.mode & 0o077) !== 0
    || (entry.mode & 0o700) !== 0o700 || readdirSync(path).length !== 0) rejectIntegrity();
  return path;
}

function containedPath(workspace, relativePath) {
  const output = join(workspace, ...relativePath.split('/'));
  if (!output.startsWith(`${workspace}${sep}`) || resolve(output) !== output) rejectIntegrity();
  return output;
}

function materializeFile(path, bytes) {
  let descriptor;
  try {
    descriptor = openSync(
      path,
      fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_RDWR | fsConstants.O_NOFOLLOW,
      0o400,
    );
    let offset = 0;
    while (offset < bytes.byteLength) {
      const written = writeSync(descriptor, bytes, offset, bytes.byteLength - offset, offset);
      if (written < 1) rejectIntegrity();
      offset += written;
    }
    const entry = fstatSync(descriptor);
    if (!entry.isFile() || entry.size !== bytes.byteLength) rejectIntegrity();
    const verification = Buffer.allocUnsafe(bytes.byteLength);
    offset = 0;
    while (offset < verification.byteLength) {
      const read = readSync(
        descriptor,
        verification,
        offset,
        verification.byteLength - offset,
        offset,
      );
      if (read < 1) rejectIntegrity();
      offset += read;
    }
    const matches = sha256(verification) === sha256(bytes);
    verification.fill(0);
    if (!matches) rejectIntegrity();
    fchmodSync(descriptor, 0o400);
  } catch {
    rejectIntegrity();
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
  const entry = lstatSync(path);
  if (!entry.isFile() || entry.isSymbolicLink() || (entry.mode & 0o177) !== 0
    || realpathSync.native(path) !== path) rejectIntegrity();
}

export function materializeTrustedProviderOwnerBundle(value) {
  const input = exactKeys(value, [
    'owner_bundle_path',
    'owner_bundle_sha256',
    'owner_workspace_path',
  ]);
  const workspace = validateWorkspace(input.owner_workspace_path);
  const bytes = readOwnerBundle(input.owner_bundle_path, input.owner_bundle_sha256);
  try {
    const bundle = decodeOwnerBundle(bytes);
    const directories = new Set();
    for (const file of bundle.files) {
      const segments = file.path.split('/');
      for (let length = 1; length < segments.length; length += 1) {
        directories.add(segments.slice(0, length).join('/'));
      }
    }
    for (const directory of [...directories].sort((left, right) => {
      const depthDifference = left.split('/').length - right.split('/').length;
      return depthDifference || comparePaths(left, right);
    })) {
      const path = containedPath(workspace, directory);
      mkdirSync(path, { mode: 0o700 });
      chmodSync(path, 0o700);
      const entry = lstatSync(path);
      if (!entry.isDirectory() || entry.isSymbolicLink() || realpathSync.native(path) !== path) {
        rejectIntegrity();
      }
    }
    for (const file of bundle.files) {
      materializeFile(containedPath(workspace, file.path), file.bytes);
    }
    const entryPath = containedPath(workspace, bundle.entry_path);
    return Object.freeze({
      entry_url: pathToFileURL(entryPath).href,
      file_count: bundle.files.length,
      payload_bytes: bundle.files.reduce((total, file) => total + file.bytes.byteLength, 0),
    });
  } catch {
    rejectIntegrity();
  } finally {
    bytes.fill(0);
  }
}
