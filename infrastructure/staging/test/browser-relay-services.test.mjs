import assert from 'node:assert/strict';
import {
  chmodSync,
  copyFileSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  RELAY_SERVICES_PROFILE_SHA256,
  RELAY_SERVICES_TERRAFORM_SOURCE_FILES,
  RELAY_SERVICES_V1_PROFILE_SHA256,
  StagingRelayServicesProfileError,
  relayServicesTerraformSourceSha256,
  validateRelayServicesProfile,
  validateRelayServicesV1Profile,
} from '../browser-relay-services/contract.mjs';
import {
  ALLOWED_RELAY_SERVICE_FILES,
  ALLOWED_RELAY_SERVICE_TEST_FILES,
  validateRelayServicesRoot,
} from '../browser-relay-services/guard.mjs';

const rootUrl = new URL('../browser-relay-services/', import.meta.url);
const profileUrl = new URL('profile.json', rootUrl);

function withTemporaryDirectory(callback) {
  const directory = mkdtempSync(join(tmpdir(), 'miakapp-relay-services-test-'));
  try {
    return callback(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function writeProfile(directory, mutate) {
  const profile = JSON.parse(readFileSync(profileUrl, 'utf8'));
  mutate(profile);
  const path = join(directory, 'profile.json');
  writeFileSync(path, `${JSON.stringify(profile, null, 2)}\n`, { mode: 0o600 });
  return path;
}

function createGuardFixture(directory) {
  for (const name of ALLOWED_RELAY_SERVICE_FILES) {
    writeFileSync(join(directory, name), `${name}\n`, { mode: 0o600 });
  }
  mkdirSync(join(directory, 'tests'));
  for (const name of ALLOWED_RELAY_SERVICE_TEST_FILES) {
    writeFileSync(join(directory, 'tests', name), `${name}\n`, { mode: 0o600 });
  }
}

test('validates the immutable digest-bound relay-services profile', () => {
  const profile = validateRelayServicesProfile(fileURLToPath(profileUrl));
  const historical = validateRelayServicesV1Profile();
  assert.equal(RELAY_SERVICES_PROFILE_SHA256, '26535e8c8b56d5a0a0875049a1e76aade4e1246b0808470ab4483bc01a2f48cb');
  assert.equal(RELAY_SERVICES_V1_PROFILE_SHA256, 'bc9b231cc9724f19a26ef5c3bbd6da6a69ec79b00cb976e77c73015d5db10db7');
  assert.equal(profile.terraform_source_sha256, '8a9e1b5c37e1c25befccfd2b2eac838639a74901785c88e83521a2f897b9f746');
  assert.equal(profile.pins.miakapp_server_commit, 'df10674e034f30eec80760f5ec94bc108cff026f');
  assert.equal(
    profile.image.digest_reference,
    'europe-west9-docker.pkg.dev/miakapp-v4-staging/miakapp-control-plane/miakapp-server@sha256:23a19a26e8a24f6434ab8bc557dfa3fa799e0262e3400170e3bf064101a890b1',
  );
  assert.equal(profile.contracts.historical_profile_sha256, RELAY_SERVICES_V1_PROFILE_SHA256);
  assert.equal(historical.image.digest, undefined);
  assert.deepEqual(profile.runtime_identity.project_roles, []);
  assert.equal(profile.cloud_run.minimum_instances, 0);
  assert.equal(profile.cloud_run.maximum_instances, 1);
  assert.equal(profile.admission.maximum_connections, 8);
  assert.equal(profile.admission.maximum_aggregate_queued_bytes, 4194304);
  assert.equal(profile.admission.forwarded_client_headers_trusted, false);
  assert.deepEqual(profile.phases, ['absent', 'private_bootstrap', 'private_ready', 'public_window']);
});

test('rejects any profile byte or safety-boundary drift', () => {
  withTemporaryDirectory((directory) => {
    for (const mutate of [
      (profile) => { profile.project_id = 'miakapp-3'; },
      (profile) => { profile.image.digest = `sha256:${'0'.repeat(64)}`; },
      (profile) => { profile.image.mutable_tags_allowed = true; },
      (profile) => { profile.runtime_identity.project_roles = ['roles/editor']; },
      (profile) => { profile.cloud_run.maximum_instances = 2; },
      (profile) => { profile.admission.maximum_connections = 9; },
      (profile) => { profile.effects.public_iam_only_in_public_window = false; },
    ]) {
      const path = writeProfile(directory, mutate);
      assert.throws(
        () => validateRelayServicesProfile(path),
        (error) => error instanceof StagingRelayServicesProfileError
          && /digest has drifted/.test(error.message),
      );
    }
  });
});

test('binds the profile to every operational Terraform source byte', () => {
  assert.equal(
    relayServicesTerraformSourceSha256(fileURLToPath(rootUrl)),
    '8a9e1b5c37e1c25befccfd2b2eac838639a74901785c88e83521a2f897b9f746',
  );

  withTemporaryDirectory((directory) => {
    copyFileSync(profileUrl, join(directory, 'profile.json'));
    for (const name of RELAY_SERVICES_TERRAFORM_SOURCE_FILES) {
      copyFileSync(new URL(name, rootUrl), join(directory, name));
    }
    validateRelayServicesProfile(join(directory, 'profile.json'));
    writeFileSync(join(directory, 'main.tf'), '\n# drift\n', { flag: 'a' });
    assert.throws(
      () => validateRelayServicesProfile(join(directory, 'profile.json')),
      (error) => error instanceof StagingRelayServicesProfileError
        && /Terraform source digest has drifted/.test(error.message),
    );
  });
});

test('removes the relay image as an operator-controlled Terraform input', () => {
  const variables = readFileSync(new URL('variables.tf', rootUrl), 'utf8');
  const main = readFileSync(new URL('main.tf', rootUrl), 'utf8');
  const foundation = readFileSync(new URL('foundation.tf', rootUrl), 'utf8');
  assert.doesNotMatch(variables, /variable "relay_image"/u);
  assert.doesNotMatch(`${main}\n${foundation}`, /var\.relay_image/u);
  assert.match(main, /image = local\.relay_image/u);
  assert.match(foundation, /local\.relay_image == local\.profile\.image\.digest_reference/u);
});

test('accepts only the closed, non-executable source inventory', () => {
  validateRelayServicesRoot(rootUrl);

  withTemporaryDirectory((directory) => {
    createGuardFixture(directory);
    validateRelayServicesRoot(pathToFileURL(`${directory}/`));

    writeFileSync(join(directory, 'apply.sh'), '#!/bin/sh\n', { mode: 0o600 });
    assert.throws(
      () => validateRelayServicesRoot(pathToFileURL(`${directory}/`)),
      /reviewed relay-services inventory/,
    );
  });

  withTemporaryDirectory((directory) => {
    createGuardFixture(directory);
    chmodSync(join(directory, 'main.tf'), 0o700);
    assert.throws(
      () => validateRelayServicesRoot(pathToFileURL(`${directory}/`)),
      /must not be executable/,
    );
  });

  withTemporaryDirectory((directory) => {
    createGuardFixture(directory);
    rmSync(join(directory, 'profile.json'));
    symlinkSync(join(directory, 'README.md'), join(directory, 'profile.json'));
    assert.throws(
      () => validateRelayServicesRoot(pathToFileURL(`${directory}/`)),
      /must not be a symbolic link/,
    );
  });
});
