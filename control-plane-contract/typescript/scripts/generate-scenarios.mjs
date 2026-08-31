import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const target = fileURLToPath(new URL('../../fixtures/v1/scenarios.json', import.meta.url));
const now = 1_788_220_800;
const user = 'valid_firebase_verified_email';
const otherUser = 'valid_firebase_unverified_email';
const staleUser = 'firebase_stale_authentication';
const appId = 'synthetic-app';
const otherAppId = 'other-synthetic-app';
const relay = 'wss://relay.example.test/ws';
const pushAudience = 'https://control.example.test/v1/push';
const componentsAudience = 'https://control.example.test/v1/components';
const ids = Object.freeze({
  zero: 'AAAAAAAAAAAAAAAAAAAAAA',
  one: 'AQEBAQEBAQEBAQEBAQEBAQ',
  two: 'AgICAgICAgICAgICAgICAg',
  three: 'AwMDAwMDAwMDAwMDAwMDAw',
  four: 'BAQEBAQEBAQEBAQEBAQEBA',
  five: 'BQUFBQUFBQUFBQUFBQUFBQ',
  six: 'BgYGBgYGBgYGBgYGBgYGBg',
});
const artifacts = Object.freeze({
  a: 'self.onmessage = () => { self.postMessage("artifact-a"); };\n',
  b: 'self.onmessage = () => { self.postMessage("artifact-b"); };\n',
  c: 'self.onmessage = () => { self.postMessage("artifact-c"); };\n',
  owner: 'self.onmessage = () => { self.postMessage("owner-artifact"); };\n',
  invalid: 'function () {\n',
});
const artifactEvidence = (source) => ({
  digest: createHash('sha256').update(source, 'utf8').digest('base64url'),
  size: Buffer.byteLength(source, 'utf8'),
});
const evidence = Object.freeze({
  a: artifactEvidence(artifacts.a),
  b: artifactEvidence(artifacts.b),
  c: artifactEvidence(artifacts.c),
  owner: artifactEvidence(artifacts.owner),
  invalid: artifactEvidence(artifacts.invalid),
});
const digests = Object.freeze({ a: evidence.a.digest, b: evidence.b.digest });
const requires = Object.freeze({
  state_read: ['global.temperature'],
  event_subscribe: [],
  event_publish: [],
  call: ['lighting.set'],
  presentation: [],
});
function publicationBinding(homeIdValue, release, artifact, publisherPrincipalId) {
  return createHash('sha256').update(JSON.stringify({
    home_id: homeIdValue,
    release,
    abi: 'miakapp.component/1',
    requires,
    digest: artifact.digest,
    size: artifact.size,
    publisher_principal_id: publisherPrincipalId,
  })).digest('base64url');
}
const bindings = Object.freeze({
  a: publicationBinding('component-home', '2026-08-31.1', evidence.a, `home-key:${ids.zero}`),
  b: publicationBinding('component-home', '2026-08-31.rollback', evidence.b, `home-key:${ids.zero}`),
  c: publicationBinding('component-home', '2026-08-31.reconcile', evidence.c, `home-key:${ids.zero}`),
  owner: publicationBinding('component-home', '2026-08-31.owner', evidence.owner, 'owner:syn_user_1'),
  invalid: publicationBinding('component-home', '2026-08-31.invalid', evidence.invalid, `home-key:${ids.zero}`),
});

const events = Object.freeze({
  create_home: 'home.create',
  create_key: 'home_key.create',
  revoke_key: 'home_key.revoke',
  exchange: 'access.exchange',
  issue_destination_challenge: 'push.destination.challenge',
  complete_destination_challenge: 'push.destination.register',
  create_grant: 'push.grant.create',
  revoke_grant: 'push.grant.revoke',
  delete_destination: 'push.destination.delete',
  send_push: 'push.send',
  request_upload: 'component.upload.issue',
  deliver_upload: 'component.upload.deliver',
  finalize_release: 'component.finalize',
  activate_release: 'component.activate',
  quarantine_digest: 'component.quarantine',
});

