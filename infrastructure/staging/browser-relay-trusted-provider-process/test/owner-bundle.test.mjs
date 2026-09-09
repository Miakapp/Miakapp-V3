import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  StagingBrowserRelayTrustedProviderProcessError,
  TRUSTED_PROVIDER_PROCESS_MAXIMUM_OWNER_BUNDLE_BYTES,
  TRUSTED_PROVIDER_PROCESS_MAXIMUM_OWNER_BUNDLE_FILE_BYTES,
  TRUSTED_PROVIDER_PROCESS_MAXIMUM_OWNER_BUNDLE_FILES,
  TRUSTED_PROVIDER_PROCESS_MAXIMUM_OWNER_BUNDLE_MANIFEST_BYTES,
  TRUSTED_PROVIDER_PROCESS_MAXIMUM_OWNER_BUNDLE_PATH_BYTES,
  TRUSTED_PROVIDER_PROCESS_MAXIMUM_OWNER_BUNDLE_SEGMENT_BYTES,
} from '../contract.mjs';
import {
  TRUSTED_PROVIDER_OWNER_BUNDLE_REVISION,
  TRUSTED_PROVIDER_OWNER_BUNDLE_SCHEMA,
  buildTrustedProviderOwnerBundle,
  materializeTrustedProviderOwnerBundle,
} from '../owner-bundle.mjs';

const TEMPORARY_ROOT = realpathSync.native(tmpdir());
const MAGIC_BYTES = 8;
const HEADER_BYTES = 12;

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function integrityFailure(error) {
  return error instanceof StagingBrowserRelayTrustedProviderProcessError
    && error.code === 'owner_integrity_failed'
    && error.message === 'Trusted provider process failed (owner_integrity_failed)';
}

function temporaryDirectory(t, prefix) {
  const directory = realpathSync.native(mkdtempSync(join(TEMPORARY_ROOT, prefix)));
  chmodSync(directory, 0o700);
  t.after(() => rmSync(directory, { force: true, recursive: true }));
  return directory;
}

function writeArtifact(t, bytes, mode = 0o600) {
  const directory = temporaryDirectory(t, 'miakapp-owner-artifact-');
  const path = join(directory, 'owner.bundle');
  writeFileSync(path, bytes, { mode });
  chmodSync(path, mode);
  return { path, sha256: sha256(bytes) };
}

function workspace(t) {
  return temporaryDirectory(t, 'miakapp-owner-workspace-');
}

function exampleBundle(files = []) {
  return buildTrustedProviderOwnerBundle({
    entry_path: 'owner.mjs',
    files: [
      {
        path: 'owner.mjs',
        bytes: Buffer.from("import { answer } from './lib/answer.mjs'; export { answer };\n"),
      },
      { path: 'lib/answer.mjs', bytes: Buffer.from('export const answer = 42;\n') },
      ...files,
    ],
  });
}

function splitBundle(bytes) {
  const manifestLength = bytes.readUInt32BE(MAGIC_BYTES);
  const manifestBytes = bytes.subarray(HEADER_BYTES, HEADER_BYTES + manifestLength);
  return {
    manifest: JSON.parse(manifestBytes.toString('utf8')),
    payload: bytes.subarray(HEADER_BYTES + manifestLength),
  };
}

function composeBundle(manifest, payload, manifestText = `${JSON.stringify(manifest, null, 2)}\n`) {
  const manifestBytes = Buffer.from(manifestText, 'utf8');
  const header = Buffer.alloc(HEADER_BYTES);
  header.write('MIAKOWN1', 0, 'ascii');
  header.writeUInt32BE(manifestBytes.byteLength, MAGIC_BYTES);
  return Buffer.concat([header, manifestBytes, payload]);
}

test('builds one canonical deterministic dependency-bearing container', () => {
  const first = exampleBundle();
  const second = buildTrustedProviderOwnerBundle({
    files: [
      { path: 'lib/answer.mjs', bytes: Buffer.from('export const answer = 42;\n') },
      {
        path: 'owner.mjs',
        bytes: Buffer.from("import { answer } from './lib/answer.mjs'; export { answer };\n"),
      },
    ],
    entry_path: 'owner.mjs',
  });
  assert.deepEqual(first, second);
  assert.equal(sha256(first), sha256(second));
  const { manifest, payload } = splitBundle(first);
  assert.deepEqual(Object.keys(manifest), ['schema', 'revision', 'entry_path', 'files']);
  assert.equal(manifest.schema, TRUSTED_PROVIDER_OWNER_BUNDLE_SCHEMA);
  assert.equal(manifest.revision, TRUSTED_PROVIDER_OWNER_BUNDLE_REVISION);
  assert.equal(manifest.entry_path, 'owner.mjs');
  assert.deepEqual(manifest.files.map(({ path }) => path), ['lib/answer.mjs', 'owner.mjs']);
  assert.equal(
    manifest.files.reduce((total, file) => total + file.bytes, 0),
    payload.byteLength,
  );
});

