import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  StagingManifestBundleError,
  loadStagingManifestBundle,
} from '../manifest-bundle.mjs';

const stagingRoot = fileURLToPath(new URL('../', import.meta.url));
const committedIndexPath = join(stagingRoot, 'manifest.json');
const committedFragmentRoot = join(stagingRoot, 'manifest');

function canonical(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function createFixture() {
  const root = mkdtempSync(join(tmpdir(), 'miakapp-staging-manifest-bundle-'));
  copyFileSync(committedIndexPath, join(root, 'manifest.json'));
  cpSync(committedFragmentRoot, join(root, 'manifest'), { recursive: true });
  return Object.freeze({
    root,
    indexPath: join(root, 'manifest.json'),
    fragmentRoot: join(root, 'manifest'),
  });
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeCanonical(path, value) {
  writeFileSync(path, canonical(value), { mode: 0o644 });
}

function updateIndexEntry(fixture, id, bytes) {
  const index = readJson(fixture.indexPath);
  const entry = index.fragments.find((candidate) => candidate.id === id);
  assert.notEqual(entry, undefined);
  entry.size_bytes = bytes.byteLength;
  entry.sha256 = sha256(bytes);
  writeCanonical(fixture.indexPath, index);
}

function mutateFragment(fixture, id, mutator, updateIndex = true) {
  const path = join(fixture.fragmentRoot, `${id}.json`);
  const fragment = readJson(path);
  mutator(fragment);
  const bytes = canonical(fragment);
  writeFileSync(path, bytes, { mode: 0o644 });
  if (updateIndex) updateIndexEntry(fixture, id, bytes);
}

function bundleBytes(fixture) {
  const index = readJson(fixture.indexPath);
  return readFileSync(fixture.indexPath).byteLength
    + index.fragments.reduce(
      (total, entry) => total + readFileSync(join(fixture.root, entry.path)).byteLength,
      0,
    );
}

function appendPadding(value, padding) {
  for (const key of Object.keys(value)) {
    if (key === 'schema') continue;
    if (typeof value[key] === 'string') {
      value[key] += padding;
      return true;
    }
    if (value[key] !== null && typeof value[key] === 'object'
      && appendPadding(value[key], padding)) {
      return true;
    }
  }
  return false;
}

function paddedFragmentBytes(fixture, id, paddingBytes) {
  const fragment = readJson(join(fixture.fragmentRoot, `${id}.json`));
  assert.equal(appendPadding(fragment.values, 'x'.repeat(paddingBytes)), true);
  return canonical(fragment);
}

function bundleBytesWithReplacement(fixture, id, replacementBytes) {
  const currentIndexBytes = readFileSync(fixture.indexPath).byteLength;
  const index = readJson(fixture.indexPath);
  const entry = index.fragments.find((candidate) => candidate.id === id);
  assert.notEqual(entry, undefined);
  const currentFragmentBytes = readFileSync(join(fixture.root, entry.path)).byteLength;
  entry.size_bytes = replacementBytes.byteLength;
  entry.sha256 = sha256(replacementBytes);
  return bundleBytes(fixture) - currentIndexBytes - currentFragmentBytes
    + canonical(index).byteLength + replacementBytes.byteLength;
}

function padBundleTo(fixture, targetBytes) {
  assert.ok(targetBytes >= bundleBytes(fixture));
  const index = readJson(fixture.indexPath);
  for (const { id, path } of index.fragments) {
    const currentBundleBytes = bundleBytes(fixture);
    if (currentBundleBytes === targetBytes) break;
    const currentBytes = readFileSync(join(fixture.root, path)).byteLength;
    let lower = 0;
    let upper = Math.min(
      targetBytes - currentBundleBytes,
      (96 * 1024) - currentBytes,
    );
    while (lower < upper) {
      const candidate = Math.ceil((lower + upper) / 2);
      const candidateBytes = paddedFragmentBytes(fixture, id, candidate);
      if (bundleBytesWithReplacement(fixture, id, candidateBytes) <= targetBytes) {
        lower = candidate;
      } else {
        upper = candidate - 1;
      }
    }
    if (lower === 0) continue;
    mutateFragment(fixture, id, (fragment) => {
      assert.equal(appendPadding(fragment.values, 'x'.repeat(lower)), true);
    });
  }
  assert.equal(bundleBytes(fixture), targetBytes);
}

function rejectsFixture(mutator, pattern) {
  const fixture = createFixture();
  try {
    mutator(fixture);
    assert.throws(
      () => loadStagingManifestBundle(fixture.indexPath),
      (error) => error instanceof StagingManifestBundleError && pattern.test(error.message),
    );
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
}

test('assembles the canonical committed bundle into the current semantic manifest', () => {
  const index = readJson(committedIndexPath);
  assert.equal(index.bundle_revision, 4);
  assert.deepEqual(
    index.fragments.map(({ id, path, mount }) => ({ id, path, mount })),
    [
      { id: 'core', path: 'manifest/core.json', mount: 'manifest' },
      { id: 'terraform', path: 'manifest/terraform.json', mount: 'manifest' },
      {
        id: 'evidence-platform',
        path: 'manifest/evidence-platform.json',
        mount: 'evidence',
      },
      {
        id: 'evidence-browser-relay-scenario',
        path: 'manifest/evidence-browser-relay-scenario.json',
        mount: 'evidence',
      },
      {
        id: 'evidence-browser-relay-readers',
        path: 'manifest/evidence-browser-relay-readers.json',
        mount: 'evidence',
      },
      {
        id: 'evidence-browser-relay-providers',
        path: 'manifest/evidence-browser-relay-providers.json',
        mount: 'evidence',
      },
      {
        id: 'evidence-browser-relay-operations',
        path: 'manifest/evidence-browser-relay-operations.json',
        mount: 'evidence',
      },
    ],
  );
  for (const entry of index.fragments) {
    assert.equal(readJson(join(stagingRoot, entry.path)).bundle_revision, 4);
  }
  assert.ok(index.fragments.every(({ size_bytes: size }) => size < 96 * 1024));
  assert.ok(bundleBytes({ indexPath: committedIndexPath, root: stagingRoot }) < 512 * 1024);

  const scenarioEvidence = readJson(
    join(committedFragmentRoot, 'evidence-browser-relay-scenario.json'),
  );
  assert.deepEqual(Object.keys(scenarioEvidence.values), [
    'browser_relay_plan',
    'browser_relay_runner',
    'browser_relay_page',
    'browser_relay_fixture',
    'browser_relay_fixture_cloud',
    'browser_relay_fixture_miakapi',
    'browser_relay_aggregator',
    'browser_relay_independent_observers',
    'browser_relay_evidence_session',
    'browser_relay_case_scheduler',
    'browser_relay_chromium_case_adapter',
    'browser_relay_secondary_case_adapter',
    'browser_relay_independent_case_adapter',
    'chromium_scenario_automation',
    'browser_relay_playwright_bridge',
    'browser_relay_page_receipt',
    'browser_relay_scenario_fixture',
    'browser_relay_scenario_fixture_cloud',
  ]);
  const readerEvidence = readJson(
    join(committedFragmentRoot, 'evidence-browser-relay-readers.json'),
  );
  assert.deepEqual(Object.keys(readerEvidence.values), [
    'browser_relay_source_transports',
    'browser_relay_authenticated_source_readers',
    'browser_relay_source_authority_adapters',
    'browser_relay_source_session_producers',
  ]);
  const providerEvidence = readJson(
    join(committedFragmentRoot, 'evidence-browser-relay-providers.json'),
  );
  assert.deepEqual(Object.keys(providerEvidence.values), [
    'browser_relay_source_clients',
    'browser_relay_operator_authority_source',
    'browser_relay_hosting_publisher',
    'browser_relay_trusted_source_composition',
    'browser_relay_trusted_provider_process',
    'browser_relay_trusted_provider_owner',
  ]);
  const operationsEvidence = readJson(
    join(committedFragmentRoot, 'evidence-browser-relay-operations.json'),
  );
  assert.deepEqual(Object.keys(operationsEvidence.values), [
    'browser_relay_monitoring',
    'browser_relay_rollback',
    'browser_relay_orchestrator',
    'browser_relay_operation',
    'browser_relay_operation_case_adapter',
    'browser_relay_image',
    'browser_app_check_prerequisite',
    'browser_app_check_attestation',
    'signing_key_overlap_prerequisite',
  ]);

  const manifest = loadStagingManifestBundle(committedIndexPath);
  const semanticBytes = canonical(manifest);
  assert.equal(semanticBytes.byteLength, 272035);
  assert.equal(
    sha256(semanticBytes),
    '401d55de8eb36d14b1f4124a34fd8f3e7f19c1f7899189022fd1db55dc0ebb0a',
  );
  assert.deepEqual(Object.keys(manifest), [
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
    'terraform',
    'readiness',
    'evidence',
    'teardown',
  ]);
  assert.deepEqual(Object.keys(manifest.evidence), [
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
    'browser_relay_plan',
    'browser_relay_runner',
    'browser_relay_page',
    'browser_relay_fixture',
    'browser_relay_fixture_cloud',
    'browser_relay_fixture_miakapi',
    'browser_relay_aggregator',
    'browser_relay_independent_observers',
    'browser_relay_evidence_session',
    'browser_relay_case_scheduler',
    'browser_relay_chromium_case_adapter',
    'browser_relay_secondary_case_adapter',
    'browser_relay_independent_case_adapter',
    'browser_relay_source_transports',
    'browser_relay_authenticated_source_readers',
    'browser_relay_source_authority_adapters',
    'browser_relay_source_session_producers',
    'browser_relay_source_clients',
    'browser_relay_operator_authority_source',
    'browser_relay_hosting_publisher',
    'browser_relay_trusted_source_composition',
    'browser_relay_trusted_provider_process',
    'browser_relay_trusted_provider_owner',
    'chromium_scenario_automation',
    'browser_relay_playwright_bridge',
    'browser_relay_page_receipt',
    'browser_relay_scenario_fixture',
    'browser_relay_scenario_fixture_cloud',
    'browser_relay_monitoring',
    'browser_relay_rollback',
    'browser_relay_orchestrator',
    'browser_relay_operation',
    'browser_relay_operation_case_adapter',
    'browser_relay_image',
    'browser_app_check_prerequisite',
    'browser_app_check_attestation',
    'signing_key_overlap_prerequisite',
    'retired_recovery_workflow',
    'staging_rows',
    'fault_matrix',
    'production_security_boundary',
    'production_composition_boundary',
    'environment_decision',
  ]);
  assert.equal(manifest.schema, 'miakapp.staging-intent/1');
  assert.equal(manifest.revision, 109);
  assert.equal(manifest.project.project_id, 'miakapp-v4-staging');
  assert.equal(manifest.terraform.bootstrap_execution.bootstrap_completed, true);
  assert.equal(
    manifest.evidence.browser_relay_independent_observers.live_execution_authorized,
    false,
  );
  assert.equal(
    manifest.evidence.browser_relay_secondary_case_adapter
      .compatibility.complete_three_browser_page_scenarios_composed,
    true,
  );
  assert.equal(
    manifest.evidence.browser_relay_independent_case_adapter
      .compatibility.independent_source_composition_present,
    true,
  );
  assert.equal(
    manifest.evidence.browser_relay_source_transports.profile_sha256,
    '9628f2dbe63713da3f4777908e036155c8c7852f3ac110d3efc162266a933ad4',
  );
  assert.equal(manifest.evidence.browser_relay_source_transports.transport.sources, 7);
  assert.equal(manifest.evidence.browser_relay_source_transports.transport.stages, 22);
  assert.equal(
    manifest.evidence.browser_relay_source_transports.transport.observations_per_matrix,
    43,
  );
  assert.equal(
    manifest.evidence.browser_relay_source_transports
      .compatibility.trusted_live_source_readers_present,
    false,
  );
  assert.ok(
    Object.values(manifest.evidence.browser_relay_source_transports.authority)
      .every((value) => value === false),
  );
  assert.equal(
    manifest.evidence.browser_relay_trusted_source_composition
      .compatibility.operation_case_adapter_wired,
    true,
  );
  assert.equal(
    manifest.evidence.browser_relay_trusted_source_composition.evidence.live_execution_count,
    0,
  );
  assert.equal(
    manifest.evidence.browser_relay_trusted_provider_process
      .ownership.dedicated_process_ipc_present,
    true,
  );
  assert.equal(
    manifest.evidence.browser_relay_trusted_provider_process
      .compatibility.live_owner_bundle_present,
    false,
  );
  assert.equal(
    manifest.evidence.browser_relay_trusted_provider_process.evidence.live_execution_count,
    0,
  );
  assert.equal(
    manifest.evidence.browser_relay_trusted_provider_owner
      .graph.all_graph_capabilities_created_in_child,
    true,
  );
  assert.equal(
    manifest.evidence.browser_relay_trusted_provider_owner.evidence.real_browser_launches,
    3,
  );
  assert.equal(
    manifest.evidence.browser_relay_trusted_provider_owner.evidence.live_execution_count,
    0,
  );
  assert.equal(manifest.teardown.automated, false);
});

test('rejects oversized or noncanonical bundle indexes before reading fragments', () => {
  rejectsFixture(
    ({ indexPath }) => writeFileSync(indexPath, ' '.repeat((16 * 1024) + 1)),
    /exceeds 16384 bytes/u,
  );
  rejectsFixture(({ indexPath }) => {
    const source = readFileSync(indexPath, 'utf8');
    writeFileSync(indexPath, ` ${source}`);
  }, /not canonical two-space JSON/u);
  rejectsFixture(({ indexPath }) => {
    const source = readFileSync(indexPath, 'utf8');
    writeFileSync(indexPath, source.replace(
      '  "schema":',
      '  "schema": "ignored duplicate",\n  "schema":',
    ));
  }, /not canonical two-space JSON/u);
});

test('rejects oversized, noncanonical, executable and symlinked fragments', () => {
  rejectsFixture(({ fragmentRoot }) => {
    writeFileSync(join(fragmentRoot, 'core.json'), ' '.repeat((96 * 1024) + 1));
  }, /exceeds 98304 bytes/u);
  rejectsFixture((fixture) => {
    const path = join(fixture.fragmentRoot, 'core.json');
    const bytes = Buffer.from(`${JSON.stringify(readJson(path))}\n`, 'utf8');
    writeFileSync(path, bytes);
    updateIndexEntry(fixture, 'core', bytes);
  }, /not canonical two-space JSON/u);
  rejectsFixture(({ fragmentRoot }) => {
    chmodSync(join(fragmentRoot, 'core.json'), 0o755);
  }, /must not be executable/u);
  rejectsFixture(({ fragmentRoot }) => {
    const corePath = join(fragmentRoot, 'core.json');
    unlinkSync(corePath);
    symlinkSync(join(fragmentRoot, 'terraform.json'), corePath);
  }, /regular non-symlink file/u);
});

test('rejects missing, extra and symlinked fragment directories', () => {
  rejectsFixture(({ fragmentRoot }) => {
    unlinkSync(join(fragmentRoot, 'core.json'));
  }, /fragment inventory has drifted/u);
  rejectsFixture(({ fragmentRoot }) => {
    writeFileSync(join(fragmentRoot, 'extra.json'), '{}\n');
  }, /fragment inventory has drifted/u);
  rejectsFixture((fixture) => {
    rmSync(fixture.fragmentRoot, { recursive: true });
    symlinkSync(committedFragmentRoot, fixture.fragmentRoot);
  }, /regular non-symlink directory/u);
});

test('rejects fragment path, mount, size and digest drift from the fixed index', () => {
  for (const path of ['../core.json', '/tmp/core.json']) {
    rejectsFixture(({ indexPath }) => {
      const index = readJson(indexPath);
      index.fragments[0].path = path;
      writeCanonical(indexPath, index);
    }, /fragment core path has drifted/u);
  }
  rejectsFixture(({ indexPath }) => {
    const index = readJson(indexPath);
    index.fragments[2].mount = 'manifest';
    writeCanonical(indexPath, index);
  }, /fragment evidence-platform mount has drifted/u);
  rejectsFixture(({ indexPath }) => {
    const index = readJson(indexPath);
    index.fragments[4].path = 'manifest/evidence-browser-relay-scenario.json';
    writeCanonical(indexPath, index);
  }, /fragment evidence-browser-relay-readers path has drifted/u);
  rejectsFixture(({ indexPath }) => {
    const index = readJson(indexPath);
    index.fragments[4].mount = 'manifest';
    writeCanonical(indexPath, index);
  }, /fragment evidence-browser-relay-readers mount has drifted/u);
  rejectsFixture(({ indexPath }) => {
    const index = readJson(indexPath);
    index.fragments[5].path = 'manifest/evidence-browser-relay-readers.json';
    writeCanonical(indexPath, index);
  }, /fragment evidence-browser-relay-providers path has drifted/u);
  rejectsFixture(({ indexPath }) => {
    const index = readJson(indexPath);
    index.fragments[5].mount = 'manifest';
    writeCanonical(indexPath, index);
  }, /fragment evidence-browser-relay-providers mount has drifted/u);
  rejectsFixture(({ indexPath }) => {
    const index = readJson(indexPath);
    index.fragments[0].size_bytes += 1;
    writeCanonical(indexPath, index);
  }, /core fragment size has drifted/u);
  rejectsFixture((fixture) => {
    mutateFragment(fixture, 'core', (fragment) => {
      fragment.values.status = `x${fragment.values.status.slice(1)}`;
    }, false);
  }, /core fragment digest has drifted/u);
});

test('rejects index/core revision, identity and owned-key drift after digest reconciliation', () => {
  rejectsFixture(({ indexPath }) => {
    const index = readJson(indexPath);
    index.bundle_revision -= 1;
    writeCanonical(indexPath, index);
  }, /bundle revision has drifted/u);
  rejectsFixture((fixture) => {
    mutateFragment(fixture, 'core', (fragment) => {
      fragment.bundle_revision -= 1;
    });
  }, /core bundle revision has drifted/u);
  rejectsFixture((fixture) => {
    mutateFragment(fixture, 'core', (fragment) => {
      fragment.values.revision -= 1;
    });
  }, /index\/core revision has drifted/u);
  rejectsFixture((fixture) => {
    mutateFragment(fixture, 'terraform', (fragment) => {
      fragment.id = 'core';
    });
  }, /terraform identifier has drifted/u);
  rejectsFixture((fixture) => {
    mutateFragment(fixture, 'evidence-browser-relay-readers', (fragment) => {
      fragment.id = 'evidence-browser-relay-scenario';
    });
  }, /evidence-browser-relay-readers identifier has drifted/u);
  rejectsFixture((fixture) => {
    mutateFragment(fixture, 'evidence-browser-relay-providers', (fragment) => {
      fragment.id = 'evidence-browser-relay-readers';
    });
  }, /evidence-browser-relay-providers identifier has drifted/u);
  rejectsFixture((fixture) => {
    mutateFragment(fixture, 'evidence-platform', (fragment) => {
      fragment.values.unreviewed = true;
    });
  }, /evidence-platform values fields or field order have drifted/u);
});

test('rejects missing, reassigned or duplicated reader and provider evidence ownership', () => {
  rejectsFixture((fixture) => {
    mutateFragment(fixture, 'evidence-browser-relay-readers', (fragment) => {
      delete fragment.values.browser_relay_source_transports;
    });
  }, /evidence-browser-relay-readers values fields or field order have drifted/u);
  rejectsFixture((fixture) => {
    let reassigned;
    mutateFragment(fixture, 'evidence-browser-relay-readers', (fragment) => {
      reassigned = fragment.values.browser_relay_source_transports;
      delete fragment.values.browser_relay_source_transports;
    });
    mutateFragment(fixture, 'evidence-browser-relay-scenario', (fragment) => {
      fragment.values.browser_relay_source_transports = reassigned;
    });
  }, /evidence-browser-relay-scenario values fields or field order have drifted/u);
  rejectsFixture((fixture) => {
    mutateFragment(fixture, 'evidence-browser-relay-scenario', (fragment) => {
      fragment.values.browser_relay_source_transports = readJson(
        join(fixture.fragmentRoot, 'evidence-browser-relay-readers.json'),
      ).values.browser_relay_source_transports;
    });
  }, /evidence-browser-relay-scenario values fields or field order have drifted/u);
  rejectsFixture((fixture) => {
    mutateFragment(fixture, 'evidence-browser-relay-readers', (fragment) => {
      delete fragment.values.browser_relay_authenticated_source_readers;
    });
  }, /evidence-browser-relay-readers values fields or field order have drifted/u);
  rejectsFixture((fixture) => {
    let reassigned;
    mutateFragment(fixture, 'evidence-browser-relay-readers', (fragment) => {
      reassigned = fragment.values.browser_relay_authenticated_source_readers;
      delete fragment.values.browser_relay_authenticated_source_readers;
    });
    mutateFragment(fixture, 'evidence-browser-relay-scenario', (fragment) => {
      fragment.values.browser_relay_authenticated_source_readers = reassigned;
    });
  }, /evidence-browser-relay-scenario values fields or field order have drifted/u);
  rejectsFixture((fixture) => {
    mutateFragment(fixture, 'evidence-browser-relay-readers', (fragment) => {
      delete fragment.values.browser_relay_source_authority_adapters;
    });
  }, /evidence-browser-relay-readers values fields or field order have drifted/u);
  rejectsFixture((fixture) => {
    let reassigned;
    mutateFragment(fixture, 'evidence-browser-relay-readers', (fragment) => {
      reassigned = fragment.values.browser_relay_source_authority_adapters;
      delete fragment.values.browser_relay_source_authority_adapters;
    });
    mutateFragment(fixture, 'evidence-browser-relay-scenario', (fragment) => {
      fragment.values.browser_relay_source_authority_adapters = reassigned;
    });
  }, /evidence-browser-relay-scenario values fields or field order have drifted/u);
  rejectsFixture((fixture) => {
    mutateFragment(fixture, 'evidence-browser-relay-readers', (fragment) => {
      delete fragment.values.browser_relay_source_session_producers;
    });
  }, /evidence-browser-relay-readers values fields or field order have drifted/u);
  rejectsFixture((fixture) => {
    const producer = readJson(
      join(fixture.fragmentRoot, 'evidence-browser-relay-readers.json'),
    ).values.browser_relay_source_session_producers;
    mutateFragment(fixture, 'evidence-browser-relay-readers', (fragment) => {
      delete fragment.values.browser_relay_source_session_producers;
      const authority = fragment.values.browser_relay_source_authority_adapters;
      delete fragment.values.browser_relay_source_authority_adapters;
      fragment.values.browser_relay_source_session_producers = producer;
      fragment.values.browser_relay_source_authority_adapters = authority;
    });
  }, /evidence-browser-relay-readers values fields or field order have drifted/u);
  rejectsFixture((fixture) => {
    mutateFragment(fixture, 'evidence-browser-relay-providers', (fragment) => {
      delete fragment.values.browser_relay_source_clients;
    });
  }, /evidence-browser-relay-providers values fields or field order have drifted/u);
  rejectsFixture((fixture) => {
    let reassigned;
    mutateFragment(fixture, 'evidence-browser-relay-providers', (fragment) => {
      reassigned = fragment.values.browser_relay_source_clients;
      delete fragment.values.browser_relay_source_clients;
    });
    mutateFragment(fixture, 'evidence-browser-relay-readers', (fragment) => {
      fragment.values.browser_relay_source_clients = reassigned;
    });
  }, /evidence-browser-relay-readers values fields or field order have drifted/u);
  rejectsFixture((fixture) => {
    mutateFragment(fixture, 'evidence-browser-relay-providers', (fragment) => {
      delete fragment.values.browser_relay_operator_authority_source;
    });
  }, /evidence-browser-relay-providers values fields or field order have drifted/u);
  rejectsFixture((fixture) => {
    let reassigned;
    mutateFragment(fixture, 'evidence-browser-relay-providers', (fragment) => {
      reassigned = fragment.values.browser_relay_hosting_publisher;
      delete fragment.values.browser_relay_hosting_publisher;
    });
    mutateFragment(fixture, 'evidence-browser-relay-readers', (fragment) => {
      fragment.values.browser_relay_hosting_publisher = reassigned;
    });
  }, /evidence-browser-relay-readers values fields or field order have drifted/u);
  rejectsFixture((fixture) => {
    mutateFragment(fixture, 'evidence-browser-relay-readers', (fragment) => {
      fragment.values.browser_relay_trusted_source_composition = readJson(
        join(fixture.fragmentRoot, 'evidence-browser-relay-providers.json'),
      ).values.browser_relay_trusted_source_composition;
    });
  }, /evidence-browser-relay-readers values fields or field order have drifted/u);
  rejectsFixture((fixture) => {
    mutateFragment(fixture, 'evidence-browser-relay-providers', (fragment) => {
      delete fragment.values.browser_relay_trusted_source_composition;
    });
  }, /evidence-browser-relay-providers values fields or field order have drifted/u);
  rejectsFixture((fixture) => {
    let reassigned;
    mutateFragment(fixture, 'evidence-browser-relay-providers', (fragment) => {
      reassigned = fragment.values.browser_relay_trusted_source_composition;
      delete fragment.values.browser_relay_trusted_source_composition;
    });
    mutateFragment(fixture, 'evidence-browser-relay-scenario', (fragment) => {
      fragment.values.browser_relay_trusted_source_composition = reassigned;
    });
  }, /evidence-browser-relay-scenario values fields or field order have drifted/u);
  rejectsFixture((fixture) => {
    mutateFragment(fixture, 'evidence-browser-relay-providers', (fragment) => {
      delete fragment.values.browser_relay_trusted_provider_process;
    });
  }, /evidence-browser-relay-providers values fields or field order have drifted/u);
  rejectsFixture((fixture) => {
    mutateFragment(fixture, 'evidence-browser-relay-providers', (fragment) => {
      const process = fragment.values.browser_relay_trusted_provider_process;
      delete fragment.values.browser_relay_trusted_provider_process;
      const composition = fragment.values.browser_relay_trusted_source_composition;
      delete fragment.values.browser_relay_trusted_source_composition;
      fragment.values.browser_relay_trusted_provider_process = process;
      fragment.values.browser_relay_trusted_source_composition = composition;
    });
  }, /evidence-browser-relay-providers values fields or field order have drifted/u);
  rejectsFixture((fixture) => {
    mutateFragment(fixture, 'evidence-browser-relay-providers', (fragment) => {
      delete fragment.values.browser_relay_trusted_provider_owner;
    });
  }, /evidence-browser-relay-providers values fields or field order have drifted/u);
  rejectsFixture((fixture) => {
    mutateFragment(fixture, 'evidence-browser-relay-providers', (fragment) => {
      const owner = fragment.values.browser_relay_trusted_provider_owner;
      delete fragment.values.browser_relay_trusted_provider_owner;
      const process = fragment.values.browser_relay_trusted_provider_process;
      delete fragment.values.browser_relay_trusted_provider_process;
      fragment.values.browser_relay_trusted_provider_owner = owner;
      fragment.values.browser_relay_trusted_provider_process = process;
    });
  }, /evidence-browser-relay-providers values fields or field order have drifted/u);
});

test('accepts the exact aggregate cap and rejects cap plus one with bounded fragments', () => {
  const fixture = createFixture();
  try {
    const maximumBytes = 512 * 1024;
    padBundleTo(fixture, maximumBytes);
    assert.equal(bundleBytes(fixture), maximumBytes);
    const index = readJson(fixture.indexPath);
    assert.ok(index.fragments.every(({ path }) => (
      readFileSync(join(fixture.root, path)).byteLength <= 96 * 1024
    )));
    assert.doesNotThrow(() => loadStagingManifestBundle(fixture.indexPath));

    padBundleTo(fixture, maximumBytes + 1);
    assert.equal(bundleBytes(fixture), maximumBytes + 1);
    assert.throws(
      () => loadStagingManifestBundle(fixture.indexPath),
      (error) => error instanceof StagingManifestBundleError
        && /bundle exceeds 524288 bytes/u.test(error.message),
    );
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});