function operation(kind, fields, outcome = 'ok', code = null, extraExpected = {}) {
  return { kind, ...fields, expected: { outcome, code, ...extraExpected } };
}

function projectedAudit(operations) {
  return operations.flatMap((entry) => {
    const event = events[entry.kind];
    if (event === undefined) return [];
    return [{ event, outcome: entry.expected.outcome === 'ok' ? 'ok' : 'denied' }];
  });
}

function scenario(id, coverage, operations, homes) {
  return { id, coverage, operations, expected_final: { homes, audit: projectedAudit(operations) } };
}

function syntheticId(index) {
  const bytes = Buffer.alloc(16);
  bytes.writeUInt32BE(index, 12);
  return bytes.toString('base64url');
}

const ownerOperations = [
  operation('create_home', { user_token: user, home_id: 'synthetic-home', relay_url: relay }),
  operation('create_key', {
    user_token: otherUser,
    home_id: 'synthetic-home',
    key_ref: 'forbidden-key',
    key_id: ids.one,
    scopes: ['relay:coordinator'],
  }, 'error', 'not_home_owner'),
  operation('create_key', {
    user_token: staleUser,
    home_id: 'synthetic-home',
    key_ref: 'stale-auth-key',
    key_id: ids.two,
    scopes: ['relay:coordinator'],
  }, 'error', 'recent_authentication_required'),
  operation('create_key', {
    user_token: user,
    home_id: 'synthetic-home',
    key_ref: 'primary-key',
    key_id: ids.zero,
    scopes: ['relay:coordinator', 'relay:cli', 'push:send', 'components:publish'],
  }),
  operation('exchange', {
    key_ref: 'primary-key',
    purpose: 'relay',
    role: 'coordinator',
    coordinator_name: 'automation',
    token_ref: 'coordinator-token',
  }, 'ok', null, { scope: 'relay:coordinator', audience: relay, client_id: ids.zero }),
  operation('verify_access', { token_ref: 'coordinator-token' }),
  operation('revoke_key', { user_token: user, home_id: 'synthetic-home', key_id: ids.zero }),
  operation('verify_access', { token_ref: 'coordinator-token' }),
  operation('revoke_key', { user_token: user, home_id: 'synthetic-home', key_id: ids.zero }),
  operation('revoke_key', { user_token: user, home_id: 'synthetic-home', key_id: ids.six }),
  operation('exchange', {
    key_ref: 'primary-key',
    purpose: 'relay',
    role: 'coordinator',
    coordinator_name: 'automation',
  }, 'error', 'invalid_home_key'),
  operation('advance_time', { seconds: 300 }),
  operation('verify_access', { token_ref: 'coordinator-token' }, 'error', 'invalid_access_token'),
];

const scopeOperations = [
  operation('create_home', { user_token: user, home_id: 'scope-home', relay_url: 'wss://scope-relay.example.test/ws' }),
  operation('create_key', {
    user_token: user,
    home_id: 'scope-home',
    key_ref: 'coordinator-only',
    key_id: ids.three,
    scopes: ['relay:coordinator'],
  }),
  operation('exchange', {
    key_ref: 'coordinator-only',
    purpose: 'relay',
    role: 'coordinator',
    coordinator_name: 'automation',
    token_ref: 'attenuated-token',
  }, 'ok', null, {
    scope: 'relay:coordinator',
    audience: 'wss://scope-relay.example.test/ws',
    client_id: ids.three,
  }),
  operation('exchange', { key_ref: 'coordinator-only', purpose: 'push' }, 'error', 'insufficient_scope'),
  operation('exchange', { key_ref: 'coordinator-only', purpose: 'components' }, 'error', 'insufficient_scope'),
];

