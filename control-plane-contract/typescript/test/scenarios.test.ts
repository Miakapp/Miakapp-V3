import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';

import {
  ContractViolation,
  type JsonValue,
  loadAccessTokenFixture,
  loadScenarioFixture,
  parseBoundedJson,
  replayScenarioFixture,
  validateScenarioFixture,
} from '../src/index.js';

const permissiveLimits = {
  maximumBytes: 262_144,
  maximumDepth: 16,
  maximumValues: 16_384,
  maximumStringBytes: 4_096,
  maximumArrayItems: 512,
  maximumObjectEntries: 128,
};

async function mutableFixture(): Promise<Record<string, unknown>> {
  const bytes = await readFile(new URL('../../fixtures/v1/scenarios.json', import.meta.url));
  return JSON.parse(JSON.stringify(parseBoundedJson(bytes, permissiveLimits))) as Record<string, unknown>;
}

async function replay(fixture: ReturnType<typeof validateScenarioFixture>): Promise<void> {
  replayScenarioFixture(fixture, await loadAccessTokenFixture());
}

function scenario(raw: Record<string, unknown>, id: string): Record<string, unknown> {
  const found = (raw.scenarios as Array<Record<string, unknown>>).find((entry) => entry.id === id);
  if (found === undefined) throw new Error(`scenario ${id} missing`);
  return found;
}

function operations(raw: Record<string, unknown>, id: string): Array<Record<string, unknown>> {
  return scenario(raw, id).operations as Array<Record<string, unknown>>;
}

const auditedOperations = new Set([
  'create_home',
  'create_key',
  'revoke_key',
  'exchange',
  'issue_destination_challenge',
  'complete_destination_challenge',
  'create_grant',
  'revoke_grant',
  'delete_destination',
  'send_push',
  'request_upload',
  'deliver_upload',
  'finalize_release',
  'activate_release',
  'quarantine_digest',
]);

function removeOperation(raw: Record<string, unknown>, scenarioId: string, index: number): void {
  const target = scenario(raw, scenarioId);
  const entries = target.operations as Array<Record<string, unknown>>;
  const auditIndex = entries.slice(0, index).filter((entry) => auditedOperations.has(entry.kind as string)).length;
  const [removed] = entries.splice(index, 1);
  if (removed !== undefined && auditedOperations.has(removed.kind as string)) {
    const final = target.expected_final as Record<string, unknown>;
    (final.audit as Array<Record<string, unknown>>).splice(auditIndex, 1);
  }
}