test('materializes exact bytes and detaches imports from later container mutation', async (t) => {
  const bytes = exampleBundle();
  const artifact = writeArtifact(t, bytes);
  const ownerWorkspace = workspace(t);
  const materialized = materializeTrustedProviderOwnerBundle({
    owner_bundle_path: artifact.path,
    owner_bundle_sha256: artifact.sha256,
    owner_workspace_path: ownerWorkspace,
  });
  assert.equal(materialized.file_count, 2);
  assert.ok(materialized.payload_bytes > 0);
  writeFileSync(artifact.path, 'changed after verified materialization');
  const ownerModule = await import(materialized.entry_url);
  assert.equal(ownerModule.answer, 42);
  assert.equal(readFileSync(join(ownerWorkspace, 'lib/answer.mjs'), 'utf8'),
    'export const answer = 42;\n');
  assert.equal(lstatSync(ownerWorkspace).mode & 0o777, 0o700);
  assert.equal(lstatSync(join(ownerWorkspace, 'lib')).mode & 0o777, 0o700);
  assert.equal(lstatSync(join(ownerWorkspace, 'owner.mjs')).mode & 0o777, 0o400);
  assert.equal(lstatSync(join(ownerWorkspace, 'lib/answer.mjs')).mode & 0o777, 0o400);
});

test('accepts every published owner-container limit exactly', (t) => {
  const maximumSegment = `${'s'.repeat(251)}.mjs`;
  assert.equal(Buffer.byteLength(maximumSegment, 'utf8'),
    TRUSTED_PROVIDER_PROCESS_MAXIMUM_OWNER_BUNDLE_SEGMENT_BYTES);
  const segmentBundle = buildTrustedProviderOwnerBundle({
    entry_path: maximumSegment,
    files: [{ path: maximumSegment, bytes: Buffer.from('export {};\n') }],
  });
  const segmentArtifact = writeArtifact(t, segmentBundle);
  const segmentWorkspace = workspace(t);
  materializeTrustedProviderOwnerBundle({
    owner_bundle_path: segmentArtifact.path,
    owner_bundle_sha256: segmentArtifact.sha256,
    owner_workspace_path: segmentWorkspace,
  });
  assert.equal(lstatSync(join(segmentWorkspace, maximumSegment)).isFile(), true);

  const maximumPath = `${'a'.repeat(120)}/${'b'.repeat(131)}.bin`;
  assert.equal(Buffer.byteLength(maximumPath, 'utf8'),
    TRUSTED_PROVIDER_PROCESS_MAXIMUM_OWNER_BUNDLE_PATH_BYTES);
  const inventoryBundle = buildTrustedProviderOwnerBundle({
    entry_path: 'owner.mjs',
    files: [
      { path: 'owner.mjs', bytes: Buffer.alloc(0) },
      { path: maximumPath, bytes: Buffer.alloc(0) },
      ...Array.from({ length: TRUSTED_PROVIDER_PROCESS_MAXIMUM_OWNER_BUNDLE_FILES - 2 },
        (_, index) => ({ path: `files/${index}.bin`, bytes: Buffer.alloc(0) })),
    ],
  });
  assert.equal(splitBundle(inventoryBundle).manifest.files.length,
    TRUSTED_PROVIDER_PROCESS_MAXIMUM_OWNER_BUNDLE_FILES);

  const fullFile = Buffer.alloc(TRUSTED_PROVIDER_PROCESS_MAXIMUM_OWNER_BUNDLE_FILE_BYTES);
  let tailFile = Buffer.alloc(
    TRUSTED_PROVIDER_PROCESS_MAXIMUM_OWNER_BUNDLE_FILE_BYTES - 4_096,
  );
  const files = () => [
    { path: 'owner.mjs', bytes: Buffer.alloc(0) },
    { path: 'a.bin', bytes: fullFile },
    { path: 'b.bin', bytes: fullFile },
    { path: 'c.bin', bytes: fullFile },
    { path: 'tail.bin', bytes: tailFile },
  ];
  let maximumBundle = buildTrustedProviderOwnerBundle({
    entry_path: 'owner.mjs',
    files: files(),
  });
  const remaining = TRUSTED_PROVIDER_PROCESS_MAXIMUM_OWNER_BUNDLE_BYTES
    - maximumBundle.byteLength;
  assert.ok(remaining > 0);
  maximumBundle.fill(0);
  tailFile = Buffer.alloc(tailFile.byteLength + remaining);
  assert.ok(tailFile.byteLength <= TRUSTED_PROVIDER_PROCESS_MAXIMUM_OWNER_BUNDLE_FILE_BYTES);
  maximumBundle = buildTrustedProviderOwnerBundle({
    entry_path: 'owner.mjs',
    files: files(),
  });
  assert.equal(maximumBundle.byteLength, TRUSTED_PROVIDER_PROCESS_MAXIMUM_OWNER_BUNDLE_BYTES);

  const artifact = writeArtifact(t, maximumBundle);
  const materialized = materializeTrustedProviderOwnerBundle({
    owner_bundle_path: artifact.path,
    owner_bundle_sha256: artifact.sha256,
    owner_workspace_path: workspace(t),
  });
  assert.equal(materialized.file_count, 5);
  assert.equal(materialized.payload_bytes,
    (3 * TRUSTED_PROVIDER_PROCESS_MAXIMUM_OWNER_BUNDLE_FILE_BYTES) + tailFile.byteLength);
});