const pushOperations = [
  operation('create_home', { user_token: user, home_id: 'push-home', relay_url: 'wss://push-relay.example.test/ws' }),
  operation('create_home', { user_token: user, home_id: 'other-home', relay_url: 'wss://other-relay.example.test/ws' }),
  operation('create_key', {
    user_token: user,
    home_id: 'push-home',
    key_ref: 'push-key',
    key_id: ids.one,
    scopes: ['push:send', 'relay:coordinator'],
  }),
  operation('create_key', {
    user_token: user,
    home_id: 'other-home',
    key_ref: 'other-push-key',
    key_id: ids.two,
    scopes: ['push:send'],
  }),
  operation('exchange', {
    key_ref: 'push-key',
    purpose: 'push',
    token_ref: 'push-token',
  }, 'ok', null, { scope: 'push:send', audience: pushAudience, client_id: ids.one }),
  operation('exchange', {
    key_ref: 'other-push-key',
    purpose: 'push',
    token_ref: 'other-push-token',
  }, 'ok', null, { scope: 'push:send', audience: pushAudience, client_id: ids.two }),
  operation('exchange', {
    key_ref: 'push-key',
    purpose: 'relay',
    role: 'coordinator',
    coordinator_name: 'push-automation',
    token_ref: 'relay-token',
  }, 'ok', null, {
    scope: 'relay:coordinator',
    audience: 'wss://push-relay.example.test/ws',
    client_id: ids.one,
  }),
  operation('send_push', { token_ref: 'push-key', grant_ref: 'missing-grant' }, 'error', 'invalid_access_token'),
  operation('send_push', { token_ref: 'relay-token', grant_ref: 'missing-grant' }, 'error', 'invalid_access_token'),
  operation('issue_destination_challenge', {
    user_token: user,
    verified_app_id: appId,
    challenge_ref: 'destination-challenge',
    delivery_address: 'synthetic-fcm-address-1',
    proof_ref: 'delivered-proof',
  }),
  operation('complete_destination_challenge', {
    user_token: otherUser,
    verified_app_id: appId,
    challenge_ref: 'destination-challenge',
    proof_ref: 'delivered-proof',
    destination_ref: 'wrong-user-destination',
    destination_id: ids.three,
  }, 'error', 'invalid_destination_proof'),
  operation('complete_destination_challenge', {
    user_token: user,
    verified_app_id: otherAppId,
    challenge_ref: 'destination-challenge',
    proof_ref: 'delivered-proof',
    destination_ref: 'wrong-app-destination',
    destination_id: ids.three,
  }, 'error', 'invalid_destination_proof'),
  operation('complete_destination_challenge', {
    user_token: user,
    verified_app_id: appId,
    challenge_ref: 'destination-challenge',
    proof_ref: 'wrong-proof',
    destination_ref: 'wrong-proof-destination',
    destination_id: ids.three,
  }, 'error', 'invalid_destination_proof'),
  operation('complete_destination_challenge', {
    user_token: user,
    verified_app_id: appId,
    challenge_ref: 'destination-challenge',
    proof_ref: 'delivered-proof',
    destination_ref: 'primary-destination',
    destination_id: ids.three,
  }),
  operation('complete_destination_challenge', {
    user_token: user,
    verified_app_id: appId,
    challenge_ref: 'destination-challenge',
    proof_ref: 'delivered-proof',
    destination_ref: 'replayed-destination',
    destination_id: ids.four,
  }, 'error', 'invalid_destination_proof'),
  operation('issue_destination_challenge', {
    user_token: user,
    verified_app_id: appId,
    challenge_ref: 'expiring-destination-challenge',
    delivery_address: 'synthetic-fcm-address-expiring',
    proof_ref: 'expiring-delivered-proof',
  }),
  operation('send_push', { token_ref: 'push-token', grant_ref: 'missing-grant' }, 'error', 'invalid_push_grant'),
  operation('create_grant', {
    user_token: user,
    home_id: 'push-home',
    destination_ref: 'primary-destination',
    grant_ref: 'push-grant',
    grant_id: ids.four,
    lifetime_seconds: 3_600,
  }),
  operation('send_push', { token_ref: 'other-push-token', grant_ref: 'push-grant' }, 'error', 'invalid_push_grant'),
  operation('send_push', { token_ref: 'push-token', grant_ref: 'push-grant' }),
  operation('revoke_grant', { user_token: otherUser, home_id: 'push-home', grant_id: ids.four }),
  operation('send_push', { token_ref: 'push-token', grant_ref: 'push-grant' }),
  operation('revoke_grant', { user_token: user, home_id: 'push-home', grant_id: ids.four }),
  operation('revoke_grant', { user_token: user, home_id: 'push-home', grant_id: ids.four }),
  operation('revoke_grant', { user_token: user, home_id: 'push-home', grant_id: ids.six }),
  operation('send_push', { token_ref: 'push-token', grant_ref: 'push-grant' }, 'error', 'invalid_push_grant'),
  operation('create_grant', {
    user_token: user,
    home_id: 'push-home',
    destination_ref: 'primary-destination',
    grant_ref: 'expiring-grant',
    grant_id: ids.five,
    lifetime_seconds: 60,
  }),
  operation('send_push', { token_ref: 'push-token', grant_ref: 'expiring-grant' }),
  operation('advance_time', { seconds: 60 }),
  operation('send_push', { token_ref: 'push-token', grant_ref: 'expiring-grant' }, 'error', 'invalid_push_grant'),
  operation('create_grant', {
    user_token: user,
    home_id: 'push-home',
    destination_ref: 'primary-destination',
    grant_ref: 'destination-grant',
    grant_id: ids.six,
    lifetime_seconds: 3_600,
  }),
  operation('delete_destination', {
    user_token: otherUser,
    verified_app_id: otherAppId,
    destination_id: ids.three,
  }),
  operation('delete_destination', {
    user_token: user,
    verified_app_id: appId,
    destination_id: ids.zero,
  }),
  operation('send_push', { token_ref: 'push-token', grant_ref: 'destination-grant' }),
  operation('delete_destination', {
    user_token: user,
    verified_app_id: appId,
    destination_id: ids.three,
  }),
  operation('delete_destination', {
    user_token: user,
    verified_app_id: appId,
    destination_id: ids.three,
  }),
  operation('send_push', { token_ref: 'push-token', grant_ref: 'destination-grant' }, 'error', 'invalid_push_grant'),
  operation('advance_time', { seconds: 241 }),
  operation('complete_destination_challenge', {
    user_token: user,
    verified_app_id: appId,
    challenge_ref: 'expiring-destination-challenge',
    proof_ref: 'expiring-delivered-proof',
    destination_ref: 'expired-destination',
    destination_id: ids.zero,
  }, 'error', 'invalid_destination_proof'),
  operation('send_push', { token_ref: 'push-token', grant_ref: 'destination-grant' }, 'error', 'invalid_access_token'),
];