const publicationMutations: Array<[string, unknown]> = [
  ['home_id', 'other-component-home'],
  ['release', '2026-08-31.mutated'],
  ['abi', 'miakapp.component/2'],
  ['requires', {
    state_read: ['global.humidity'],
    event_subscribe: [],
    event_publish: [],
    call: ['lighting.set'],
    presentation: [],
  }],
  ['digest', 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE'],
  ['size', 8_193],
];

describe('control-plane behavioral scenarios', () => {
  test('replays the complete corpus against verified Firebase identities', async () => {
    await expect(replay(await loadScenarioFixture())).resolves.toBeUndefined();
  });

  test('does not accept vacuous push-consent coverage', async () => {
    const fixture = await mutableFixture();
    const push = scenario(fixture, 'push_consent_and_revocation');
    push.operations = (push.operations as Array<Record<string, unknown>>)
      .filter((operation) => operation.kind !== 'create_grant');
    await expect(replay(validateScenarioFixture(fixture as JsonValue))).rejects.toBeInstanceOf(ContractViolation);
  });

  test('binds destination proof to the verified App Check app ID', async () => {
    const fixture = await mutableFixture();
    const wrongApp = operations(fixture, 'push_consent_and_revocation')
      .find((entry) => entry.kind === 'complete_destination_challenge'
        && entry.verified_app_id === 'other-synthetic-app');
    if (wrongApp === undefined) throw new Error('wrong-app completion evidence missing');
    wrongApp.verified_app_id = 'synthetic-app';
    await expect(replay(validateScenarioFixture(fixture as JsonValue))).rejects.toThrow(/operation/);
  });

  test('requires causal expiry of an otherwise valid destination proof', async () => {
    const fixture = await mutableFixture();
    const expired = operations(fixture, 'push_consent_and_revocation')
      .find((entry) => entry.kind === 'complete_destination_challenge'
        && entry.challenge_ref === 'expiring-destination-challenge');
    if (expired === undefined) throw new Error('expired destination-proof evidence missing');
    expired.proof_ref = 'different-synthetic-proof';
    await expect(replay(validateScenarioFixture(fixture as JsonValue)))
      .rejects.toThrow(/does not exercise destination_possession/);
  });

  test('derives recent authentication from a signed Firebase vector', async () => {
    const fixture = await mutableFixture();
    const stale = operations(fixture, 'owner_key_and_lease')
      .find((entry) => entry.kind === 'create_key' && entry.user_token === 'firebase_stale_authentication');
    if (stale === undefined) throw new Error('stale-auth operation missing');
    stale.user_token = 'valid_firebase_verified_email';
    await expect(replay(validateScenarioFixture(fixture as JsonValue))).rejects.toThrow(/operation/);
  });

  test('rejects expiry coverage whose denial was caused by revocation', async () => {
    const fixture = await mutableFixture();
    const push = scenario(fixture, 'push_consent_and_revocation');
    const entries = push.operations as Array<Record<string, unknown>>;
    const grantIndex = entries.findIndex((entry) => entry.kind === 'create_grant' && entry.grant_ref === 'expiring-grant');
    const sendIndex = entries.findIndex((entry, index) => index > grantIndex
      && entry.kind === 'send_push'
      && entry.grant_ref === 'expiring-grant'
      && (entry.expected as Record<string, unknown>).outcome === 'ok');
    if (grantIndex < 0 || sendIndex < 0) throw new Error('expiry evidence missing');
    entries[grantIndex]!.lifetime_seconds = 1_000;
    entries.splice(sendIndex + 1, 0, {
      kind: 'revoke_grant',
      user_token: 'valid_firebase_verified_email',
      home_id: 'push-home',
      grant_id: 'BQUFBQUFBQUFBQUFBQUFBQ',
      expected: { outcome: 'ok', code: null },
    });
    const final = push.expected_final as Record<string, unknown>;
    const audit = final.audit as Array<Record<string, unknown>>;
    const auditableBefore = entries.slice(0, sendIndex + 1).filter((entry) => (
      entry.kind !== 'advance_time' && entry.kind !== 'verify_access'
    )).length;
    audit.splice(auditableBefore, 0, { event: 'push.grant.revoke', outcome: 'ok' });
    await expect(replay(validateScenarioFixture(fixture as JsonValue)))
      .rejects.toThrow(/does not exercise push_expiry/);
  });

  test('rejects expiry coverage whose denial was caused by grant renewal', async () => {
    const fixture = await mutableFixture();
    const push = scenario(fixture, 'push_consent_and_revocation');
    const entries = push.operations as Array<Record<string, unknown>>;
    const grantIndex = entries.findIndex((entry) => entry.kind === 'create_grant'
      && entry.grant_ref === 'expiring-grant');
    const sendIndex = entries.findIndex((entry, index) => index > grantIndex
      && entry.kind === 'send_push'
      && entry.grant_ref === 'expiring-grant'
      && (entry.expected as Record<string, unknown>).outcome === 'ok');
    if (grantIndex < 0 || sendIndex < 0) throw new Error('expiry evidence missing');
    entries.splice(sendIndex + 1, 0, {
      kind: 'create_grant',
      user_token: 'valid_firebase_verified_email',
      home_id: 'push-home',
      destination_ref: 'primary-destination',
      grant_ref: 'expiry-renewal-mutation',
      grant_id: 'BwcHBwcHBwcHBwcHBwcHBw',
      lifetime_seconds: 3_600,
      expected: { outcome: 'ok', code: null },
    });
    const final = push.expected_final as Record<string, unknown>;
    const audit = final.audit as Array<Record<string, unknown>>;
    const auditableBefore = entries.slice(0, sendIndex + 1).filter((entry) => (
      entry.kind !== 'advance_time' && entry.kind !== 'verify_access'
    )).length;
    audit.splice(auditableBefore, 0, { event: 'push.grant.create', outcome: 'ok' });
    await expect(replay(validateScenarioFixture(fixture as JsonValue)))
      .rejects.toThrow(/does not exercise push_expiry/);
  });

  test.each(publicationMutations)('binds publication field %s to the upload record', async (field, value) => {
    const fixture = await mutableFixture();
    const request = operations(fixture, 'component_publication')
      .find((entry) => entry.kind === 'request_upload' && entry.upload_ref === 'rollback-upload');
    if (request === undefined) throw new Error('bound upload missing');
    request[field] = value;
    await expect(replay(validateScenarioFixture(fixture as JsonValue))).rejects.toBeInstanceOf(ContractViolation);
  });

  test('does not accept a false successful delivery-path read-back', async () => {
    const fixture = await mutableFixture();
    const delivery = operations(fixture, 'component_publication')
      .find((entry) => entry.kind === 'deliver_upload' && entry.upload_ref === 'bad-readback-upload');
    if (delivery === undefined) throw new Error('read-back operation missing');
    delivery.artifact_source = 'self.onmessage = () => { self.postMessage("artifact-a"); };\n';
    await expect(replay(validateScenarioFixture(fixture as JsonValue))).rejects.toThrow(/operation/);
  });

  test('requires a successful delivery followed by reuse of the same upload capability', async () => {
    const fixture = await mutableFixture();
    const entries = operations(fixture, 'component_publication');
    const reuse = entries.findIndex((entry) => entry.kind === 'deliver_upload'
      && entry.upload_ref === 'rollback-upload'
      && (entry.expected as Record<string, unknown>).code === 'invalid_upload_capability'
      && entry.capability_ref === 'rollback-capability');
    if (reuse < 0) throw new Error('upload-capability reuse evidence missing');
    removeOperation(fixture, 'component_publication', reuse);
    await expect(replay(validateScenarioFixture(fixture as JsonValue)))
      .rejects.toThrow(/does not exercise publication_upload_binding/);
  });

  test('requires upload and release metadata reads for uncertain-outcome reconciliation', async () => {
    for (const kind of ['inspect_upload', 'inspect_release']) {
      const fixture = await mutableFixture();
      const entries = operations(fixture, 'component_publication');
      const inspection = entries.findIndex((entry) => entry.kind === kind);
      if (inspection < 0) throw new Error(`${kind} reconciliation evidence missing`);
      removeOperation(fixture, 'component_publication', inspection);
      await expect(replay(validateScenarioFixture(fixture as JsonValue)))
        .rejects.toThrow(/does not exercise publication_reconciliation/);
    }
  });

  test('rejects duplicate production identifiers even when fixture references differ', async () => {
    const mutations: Array<{
      kind: string;
      referenceField: string;
      reference: string;
      idField: string;
      duplicateOf: string;
    }> = [
      {
        kind: 'create_key',
        referenceField: 'key_ref',
        reference: 'limit-key-64',
        idField: 'key_id',
        duplicateOf: 'limit-key-63',
      },
      {
        kind: 'complete_destination_challenge',
        referenceField: 'destination_ref',
        reference: 'limit-destination-16',
        idField: 'destination_id',
        duplicateOf: 'limit-destination-15',
      },
      {
        kind: 'create_grant',
        referenceField: 'grant_ref',
        reference: 'limit-grant-16',
        idField: 'grant_id',
        duplicateOf: 'limit-grant-15',
      },
    ];
    for (const mutation of mutations) {
      const fixture = await mutableFixture();
      const entries = operations(fixture, 'bounded_admission');
      const target = entries.find((entry) => entry.kind === mutation.kind
        && entry[mutation.referenceField] === mutation.reference);
      const source = entries.find((entry) => entry.kind === mutation.kind
        && entry[mutation.referenceField] === mutation.duplicateOf);
      if (target === undefined || source === undefined) throw new Error('identifier evidence missing');
      target[mutation.idField] = source[mutation.idField];
      await expect(replay(validateScenarioFixture(fixture as JsonValue))).rejects.toThrow(/repeats/);
    }
  });

  test('requires every named coverage class', async () => {
    const fixture = await mutableFixture();
    (fixture.required_coverage as string[]).pop();
    expect(() => validateScenarioFixture(fixture as JsonValue)).toThrow(/incomplete/);
  });

  test('does not trust a coverage label without causal evidence', async () => {
    const fixture = await mutableFixture();
    const owner = scenario(fixture, 'owner_key_and_lease');
    const push = scenario(fixture, 'push_consent_and_revocation');
    owner.coverage = [...owner.coverage as string[], 'push_cross_home'];
    push.coverage = (push.coverage as string[]).filter((entry) => entry !== 'push_cross_home');
    await expect(replay(validateScenarioFixture(fixture as JsonValue)))
      .rejects.toThrow(/does not exercise push_cross_home/);
  });

  test('requires every success up to an exact admission boundary', async () => {
    const fixture = await mutableFixture();
    const bounded = scenario(fixture, 'bounded_admission');
    bounded.operations = (bounded.operations as Array<Record<string, unknown>>)
      .filter((entry) => !(entry.kind === 'create_key' && entry.key_ref === 'limit-key-64'));
    const homes = (bounded.expected_final as Record<string, unknown>).homes as Array<Record<string, unknown>>;
    const home = homes.find((entry) => entry.home_id === 'limit-home');
    if (home === undefined) throw new Error('limit-home projection missing');
    home.active_keys = 63;
    await expect(replay(validateScenarioFixture(fixture as JsonValue))).rejects.toBeInstanceOf(ContractViolation);
  });

  test('enforces the live challenge ceiling before issuing another FCM challenge', async () => {
    const fixture = await mutableFixture();
    const bounded = scenario(fixture, 'bounded_admission');
    bounded.operations = (bounded.operations as Array<Record<string, unknown>>)
      .filter((entry) => !(entry.kind === 'issue_destination_challenge'
        && entry.challenge_ref === 'pending-limit-challenge-3'));
    await expect(replay(validateScenarioFixture(fixture as JsonValue))).rejects.toThrow(/operation/);
  });

  test('requires a successful Home Key replacement at the retained registry boundary', async () => {
    const fixture = await mutableFixture();
    const entries = operations(fixture, 'bounded_admission');
    const replacement = entries.findIndex((entry) => entry.kind === 'create_key'
      && entry.key_ref === 'post-key-retention-compaction');
    if (replacement < 0) throw new Error('Home Key compaction evidence missing');
    removeOperation(fixture, 'bounded_admission', replacement);
    await expect(replay(validateScenarioFixture(fixture as JsonValue)))
      .rejects.toThrow(/does not exercise admission_limits/);
  });

  test('keeps grant authorization bound to the destination owner', async () => {
    const fixture = await mutableFixture();
    const otherGrant = operations(fixture, 'bounded_admission')
      .find((entry) => entry.kind === 'create_grant' && entry.grant_ref === 'other-user-first-grant');
    if (otherGrant === undefined) throw new Error('cross-user grant evidence missing');
    otherGrant.user_token = 'valid_firebase_verified_email';
    await expect(replay(validateScenarioFixture(fixture as JsonValue))).rejects.toThrow(/operation/);
  });

  test('derives the active-grant boundary instead of counting historical creations', async () => {
    const fixture = await mutableFixture();
    const bounded = scenario(fixture, 'bounded_admission');
    const entries = bounded.operations as Array<Record<string, unknown>>;
    const renewal = entries.findIndex((entry) => entry.kind === 'create_grant'
      && entry.grant_ref === 'renewed-first-grant');
    const revoked = entries.find((entry) => entry.kind === 'create_grant'
      && entry.grant_ref === 'limit-grant-16');
    if (renewal < 0 || revoked === undefined) throw new Error('active-grant boundary evidence missing');
    entries.splice(renewal, 0, {
      kind: 'revoke_grant',
      user_token: 'valid_firebase_verified_email',
      home_id: 'limit-home',
      grant_id: revoked.grant_id,
      expected: { outcome: 'ok', code: null },
    });
    const final = bounded.expected_final as Record<string, unknown>;
    const audit = final.audit as Array<Record<string, unknown>>;
    const auditIndex = entries.slice(0, renewal).filter((entry) => auditedOperations.has(entry.kind as string)).length;
    audit.splice(auditIndex, 0, { event: 'push.grant.revoke', outcome: 'ok' });
    const home = (final.homes as Array<Record<string, unknown>>)
      .find((entry) => entry.home_id === 'limit-home');
    if (home === undefined) throw new Error('limit-home projection missing');
    home.active_grants = 16;
    await expect(replay(validateScenarioFixture(fixture as JsonValue)))
      .rejects.toThrow(/does not exercise admission_limits/);
  });

  test('requires a successful renewal after the retained-grant boundary is reached', async () => {
    const fixture = await mutableFixture();
    const entries = operations(fixture, 'bounded_admission');
    const compacted = entries.findIndex((entry) => entry.kind === 'create_grant'
      && entry.grant_ref === 'post-retention-compaction-grant');
    if (compacted < 0) throw new Error('retention-compaction evidence missing');
    removeOperation(fixture, 'bounded_admission', compacted);
    await expect(replay(validateScenarioFixture(fixture as JsonValue)))
      .rejects.toThrow(/does not exercise admission_limits/);
  });
});