test('rejects invalid build inputs and closed inventory collisions', () => {
  const validOwner = { path: 'owner.mjs', bytes: Buffer.from('export {};\n') };
  const maximumFile = Buffer.alloc(TRUSTED_PROVIDER_PROCESS_MAXIMUM_OWNER_BUNDLE_FILE_BYTES);
  for (const input of [
    null,
    new Proxy({ entry_path: 'owner.mjs', files: [validOwner] }, {}),
    { entry_path: 'owner.mjs', files: [new Proxy(validOwner, {})] },
    { entry_path: 'owner.js', files: [validOwner] },
    { entry_path: '../owner.mjs', files: [validOwner] },
    { entry_path: 'owner.mjs', files: [] },
    { entry_path: 'missing.mjs', files: [validOwner] },
    { entry_path: 'owner.mjs', files: [validOwner, { ...validOwner }] },
    {
      entry_path: 'owner.mjs',
      files: [validOwner, { path: 'OWNER.MJS', bytes: Buffer.from('export {};\n') }],
    },
    {
      entry_path: 'owner.mjs',
      files: [validOwner, { path: 'owner.mjs/dependency', bytes: Buffer.alloc(0) }],
    },
    {
      entry_path: 'owner.mjs',
      files: [
        validOwner,
        { path: 'a', bytes: Buffer.alloc(0) },
        { path: 'a-bridge', bytes: Buffer.alloc(0) },
        { path: 'a/x', bytes: Buffer.alloc(0) },
      ],
    },
    {
      entry_path: 'owner.mjs',
      files: [
        validOwner,
        { path: 'A/x', bytes: Buffer.alloc(0) },
        { path: 'a/y', bytes: Buffer.alloc(0) },
      ],
    },
    {
      entry_path: 'owner.mjs',
      files: [
        validOwner,
        { path: `${'s'.repeat(252)}.mjs`, bytes: Buffer.alloc(0) },
      ],
    },
    {
      entry_path: 'owner.mjs',
      files: [validOwner, { path: 'lib\\dependency.mjs', bytes: Buffer.alloc(0) }],
    },
    {
      entry_path: 'owner.mjs',
      files: [validOwner, {
        path: 'large.bin',
        bytes: Buffer.alloc(TRUSTED_PROVIDER_PROCESS_MAXIMUM_OWNER_BUNDLE_FILE_BYTES + 1),
      }],
    },
    {
      entry_path: 'owner.mjs',
      files: Array.from(
        { length: TRUSTED_PROVIDER_PROCESS_MAXIMUM_OWNER_BUNDLE_FILES + 1 },
        (_, index) => ({ path: `${index}.mjs`, bytes: Buffer.alloc(0) }),
      ),
    },
    {
      entry_path: 'owner.mjs',
      files: [
        validOwner,
        ...['a', 'b', 'c', 'd'].map((path) => ({ path, bytes: maximumFile })),
      ],
    },
  ]) assert.throws(() => buildTrustedProviderOwnerBundle(input), integrityFailure);
  maximumFile.fill(0);
});