const componentOperations = [
  operation('create_home', { user_token: user, home_id: 'component-home', relay_url: 'wss://component-relay.example.test/ws' }),
  operation('create_key', {
    user_token: user,
    home_id: 'component-home',
    key_ref: 'publisher-key',
    key_id: ids.zero,
    scopes: ['components:publish', 'push:send'],
  }),
  operation('create_key', {
    user_token: user,
    home_id: 'component-home',
    key_ref: 'second-publisher-key',
    key_id: ids.one,
    scopes: ['components:publish'],
  }),
  operation('exchange', {
    key_ref: 'publisher-key',
    purpose: 'components',
    token_ref: 'publisher-token',
  }, 'ok', null, { scope: 'components:publish', audience: componentsAudience, client_id: ids.zero }),
  operation('exchange', {
    key_ref: 'publisher-key',
    purpose: 'push',
    token_ref: 'component-home-push-token',
  }, 'ok', null, { scope: 'push:send', audience: pushAudience, client_id: ids.zero }),
  operation('send_push', { token_ref: 'component-home-push-token', grant_ref: 'missing-grant' }, 'error', 'invalid_push_grant'),
  operation('exchange', {
    key_ref: 'second-publisher-key',
    purpose: 'components',
    token_ref: 'second-publisher-token',
  }, 'ok', null, { scope: 'components:publish', audience: componentsAudience, client_id: ids.one }),
  operation('request_upload', {
    user_token: staleUser,
    home_id: 'component-home',
    upload_ref: 'stale-owner-upload',
    capability_ref: 'stale-owner-capability',
    release: '2026-08-31.owner',
    abi: 'miakapp.component/1',
    requires,
    digest: evidence.owner.digest,
    size: evidence.owner.size,
  }, 'error', 'recent_authentication_required'),
  operation('request_upload', {
    user_token: otherUser,
    home_id: 'component-home',
    upload_ref: 'foreign-owner-upload',
    capability_ref: 'foreign-owner-capability',
    release: '2026-08-31.owner',
    abi: 'miakapp.component/1',
    requires,
    digest: evidence.owner.digest,
    size: evidence.owner.size,
  }, 'error', 'not_home_owner'),
  operation('request_upload', {
    user_token: user,
    home_id: 'component-home',
    upload_ref: 'owner-upload',
    capability_ref: 'owner-capability',
    release: '2026-08-31.owner',
    abi: 'miakapp.component/1',
    requires,
    digest: evidence.owner.digest,
    size: evidence.owner.size,
  }, 'ok', null, { binding_id: bindings.owner }),
  operation('deliver_upload', {
    upload_ref: 'owner-upload',
    capability_ref: 'owner-capability',
    artifact_source: artifacts.owner,
  }),
  operation('finalize_release', {
    user_token: user,
    home_id: 'component-home',
    upload_ref: 'owner-upload',
  }, 'ok', null, { binding_id: bindings.owner }),
  operation('request_upload', {
    token_ref: 'publisher-key',
    home_id: 'component-home',
    upload_ref: 'home-key-upload',
    capability_ref: 'home-key-capability',
    release: '2026-08-31.rejected',
    abi: 'miakapp.component/1',
    requires,
    digest: digests.a,
    size: evidence.a.size,
  }, 'error', 'invalid_access_token'),
  operation('request_upload', {
    token_ref: 'publisher-token',
    home_id: 'component-home',
    upload_ref: 'rollback-upload',
    capability_ref: 'rollback-capability',
    release: '2026-08-31.rollback',
    abi: 'miakapp.component/1',
    requires,
    digest: digests.b,
    size: evidence.b.size,
  }, 'ok', null, { binding_id: bindings.b }),
  operation('deliver_upload', {
    upload_ref: 'rollback-upload',
    capability_ref: 'wrong-capability',
    artifact_source: artifacts.b,
  }, 'error', 'invalid_upload_capability'),
  operation('deliver_upload', {
    upload_ref: 'rollback-upload',
    capability_ref: 'rollback-capability',
    artifact_source: artifacts.b,
  }),
  operation('deliver_upload', {
    upload_ref: 'rollback-upload',
    capability_ref: 'rollback-capability',
    artifact_source: artifacts.b,
  }, 'error', 'invalid_upload_capability'),
  operation('finalize_release', {
    token_ref: 'second-publisher-token',
    home_id: 'component-home',
    upload_ref: 'rollback-upload',
  }, 'error', 'publisher_mismatch'),
  operation('finalize_release', {
    token_ref: 'publisher-token',
    home_id: 'component-home',
    upload_ref: 'rollback-upload',
  }, 'ok', null, { binding_id: bindings.b }),
  operation('activate_release', {
    token_ref: 'publisher-token',
    home_id: 'component-home',
    digest: digests.b,
    expected_generation: 0,
    generation: 1,
  }),
  operation('request_upload', {
    token_ref: 'publisher-token',
    home_id: 'component-home',
    upload_ref: 'bad-readback-upload',
    capability_ref: 'bad-readback-capability',
    release: '2026-08-31.1',
    abi: 'miakapp.component/1',
    requires,
    digest: digests.a,
    size: evidence.a.size,
  }, 'ok', null, { binding_id: bindings.a }),
  operation('deliver_upload', {
    upload_ref: 'bad-readback-upload',
    capability_ref: 'bad-readback-capability',
    artifact_source: artifacts.b,
  }),
  operation('finalize_release', {
    token_ref: 'publisher-token',
    home_id: 'component-home',
    upload_ref: 'bad-readback-upload',
  }, 'error', 'invalid_artifact'),
  operation('request_upload', {
    token_ref: 'publisher-token',
    home_id: 'component-home',
    upload_ref: 'invalid-syntax-upload',
    capability_ref: 'invalid-syntax-capability',
    release: '2026-08-31.invalid',
    abi: 'miakapp.component/1',
    requires,
    digest: evidence.invalid.digest,
    size: evidence.invalid.size,
  }, 'ok', null, { binding_id: bindings.invalid }),
  operation('deliver_upload', {
    upload_ref: 'invalid-syntax-upload',
    capability_ref: 'invalid-syntax-capability',
    artifact_source: artifacts.invalid,
  }),
  operation('finalize_release', {
    token_ref: 'publisher-token',
    home_id: 'component-home',
    upload_ref: 'invalid-syntax-upload',
  }, 'error', 'invalid_artifact'),
  operation('request_upload', {
    token_ref: 'publisher-token',
    home_id: 'component-home',
    upload_ref: 'active-upload',
    capability_ref: 'active-capability',
    release: '2026-08-31.1',
    abi: 'miakapp.component/1',
    requires,
    digest: digests.a,
    size: evidence.a.size,
  }, 'ok', null, { binding_id: bindings.a }),
  operation('deliver_upload', {
    upload_ref: 'active-upload',
    capability_ref: 'active-capability',
    artifact_source: artifacts.a,
  }),
  operation('finalize_release', {
    token_ref: 'publisher-token',
    home_id: 'component-home',
    upload_ref: 'active-upload',
  }, 'ok', null, { binding_id: bindings.a }),
  operation('activate_release', {
    token_ref: 'publisher-token',
    home_id: 'component-home',
    digest: digests.a,
    expected_generation: 1,
    generation: 2,
  }),
  operation('activate_release', {
    token_ref: 'publisher-token',
    home_id: 'component-home',
    digest: digests.b,
    expected_generation: 1,
    generation: 3,
  }, 'error', 'generation_conflict'),
  operation('quarantine_digest', { digest: digests.a }),
  operation('activate_release', {
    token_ref: 'publisher-token',
    home_id: 'component-home',
    digest: digests.a,
    expected_generation: 2,
    generation: 3,
  }, 'error', 'digest_quarantined'),
  operation('activate_release', {
    token_ref: 'publisher-token',
    home_id: 'component-home',
    digest: digests.b,
    expected_generation: 2,
    generation: 3,
  }),
  operation('request_upload', {
    token_ref: 'publisher-token',
    home_id: 'component-home',
    upload_ref: 'reconciliation-upload',
    capability_ref: 'reconciliation-capability',
    release: '2026-08-31.reconcile',
    abi: 'miakapp.component/1',
    requires,
    digest: evidence.c.digest,
    size: evidence.c.size,
  }, 'ok', null, { binding_id: bindings.c }),
  operation('deliver_upload', {
    upload_ref: 'reconciliation-upload',
    capability_ref: 'reconciliation-capability',
    artifact_source: artifacts.c,
  }),
  operation('inspect_upload', {
    token_ref: 'publisher-token',
    home_id: 'component-home',
    upload_ref: 'reconciliation-upload',
  }, 'ok', null, { binding_id: bindings.c, status: 'delivered' }),
  operation('advance_time', { seconds: 901 }),
  operation('exchange', {
    key_ref: 'publisher-key',
    purpose: 'components',
    token_ref: 'publisher-token-refreshed',
  }, 'ok', null, { scope: 'components:publish', audience: componentsAudience, client_id: ids.zero }),
  operation('finalize_release', {
    token_ref: 'publisher-token-refreshed',
    home_id: 'component-home',
    upload_ref: 'reconciliation-upload',
  }, 'ok', null, { binding_id: bindings.c }),
  operation('inspect_release', {
    token_ref: 'publisher-token-refreshed',
    home_id: 'component-home',
    digest: evidence.c.digest,
  }, 'ok', null, { binding_id: bindings.c, status: 'finalized' }),
];

