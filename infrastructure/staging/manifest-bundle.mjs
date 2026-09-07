import { createHash } from 'node:crypto';
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readdirSync,
  readSync,
  realpathSync,
} from 'node:fs';
import {
  basename,
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from 'node:path';

const BUNDLE_SCHEMA = 'miakapp.staging-manifest-bundle/1';
const BUNDLE_REVISION = 1;
const FRAGMENT_SCHEMA = 'miakapp.staging-manifest-fragment/1';
const MAXIMUM_INDEX_BYTES = 16 * 1024;
const MAXIMUM_FRAGMENT_BYTES = 96 * 1024;
const MAXIMUM_BUNDLE_BYTES = 192 * 1024;
const SHA256 = /^[a-f0-9]{64}$/u;

const CORE_KEYS = Object.freeze([
  'schema',
  'revision',
  'status',
  'environment',
  'project',
  'bootstrap',
  'locations',
  'services',
  'runtime',
  'data',
  'security',
  'cost',
  'readiness',
  'teardown',
]);

const PLATFORM_EVIDENCE_PREFIX_KEYS = Object.freeze([
  'manifest_check_command',
  'local_gate_command',
  'terraform_check_command',
  'bootstrap_plan_script',
  'live_plan_script',
  'automation_blueprint',
  'github_policy',
  'github_policy_observation_verified',
  'credential_free_validation',
  'manual_live_plan_requires_user_adc',
  'historical_ci_plan_used_keyless_oidc',
  'persistent_ci_credentials_allowed',
  'active_plan_workflow_present',
  'active_apply_workflow_present',
  'recovery_workflow_retired',
  'staging_wif_providers_disabled',
  'foundation_container_analysis_adoption',
  'activation_material',
  'workload_deployment',
  'private_probe',
  'firebase_auth_baseline',
  'user_relay_probe',
]);

const PLATFORM_EVIDENCE_SUFFIX_KEYS = Object.freeze([
  'retired_recovery_workflow',
  'staging_rows',
  'fault_matrix',
  'production_security_boundary',
  'production_composition_boundary',
  'environment_decision',
]);

const PLATFORM_EVIDENCE_KEYS = Object.freeze([
  ...PLATFORM_EVIDENCE_PREFIX_KEYS,
  ...PLATFORM_EVIDENCE_SUFFIX_KEYS,
]);

const BROWSER_RELAY_EVIDENCE_KEYS = Object.freeze([
  'browser_relay_plan',
  'browser_relay_runner',
  'browser_relay_page',
  'browser_relay_fixture',
  'browser_relay_fixture_cloud',
  'browser_relay_fixture_miakapi',
  'browser_relay_aggregator',
  'browser_relay_independent_observers',
  'browser_relay_playwright_bridge',
  'browser_relay_page_receipt',
  'browser_relay_scenario_fixture',
  'browser_relay_scenario_fixture_cloud',
  'browser_relay_monitoring',
  'browser_relay_rollback',
  'browser_relay_orchestrator',
  'browser_relay_operation',
  'browser_relay_image',
  'browser_app_check_prerequisite',
  'browser_app_check_attestation',
  'signing_key_overlap_prerequisite',
]);

const EVIDENCE_KEY_ORDER = Object.freeze([
  ...PLATFORM_EVIDENCE_PREFIX_KEYS,
  ...BROWSER_RELAY_EVIDENCE_KEYS,
  ...PLATFORM_EVIDENCE_SUFFIX_KEYS,
]);

const FRAGMENT_SPECS = Object.freeze([
  Object.freeze({
    id: 'core',
    path: 'manifest/core.json',
    mount: 'manifest',
    keys: CORE_KEYS,
  }),
  Object.freeze({
    id: 'terraform',
    path: 'manifest/terraform.json',
    mount: 'manifest',
    keys: Object.freeze(['terraform']),
  }),
  Object.freeze({
    id: 'evidence-platform',
    path: 'manifest/evidence-platform.json',
    mount: 'evidence',
    keys: PLATFORM_EVIDENCE_KEYS,
  }),
  Object.freeze({
    id: 'evidence-browser-relay',
    path: 'manifest/evidence-browser-relay.json',
    mount: 'evidence',
    keys: BROWSER_RELAY_EVIDENCE_KEYS,
  }),
]);

const INDEX_KEYS = Object.freeze([
  'schema',
  'bundle_revision',
  'manifest_schema',
  'manifest_revision',
  'fragments',
]);
const INDEX_ENTRY_KEYS = Object.freeze([
  'id',
  'path',
  'mount',
  'size_bytes',
  'sha256',
]);
const FRAGMENT_KEYS = Object.freeze([
  'schema',
  'bundle_revision',
  'id',
  'mount',
  'values',
]);

export class StagingManifestBundleError extends Error {
  constructor(message) {
    super(message);
    this.name = 'StagingManifestBundleError';
  }
}

function reject(message) {
  throw new StagingManifestBundleError(message);
}

function exact(value, expected, description) {
  if (value !== expected) reject(`${description} has drifted`);
}

function orderedRecord(value, keys, description) {
  if (value === null || Array.isArray(value) || typeof value !== 'object'
    || Object.getPrototypeOf(value) !== Object.prototype) {
    return reject(`${description} must be an object`);
  }
  const actualKeys = Object.keys(value);
  if (actualKeys.length !== keys.length
    || actualKeys.some((key, index) => key !== keys[index])) {
    return reject(`${description} fields or field order have drifted`);
  }
  return value;
}

function fileMetadata(path, description) {
  try {
    return lstatSync(path, { bigint: true });
  } catch {
    return reject(`${description} is missing`);
  }
}

function sameStableMetadata(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.mode === right.mode
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs;
}

function readBoundedRegularFile(path, maximumBytes, description) {
  const linkMetadata = fileMetadata(path, description);
  if (linkMetadata.isSymbolicLink() || !linkMetadata.isFile()) {
    return reject(`${description} must be a regular non-symlink file`);
  }
  if ((linkMetadata.mode & 0o111n) !== 0n) {
    return reject(`${description} must not be executable`);
  }

  let descriptor;
  try {
    descriptor = openSync(
      path,
      constants.O_RDONLY
        | (constants.O_NOFOLLOW ?? 0)
        | (constants.O_NONBLOCK ?? 0),
    );
    const before = fstatSync(descriptor, { bigint: true });
    if (!before.isFile() || (before.mode & 0o111n) !== 0n
      || !sameStableMetadata(before, linkMetadata)) {
      return reject(`${description} changed before it could be read`);
    }
    if (before.size <= 0n || before.size > BigInt(maximumBytes)) {
      return reject(`${description} exceeds ${maximumBytes} bytes or is empty`);
    }

    const chunks = [];
    let total = 0;
    while (total <= maximumBytes) {
      const capacity = Math.min(64 * 1024, (maximumBytes + 1) - total);
      const chunk = Buffer.allocUnsafe(capacity);
      const count = readSync(descriptor, chunk, 0, capacity, null);
      if (count === 0) break;
      chunks.push(chunk.subarray(0, count));
      total += count;
    }
    if (total > maximumBytes) reject(`${description} exceeds ${maximumBytes} bytes`);

    const after = fstatSync(descriptor, { bigint: true });
    if (!after.isFile() || (after.mode & 0o111n) !== 0n
      || !sameStableMetadata(after, before) || BigInt(total) !== before.size) {
      return reject(`${description} changed while it was read`);
    }
    return Buffer.concat(chunks, total);
  } catch (error) {
    if (error instanceof StagingManifestBundleError) throw error;
    return reject(`${description} could not be read safely`);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function parseCanonicalJson(bytes, description) {
  let text;
  let value;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    value = JSON.parse(text);
  } catch {
    return reject(`${description} is not valid UTF-8 JSON`);
  }
  const canonical = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
  if (!bytes.equals(canonical)) reject(`${description} is not canonical two-space JSON`);
  return value;
}

function readCanonicalJson(path, maximumBytes, description) {
  const bytes = readBoundedRegularFile(path, maximumBytes, description);
  return Object.freeze({
    bytes,
    value: parseCanonicalJson(bytes, description),
  });
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function containedPath(root, candidate) {
  const path = relative(root, candidate);
  return path !== '' && path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

function fragmentInventory(fragmentDirectory) {
  const expected = FRAGMENT_SPECS.map(({ path }) => basename(path)).sort();
  let actual;
  try {
    actual = readdirSync(fragmentDirectory).sort();
  } catch {
    return reject('Staging manifest fragment directory could not be inventoried');
  }
  if (actual.length !== expected.length
    || actual.some((name, index) => name !== expected[index])) {
    return reject('Staging manifest fragment inventory has drifted');
  }
}

function assertFragmentDirectoryStable(directory) {
  const pathMetadata = fileMetadata(directory.path, 'Staging manifest fragment directory');
  let descriptorMetadata;
  let realPath;
  try {
    descriptorMetadata = fstatSync(directory.descriptor, { bigint: true });
    realPath = realpathSync(directory.path);
  } catch {
    return reject('Staging manifest fragment directory changed while it was read');
  }
  if (pathMetadata.isSymbolicLink() || !pathMetadata.isDirectory()
    || !descriptorMetadata.isDirectory()
    || !sameStableMetadata(pathMetadata, directory.metadata)
    || !sameStableMetadata(descriptorMetadata, directory.metadata)
    || realPath !== directory.realPath) {
    return reject('Staging manifest fragment directory changed while it was read');
  }
  fragmentInventory(directory.path);
}

function openFragmentDirectory(indexDirectory) {
  const fragmentDirectory = resolve(indexDirectory, 'manifest');
  const metadata = fileMetadata(fragmentDirectory, 'Staging manifest fragment directory');
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    return reject('Staging manifest fragment directory must be a regular non-symlink directory');
  }
  let descriptor;
  try {
    descriptor = openSync(
      fragmentDirectory,
      constants.O_RDONLY
        | (constants.O_DIRECTORY ?? 0)
        | (constants.O_NOFOLLOW ?? 0)
        | (constants.O_NONBLOCK ?? 0),
    );
    const descriptorMetadata = fstatSync(descriptor, { bigint: true });
    if (!descriptorMetadata.isDirectory()
      || !sameStableMetadata(descriptorMetadata, metadata)) {
      reject('Staging manifest fragment directory changed before it could be read');
    }
    fragmentInventory(fragmentDirectory);
    const directory = Object.freeze({
      path: fragmentDirectory,
      descriptor,
      metadata,
      realPath: realpathSync(fragmentDirectory),
    });
    assertFragmentDirectoryStable(directory);
    return directory;
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    if (error instanceof StagingManifestBundleError) throw error;
    return reject('Staging manifest fragment directory could not be opened safely');
  }
}

function validateIndex(value) {
  const index = orderedRecord(value, INDEX_KEYS, 'Staging manifest bundle index');
  exact(index.schema, BUNDLE_SCHEMA, 'Staging manifest bundle schema');
  exact(index.bundle_revision, BUNDLE_REVISION, 'Staging manifest bundle revision');
  if (typeof index.manifest_schema !== 'string' || index.manifest_schema.length === 0
    || index.manifest_schema.length > 128) {
    reject('Staging manifest schema is invalid');
  }
  if (!Number.isSafeInteger(index.manifest_revision) || index.manifest_revision < 1) {
    reject('Staging manifest revision is invalid');
  }
  if (!Array.isArray(index.fragments) || index.fragments.length !== FRAGMENT_SPECS.length) {
    reject('Staging manifest bundle fragment inventory has drifted');
  }
  index.fragments.forEach((valueEntry, indexEntry) => {
    const spec = FRAGMENT_SPECS[indexEntry];
    const entry = orderedRecord(
      valueEntry,
      INDEX_ENTRY_KEYS,
      `Staging manifest bundle fragment ${indexEntry + 1}`,
    );
    exact(entry.id, spec.id, `Staging manifest bundle fragment ${spec.id} identifier`);
    exact(entry.path, spec.path, `Staging manifest bundle fragment ${spec.id} path`);
    exact(entry.mount, spec.mount, `Staging manifest bundle fragment ${spec.id} mount`);
    if (!Number.isSafeInteger(entry.size_bytes) || entry.size_bytes <= 0
      || entry.size_bytes > MAXIMUM_FRAGMENT_BYTES) {
      reject(`Staging manifest bundle fragment ${spec.id} size is invalid`);
    }
    if (typeof entry.sha256 !== 'string' || !SHA256.test(entry.sha256)) {
      reject(`Staging manifest bundle fragment ${spec.id} digest is invalid`);
    }
  });
  return index;
}

function validateFragment(value, spec) {
  const fragment = orderedRecord(value, FRAGMENT_KEYS, `Staging manifest ${spec.id} fragment`);
  exact(fragment.schema, FRAGMENT_SCHEMA, `Staging manifest ${spec.id} fragment schema`);
  exact(fragment.bundle_revision, BUNDLE_REVISION, `Staging manifest ${spec.id} bundle revision`);
  exact(fragment.id, spec.id, `Staging manifest ${spec.id} identifier`);
  exact(fragment.mount, spec.mount, `Staging manifest ${spec.id} mount`);
  orderedRecord(fragment.values, spec.keys, `Staging manifest ${spec.id} values`);
  return fragment;
}

function assembleManifest(fragments) {
  const core = fragments.get('core').values;
  const terraform = fragments.get('terraform').values;
  const platformEvidence = fragments.get('evidence-platform').values;
  const browserRelayEvidence = fragments.get('evidence-browser-relay').values;
  const evidence = {};
  for (const key of EVIDENCE_KEY_ORDER) {
    evidence[key] = Object.hasOwn(platformEvidence, key)
      ? platformEvidence[key]
      : browserRelayEvidence[key];
  }
  return {
    schema: core.schema,
    revision: core.revision,
    status: core.status,
    environment: core.environment,
    project: core.project,
    bootstrap: core.bootstrap,
    locations: core.locations,
    services: core.services,
    runtime: core.runtime,
    data: core.data,
    security: core.security,
    cost: core.cost,
    terraform: terraform.terraform,
    readiness: core.readiness,
    evidence,
    teardown: core.teardown,
  };
}

export function loadStagingManifestBundle(manifestPath) {
  const indexPath = resolve(manifestPath);
  const indexDirectory = dirname(indexPath);
  const indexFile = readCanonicalJson(
    indexPath,
    MAXIMUM_INDEX_BYTES,
    'Staging manifest bundle index',
  );
  const index = validateIndex(indexFile.value);

  let indexDirectoryRealPath;
  try {
    indexDirectoryRealPath = realpathSync(indexDirectory);
  } catch {
    return reject('Staging manifest bundle directory could not be resolved');
  }
  const fragmentDirectory = openFragmentDirectory(indexDirectory);

  try {
    if (!containedPath(indexDirectoryRealPath, fragmentDirectory.realPath)) {
      reject('Staging manifest fragment directory escapes its bundle');
    }
    let totalBytes = indexFile.bytes.byteLength;
    const fragments = new Map();
    for (const [position, spec] of FRAGMENT_SPECS.entries()) {
      assertFragmentDirectoryStable(fragmentDirectory);
      const entry = index.fragments[position];
      const fragmentPath = resolve(indexDirectory, spec.path);
      let fragmentRealPath;
      try {
        fragmentRealPath = realpathSync(fragmentPath);
      } catch {
        return reject(`Staging manifest ${spec.id} fragment could not be resolved`);
      }
      if (!containedPath(fragmentDirectory.realPath, fragmentRealPath)) {
        reject(`Staging manifest ${spec.id} fragment escapes its bundle`);
      }
      const file = readCanonicalJson(
        fragmentPath,
        MAXIMUM_FRAGMENT_BYTES,
        `Staging manifest ${spec.id} fragment`,
      );
      let fragmentRealPathAfterRead;
      try {
        fragmentRealPathAfterRead = realpathSync(fragmentPath);
      } catch {
        return reject(`Staging manifest ${spec.id} fragment changed while it was read`);
      }
      if (fragmentRealPathAfterRead !== fragmentRealPath) {
        reject(`Staging manifest ${spec.id} fragment changed while it was read`);
      }
      assertFragmentDirectoryStable(fragmentDirectory);
      if (file.bytes.byteLength !== entry.size_bytes) {
        reject(`Staging manifest ${spec.id} fragment size has drifted`);
      }
      if (sha256(file.bytes) !== entry.sha256) {
        reject(`Staging manifest ${spec.id} fragment digest has drifted`);
      }
      totalBytes += file.bytes.byteLength;
      if (totalBytes > MAXIMUM_BUNDLE_BYTES) {
        reject(`Staging manifest bundle exceeds ${MAXIMUM_BUNDLE_BYTES} bytes`);
      }
      fragments.set(spec.id, validateFragment(file.value, spec));
    }
    assertFragmentDirectoryStable(fragmentDirectory);
    const core = fragments.get('core').values;
    exact(core.schema, index.manifest_schema, 'Staging manifest index/core schema');
    exact(core.revision, index.manifest_revision, 'Staging manifest index/core revision');
    return assembleManifest(fragments);
  } finally {
    closeSync(fragmentDirectory.descriptor);
  }
}

export function loadCanonicalJsonFile(path, maximumBytes) {
  return readCanonicalJson(resolve(path), maximumBytes, 'JSON file').value;
}