test('rejects malformed canonical manifests, payloads and outer bounds', (t) => {
  const valid = exampleBundle();
  const { manifest, payload } = splitBundle(valid);
  const cases = [];

  const wrongMagic = Buffer.from(valid);
  wrongMagic[0] ^= 0xff;
  cases.push(wrongMagic);
  cases.push(Buffer.concat([valid, Buffer.from([0])]));
  cases.push(composeBundle(manifest, payload, JSON.stringify(manifest)));

  const reorderedRoot = {
    revision: manifest.revision,
    schema: manifest.schema,
    entry_path: manifest.entry_path,
    files: manifest.files,
  };
  cases.push(composeBundle(reorderedRoot, payload));
  const reorderedFile = structuredClone(manifest);
  reorderedFile.files[0] = {
    bytes: reorderedFile.files[0].bytes,
    path: reorderedFile.files[0].path,
    sha256: reorderedFile.files[0].sha256,
  };
  cases.push(composeBundle(reorderedFile, payload));

  const wrongSchema = structuredClone(manifest);
  wrongSchema.schema = `${wrongSchema.schema}-drift`;
  cases.push(composeBundle(wrongSchema, payload));
  const unsafePath = structuredClone(manifest);
  unsafePath.files[0].path = '../answer.mjs';
  cases.push(composeBundle(unsafePath, payload));
  const unsorted = structuredClone(manifest);
  unsorted.files.reverse();
  cases.push(composeBundle(unsorted, payload));
  const digestDrift = structuredClone(manifest);
  digestDrift.files[0].sha256 = '0'.repeat(64);
  cases.push(composeBundle(digestDrift, payload));
  const payloadDrift = Buffer.from(payload);
  payloadDrift[0] ^= 0xff;
  cases.push(composeBundle(manifest, payloadDrift));

  const excessiveManifest = Buffer.alloc(HEADER_BYTES + 1);
  excessiveManifest.write('MIAKOWN1', 0, 'ascii');
  excessiveManifest.writeUInt32BE(
    TRUSTED_PROVIDER_PROCESS_MAXIMUM_OWNER_BUNDLE_MANIFEST_BYTES + 1,
    MAGIC_BYTES,
  );
  cases.push(excessiveManifest);
  cases.push(Buffer.alloc(TRUSTED_PROVIDER_PROCESS_MAXIMUM_OWNER_BUNDLE_BYTES + 1));

  for (const bytes of cases) {
    const artifact = writeArtifact(t, bytes);
    assert.throws(() => materializeTrustedProviderOwnerBundle({
      owner_bundle_path: artifact.path,
      owner_bundle_sha256: artifact.sha256,
      owner_workspace_path: workspace(t),
    }), integrityFailure);
  }
});

test('rejects linked or executable artifacts and nonempty or linked workspaces', (t) => {
  const bytes = exampleBundle();
  const valid = writeArtifact(t, bytes);
  chmodSync(valid.path, 0o700);
  assert.throws(() => materializeTrustedProviderOwnerBundle({
    owner_bundle_path: valid.path,
    owner_bundle_sha256: valid.sha256,
    owner_workspace_path: workspace(t),
  }), integrityFailure);
  chmodSync(valid.path, 0o600);

  const linkDirectory = temporaryDirectory(t, 'miakapp-owner-links-');
  const artifactLink = join(linkDirectory, 'owner.bundle');
  symlinkSync(valid.path, artifactLink);
  assert.throws(() => materializeTrustedProviderOwnerBundle({
    owner_bundle_path: artifactLink,
    owner_bundle_sha256: valid.sha256,
    owner_workspace_path: workspace(t),
  }), integrityFailure);

  const nonemptyWorkspace = workspace(t);
  writeFileSync(join(nonemptyWorkspace, 'unexpected'), 'unexpected');
  assert.throws(() => materializeTrustedProviderOwnerBundle({
    owner_bundle_path: valid.path,
    owner_bundle_sha256: valid.sha256,
    owner_workspace_path: nonemptyWorkspace,
  }), integrityFailure);

  const realWorkspace = workspace(t);
  const workspaceLink = join(linkDirectory, 'workspace');
  symlinkSync(realWorkspace, workspaceLink, 'dir');
  assert.throws(() => materializeTrustedProviderOwnerBundle({
    owner_bundle_path: valid.path,
    owner_bundle_sha256: valid.sha256,
    owner_workspace_path: workspaceLink,
  }), integrityFailure);
});