const limitHomeIds = Array.from({ length: 16 }, (_, index) => (
  index === 0 ? 'limit-home' : `limit-home-${String(index + 1).padStart(2, '0')}`
));
const limitOperations = [];
for (const [index, home] of limitHomeIds.entries()) {
  limitOperations.push(operation('create_home', {
    user_token: user,
    home_id: home,
    relay_url: `wss://limit-relay-${index + 1}.example.test/ws`,
  }));
}
limitOperations.push(operation('create_home', {
  user_token: user,
  home_id: 'seventeenth-home',
  relay_url: 'wss://overflow-relay.example.test/ws',
}, 'error', 'limit_exceeded'));

for (let index = 0; index < 64; index += 1) {
  limitOperations.push(operation('create_key', {
    user_token: user,
    home_id: 'limit-home',
    key_ref: `limit-key-${index + 1}`,
    key_id: syntheticId(1_000 + index),
    scopes: ['relay:coordinator'],
  }));
}
limitOperations.push(operation('create_key', {
  user_token: user,
  home_id: 'limit-home',
  key_ref: 'sixty-fifth-key',
  key_id: syntheticId(1_064),
  scopes: ['relay:coordinator'],
}, 'error', 'limit_exceeded'));
limitOperations.push(operation('revoke_key', {
  user_token: user,
  home_id: 'limit-home',
  key_id: syntheticId(1_000),
}));
limitOperations.push(operation('create_key', {
  user_token: user,
  home_id: 'limit-home',
  key_ref: 'post-key-retention-compaction',
  key_id: syntheticId(1_064),
  scopes: ['relay:coordinator'],
}));

for (let index = 0; index < 16; index += 1) {
  limitOperations.push(operation('issue_destination_challenge', {
    user_token: user,
    verified_app_id: appId,
    challenge_ref: `limit-challenge-${index + 1}`,
    delivery_address: `synthetic-fcm-address-${index + 1}`,
    proof_ref: `limit-proof-${index + 1}`,
  }));
  limitOperations.push(operation('complete_destination_challenge', {
    user_token: user,
    verified_app_id: appId,
    challenge_ref: `limit-challenge-${index + 1}`,
    proof_ref: `limit-proof-${index + 1}`,
    destination_ref: `limit-destination-${index + 1}`,
    destination_id: syntheticId(2_000 + index),
  }));
}
limitOperations.push(operation('issue_destination_challenge', {
  user_token: user,
  verified_app_id: appId,
  challenge_ref: 'destination-overflow-challenge',
  delivery_address: 'synthetic-fcm-address-destination-overflow',
  proof_ref: 'destination-overflow-proof',
}));
limitOperations.push(operation('complete_destination_challenge', {
  user_token: user,
  verified_app_id: appId,
  challenge_ref: 'destination-overflow-challenge',
  proof_ref: 'destination-overflow-proof',
  destination_ref: 'seventeenth-destination',
  destination_id: syntheticId(2_016),
}, 'error', 'limit_exceeded'));
for (let index = 0; index < 3; index += 1) {
  limitOperations.push(operation('issue_destination_challenge', {
    user_token: user,
    verified_app_id: appId,
    challenge_ref: `pending-limit-challenge-${index + 1}`,
    delivery_address: `synthetic-fcm-address-pending-${index + 1}`,
    proof_ref: `pending-limit-proof-${index + 1}`,
  }));
}
limitOperations.push(operation('issue_destination_challenge', {
  user_token: user,
  verified_app_id: appId,
  challenge_ref: 'fifth-live-challenge',
  delivery_address: 'synthetic-fcm-address-live-overflow',
  proof_ref: 'live-overflow-proof',
}, 'error', 'limit_exceeded'));

for (let index = 0; index < 16; index += 1) {
  limitOperations.push(operation('create_grant', {
    user_token: user,
    home_id: 'limit-home',
    destination_ref: `limit-destination-${index + 1}`,
    grant_ref: `limit-grant-${index + 1}`,
    grant_id: syntheticId(3_000 + index),
    lifetime_seconds: 3_600,
  }));
}
for (let index = 0; index < 241; index += 1) {
  limitOperations.push(operation('create_grant', {
    user_token: user,
    home_id: 'limit-home',
    destination_ref: 'limit-destination-1',
    grant_ref: index === 0
      ? 'renewed-first-grant'
      : index === 240 ? 'post-retention-compaction-grant' : `retained-renewal-${index + 1}`,
    grant_id: syntheticId(3_016 + index),
    lifetime_seconds: 3_600,
  }));
}

limitOperations.push(operation('issue_destination_challenge', {
  user_token: otherUser,
  verified_app_id: otherAppId,
  challenge_ref: 'other-user-limit-challenge',
  delivery_address: 'synthetic-fcm-address-other-user',
  proof_ref: 'other-user-limit-proof',
}));
limitOperations.push(operation('complete_destination_challenge', {
  user_token: otherUser,
  verified_app_id: otherAppId,
  challenge_ref: 'other-user-limit-challenge',
  proof_ref: 'other-user-limit-proof',
  destination_ref: 'other-user-limit-destination',
  destination_id: syntheticId(4_000),
}));
limitOperations.push(operation('create_grant', {
  user_token: otherUser,
  home_id: 'limit-home',
  destination_ref: 'other-user-limit-destination',
  grant_ref: 'other-user-first-grant',
  grant_id: syntheticId(4_001),
  lifetime_seconds: 3_600,
}));

const limitHomeProjection = limitHomeIds.map((home) => ({
  home_id: home,
  active_keys: home === 'limit-home' ? 64 : 0,
  active_grants: home === 'limit-home' ? 17 : 0,
  generation: 0,
  active_digest: null,
}));

const fixture = {
  schema: 'miakapp.control-plane-scenarios/1',
  fixture_version: 1,
  provenance: { kind: 'hand_authored_synthetic', contains_production_data: false },
  clock: { start_seconds: now },
  required_coverage: [
    'owner_bootstrap',
    'recent_authentication',
    'home_key_scope',
    'home_key_revocation',
    'uniform_revocation',
    'access_lease',
    'resource_token_authority',
    'destination_possession',
    'push_consent',
    'push_cross_home',
    'push_expiry',
    'push_revocation',
    'publication_upload_binding',
    'publication_readback',
    'publication_owner_authority',
    'publication_reconciliation',
    'publication_cas',
    'digest_quarantine',
    'admission_limits',
  ],
  scenarios: [
    scenario(
      'owner_key_and_lease',
      ['owner_bootstrap', 'recent_authentication', 'home_key_revocation', 'access_lease'],
      ownerOperations,
      [{ home_id: 'synthetic-home', active_keys: 0, active_grants: 0, generation: 0, active_digest: null }],
    ),
    scenario(
      'scope_attenuation',
      ['home_key_scope'],
      scopeOperations,
      [{ home_id: 'scope-home', active_keys: 1, active_grants: 0, generation: 0, active_digest: null }],
    ),
    scenario(
      'push_consent_and_revocation',
      ['destination_possession', 'push_consent', 'push_cross_home', 'push_expiry', 'push_revocation', 'uniform_revocation'],
      pushOperations,
      [
        { home_id: 'other-home', active_keys: 1, active_grants: 0, generation: 0, active_digest: null },
        { home_id: 'push-home', active_keys: 1, active_grants: 0, generation: 0, active_digest: null },
      ],
    ),
    scenario(
      'component_publication',
      [
        'resource_token_authority',
        'publication_upload_binding',
        'publication_readback',
        'publication_owner_authority',
        'publication_reconciliation',
        'publication_cas',
        'digest_quarantine',
      ],
      componentOperations,
      [{ home_id: 'component-home', active_keys: 2, active_grants: 0, generation: 3, active_digest: digests.b }],
    ),
    scenario(
      'bounded_admission',
      ['admission_limits'],
      limitOperations,
      limitHomeProjection,
    ),
  ],
};

const output = `${JSON.stringify(fixture, null, 2)}\n`;
if (process.argv.includes('--check')) {
  const current = await readFile(target, 'utf8').catch(() => '');
  if (current !== output) {
    console.error('scenarios.json is not the deterministic generator output');
    process.exitCode = 1;
  }
} else {
  await writeFile(target, output, { encoding: 'utf8', mode: 0o644 });
}
