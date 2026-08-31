import {
  createHmac,
  createPrivateKey,
  sign,
} from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const target = fileURLToPath(new URL('../../fixtures/v1/access-tokens.json', import.meta.url));
const now = 1_788_220_800;
const issuer = 'https://control.example.test';
const relayAudience = 'wss://relay.example.test/ws';
const pushAudience = 'https://control.example.test/v1/push';
const componentsAudience = 'https://control.example.test/v1/components';
const firebaseProject = 'demo-miakapp-control-plane';
const homeId = 'synthetic-home';
const clientId = 'AAAAAAAAAAAAAAAAAAAAAA';

const privateKeys = Object.freeze({
  current: {
    crv: 'Ed25519',
    d: 'eTONNVMyfZhGceC143yTxJ5eUXemyU78ztRQltDdF4s',
    x: 'LspVpQRP6Myl_PxrUKHoDAB9z8skYgzOmUXFdLzVgj8',
    kty: 'OKP',
  },
  future: {
    crv: 'Ed25519',
    d: 'HAAOF_7JF7v7_QyF0lIiqYKCrm0CJYya2_JLoH1X4wo',
    x: '2lmLWUpNb1CKDEZu9iOS40SlybDpEN5axZF2x2nPntg',
    kty: 'OKP',
  },
  firebase: {
    kty: 'RSA',
    n: 'xzZSrtUYt36BoOGCgFbgpdxEDPxNb47OVJlCrfgxYYpZKpdZgqtrcO_joyRuQA6jUlxaBWeRh-VWSA9MtVoVWx_pk_o05Ds6nFEnfRZAdt3dVyWvyDFqcuP6EDFmlzXKdIKI8vpMEhXaMLBi4L9bRDVvduliIIee5xxbePL2UJXrgyHaH51txsjec3LDbUa135bOFXCkAPrhvlbg8qSL9lrhVzXI4iU9E9mdFx8bq18rfUFNwHzcLpqOvybuwhs8qCypF-2GNHlNeHylFn8bQhlnQspuqe4Ss7OZXVQzOYse-rMzbbUi4nCjKeyeAQEwXDrcPEVlTZlGxEbepCrIdw',
    e: 'AQAB',
    d: 'A1syY5_yFu9CR0goqS5jmAsULbyn-H_w8fhYkMNJ-oVWdOU9rK7fwpfBcB8qqQlYTfbrqXtfSCuIJFPlYmYI5LHsh9odgXTLyyqLrs4HYAIhClBYpNfDDFJFtccHA5aKWE_AwoAKSFTS4k7Wc-cHoeqN7pwuDNbNwOUa7bHm5mTqPi1dZ8cEFpQmfQA5vW-lcoNgfLngpo_1FFMzlZz7mvpVYBw8ZlcO--Ceu8a7VoDfAKpiqzcRNVkSy3ZljMYpZ5QfSMJ7Y19TZXmim8EUZ1CCpdUhcUJ__277Hc_fFlNJhUSKLenAw_BROPdEE6crKzfTsbMMhHVjKaLVo28vIQ',
    p: '8oFLQzycu5tA8SgoZC_Z-VdSIQZ-19_thhrGUjhssAcFxBjcKksnC7G0PMaW1CeZcyTKUnrT_h8wG5SAg78PVZKZJmG-RmMUSCaOefzMAoLRa7_hhKCxtpyBf_oNygljn3WLQV0J9DC7zl4AH8-uYro6PtGE6K8rHZxiWlrWxhs',
    q: '0kxIYAgxl7Rh0LFhj8i6YxAvIR83vP8bvHDgDIH-ZXVDUL2LdDoGVCLzCr134xlTjdbxllsZd4AABO9nFjOH9a3tQRup040o3TD5wfrQtJ9QKX_DYLw9w1p-nJwdRJr17s9R1vP3YJtC34AMxl3KbQLxW1gcdYFuN3QV7yY3HNU',
    dp: '3nyO73YJmfm7oEUmoZxhUGizugb6ktYoVlP0RfTsiqc2vA3O2KKwhQMZiHTuZmCaYVCMqxVzr38vpO4e5kCBMhJYniUo6-z066ksKHEtPtSEjGWz4vmHcjGughqJUiZBF0hBZcuVWUro01HcrVLd_Eg9LesOFGi5luYmOh2DVKc',
    dq: 'Zq00ER8vB4Dc2UYh-k_pIQD_4c4aKr7rzd_WpIS7rtHIIh3Jft_twxqlS7MiW9E7yF8P6XdlQcFPQRmaXW6fjUZ0NnvJOS8MqqKE7z8Es4utWfW1cP-3sC_47YITkDGQrh6vOKI5QAPObM1ab2fPs9Xh_dVRX9Xn-E9HflJMSlk',
    qi: 'gFfz8mU4fOdWjEvoy4EWnnDOjXX-2c-OIKHMxzdoVMdtpguv6m7AdFQNg1Ar2RzMmAfmu-2fnUwDd1DrjcZqT3JqZmQjqpkkoXP3RXeTn_euueHh-iyKRmuDPoGg-4dPV_PZM7aQY9qxA9j0R1q4SkB4UCyB3IPV0NnJXNq9vuU',
  },
  firebase3072: {
    kty: 'RSA',
    n: 'pqtyDB9v8fylPF2MEnvx0B-eplz6yaauLzs3v7g1nBuCZF1GlREDVK2MilxPeqiA3DbqYVhrbpFQOvsxKEDhFkYuhKSGCaF-J5ADxPYPkg2mnxkxogm6gKd0W1RJ5BZKV966AZA9K7UO2br6ALCR0a_kCEPxnlaLhEcMA1KuT_XwvvXHN68La93FoW-mJUp5HJDKtRFllLDglCETrs6Q_vSXHPqerEoCof4q8_WWeeqP3ipKMkZC6YWGjlQawN3EL43B9PiYkEO71ZMPemi9cTo0sxbNvBma52DobjoRd4XxPh9fS1UT8Tk5mWtkd1U_TX3N4medD_AHD2InC5UqrRmf9XZrVT3FFS8_7vfoFCok32w1NAPDbR71bagjilZQgb-wzO2ZRBtZ6Oo-O8M2SGnBEDSVfhqjtKCl0Xf0DX8hM6iEB-BK2lf-tVpC4qygbQeR-lYllf-ByaGqSKX3n9LxIwiQW-W1HS0h0PiqkA0ffeS79MbJwYOPOEs7EjCD',
    e: 'AQAB',
    d: 'NYnFLNe8YgNCIM37_MQLvUsq703W0YfVVB61ncRSlD7R9-NulNvOMhk9mARnE4OlQRfy2ipI-E99cjTWaZPNuhX5Q2qGE_noSFUeoNpZzhTMfTbelqqBWmpwGhZNVhNC9k75eR8YRz3180L4o9gUP0M9ANqydqZeUrNvzHF2xQC_wNe6ksyL4q5umZj_yeLOXLq2Isvf0Y-v1GV7qR95vCxdjlWDOtzbU6YNrigpmiga5sa25sdjHxhhTL7_iQyzP7wxzmuox8m7hymbLXfwxFZIzDLh6aTHYnAn8_NTT_mKOFofuTuS0bZedoPKvqTJE0P6IKobEQLRgDq6IBk8_MkNlwLrxBWOLnbAl1B7RvzM9Ghz2hwb9WBUd8qxlr1gTtulmdfuYJOONWt6mHp38LUf7Hysswc89z06bSPyqOZwM3PDl67jSUaQcp3uXu_HEZoQuEPaXdHUD7zZQO9NfYAM4qmMxgOnU1LqDI1wscgEPCF9Lls1oZp1yXFnW0dB',
    p: '1XL9RCLLvGeWoc8p01_xXyYZsBrgzlRXIm9H3ENbV5X8B_gL3CHzAKX8QYdbVIjLY0CcP6q4oBoa6eqXJy8RZ2UV8-99BxKX1PCApFrH_A7YfkWdYX21V0Avhw1PzRFlgsmJCh2xuu7X6Cu0uCmEDcF-AZ4AKTk97qZ46qq4zz-KzFBgfzj016qunI7qJrYauAYm9nPPcIUBDPFuqhMLJ0-slTJglLIuCS-oStCPtKjkv7XwSLFvF9puy7Tw5en5',
    q: 'x-UljYDuM8yKK8Y0EuIZmgr-6lOmJil0IOG9tIIHjx8Qktwsh26E7lK9KY6COTpiyuaxQ1lgC6jyezga4Adhbn2YEAQZqDAcUtCV-EAwTFi7tIFOZCgabBumVL0_m9EEVdXy94VVmvQAUBtL1lOZSTycV9XBEFhsW8Qpwnx9MM9buBbsFtnjEZZhvUVTz5aHPy6gWLU2wJgBX-sHQnCzA_L33LQYiGZj7DkLNjJBfN9deJrDgJfb_ZDpHrjQwW1b',
    dp: 'gADzjVboo1Xj6amYxaA12f-5S_jydAn0LzxY9eiW8JGLkSPZyOu7FNp1yr5nsOxQPHdUvIGfMrQ1C66ZcvAxGbZvUdh_PCyUTSjlnKqsX6ZvgloxJXQDug1N80myX6JdI-_EdQKVwSrW4-7B8-dBwBYXgNTF9_LSBzpiLSiwp-jNTfWtyN3ZRzSefljeZtSydUWLPCT7c9jvZlmrKec9uxd2wgpyDPpFzVB9NlCYvZjDhYyQSqfNnZpq81LRXK_R',
    dq: 'ahhVNiWYSCXnsBQiz2Lx87CiW_zJ0rdty4YFCil5mZ0DTu9NMxSVuWhwvf3FYFp81PRcYUKul4G0MXI10XIZZGuEqfuDIqFmZw4OixSGjf8KoWOAF-ixHXAPeCp5-FmX03ca3gUGypd3Ew1p0vfMA_MHiBcLwYEtAge7ol4wlBd6ttpztC0xN8R5W9vP__4FCqPUt0B3LwF-uUolMD5gxVfP9nQgEUVHA7nDGaDS4VQsaDa8TSRMvuiK0qOFKSTB',
    qi: 'insYZWwzqT-uWIPw3gbX5QlTy3FGtUMqInV2v578BLLYQGlLVhJZQvh0tqH3KmP0GOEd1KLqI_iH5rQlWd0byvdjqfHCHs7FSTgmMYxgROeOM5Cw_KMbJo7VgZJfmZxF8zcPpf9ivqeQH_Y2P8q9Esxk11rCXgpqjDMfavLesE3brWvLRfGZldVDsnsoYqbdwBRIGJdUuA8HHke8SGYd37nL4jyGBX3ZLlsyoUnRMCxJuN1okLu_jxT70iXQBlRM',
  },
});

const keyIds = Object.freeze({
  current: 'test-current-2026-09',
  future: 'test-future-2026-10',
  firebase: 'test-firebase-rs256',
  firebase3072: 'test-firebase-rs256-3072',
});

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

function publicJwk(name) {
  const source = privateKeys[name];
  if (source.kty === 'OKP') {
    return {
      kty: 'OKP',
      crv: 'Ed25519',
      x: source.x,
      use: 'sig',
      alg: 'EdDSA',
      kid: keyIds[name],
    };
  }
  return {
    kty: 'RSA',
    n: source.n,
    e: source.e,
    use: 'sig',
    alg: 'RS256',
    kid: keyIds[name],
  };
}

function compact(header, payload, keyName, rawPayload) {
  const encodedHeader = base64url(JSON.stringify(header));
  const payloadText = rawPayload ?? JSON.stringify(payload);
  const encodedPayload = base64url(payloadText);
  const input = `${encodedHeader}.${encodedPayload}`;
  const algorithm = keyName.startsWith('firebase') ? 'RSA-SHA256' : null;
  const signature = sign(
    algorithm,
    Buffer.from(input, 'ascii'),
    createPrivateKey({ key: privateKeys[keyName], format: 'jwk' }),
  );
  return `${input}.${signature.toString('base64url')}`;
}

function accessHeader(keyName = 'current', overrides = {}) {
  return {
    alg: 'EdDSA',
    kid: keyIds[keyName],
    typ: 'at+jwt',
    ...overrides,
  };
}

function accessClaims(profile, sequence, overrides = {}) {
  const common = {
    iss: issuer,
    sub: homeId,
    aud: profile === 'coordinator' || profile === 'cli'
      ? relayAudience
      : profile === 'push'
        ? pushAudience
        : componentsAudience,
    exp: now + 300,
    iat: now,
    jti: Buffer.alloc(16, sequence).toString('base64url'),
    client_id: clientId,
    scope: profile === 'coordinator'
      ? 'relay:coordinator'
      : profile === 'cli'
        ? 'relay:cli'
        : profile === 'push'
          ? 'push:send'
          : 'components:publish',
  };
  const profileClaims = profile === 'coordinator'
    ? { miakapp_role: 'coordinator', miakapp_coordinator: 'automation' }
    : profile === 'cli'
      ? { miakapp_role: 'cli' }
      : {};
  return { ...common, ...profileClaims, ...overrides };
}

function expectedAccess(profile) {
  return {
    home_id: homeId,
    principal_id: homeId,
    client_id: clientId,
    scope: profile === 'coordinator'
      ? 'relay:coordinator'
      : profile === 'cli'
        ? 'relay:cli'
        : profile === 'push'
          ? 'push:send'
          : 'components:publish',
    expires_at: now + 300,
    role: profile === 'coordinator' ? 'coordinator' : profile === 'cli' ? 'cli' : null,
    coordinator_name: profile === 'coordinator' ? 'automation' : null,
  };
}

function validAccess(id, profile, sequence, keyName = 'current', keySet = 'rotated') {
  return {
    id,
    kind: 'miakapp',
    profile,
    key_set: keySet,
    token: compact(accessHeader(keyName), accessClaims(profile, sequence), keyName),
    valid: true,
    expected: expectedAccess(profile),
  };
}

function invalidAccess(id, profile, sequence, error, claimOverrides = {}, headerOverrides = {}, keyName = 'current', keySet = 'rotated') {
  return {
    id,
    kind: 'miakapp',
    profile,
    key_set: keySet,
    token: compact(
      accessHeader(keyName, headerOverrides),
      accessClaims(profile, sequence, claimOverrides),
      keyName,
    ),
    valid: false,
    error,
  };
}

function firebaseHeader(overrides = {}, keyName = 'firebase') {
  return { alg: 'RS256', kid: keyIds[keyName], typ: 'JWT', ...overrides };
}

function firebaseClaims(sequence, overrides = {}) {
  return {
    iss: `https://securetoken.google.com/${firebaseProject}`,
    aud: firebaseProject,
    auth_time: now - 60,
    sub: `syn_user_${sequence}`,
    iat: now - 30,
    exp: now + 3_600,
    email: `synthetic-${sequence}@example.test`,
    email_verified: true,
    firebase: { sign_in_provider: 'password', identities: {} },
    ...overrides,
  };
}

function validFirebase(id, sequence, overrides = {}, expectedOverrides = {}, keyName = 'firebase') {
  const claims = firebaseClaims(sequence, overrides);
  return {
    id,
    kind: 'firebase',
    profile: 'user',
    key_set: 'firebase',
    token: compact(firebaseHeader({}, keyName), claims, keyName),
    valid: true,
    expected: {
      user_id: claims.sub,
      verified_email: claims.email_verified === true ? claims.email : null,
      authenticated_at: claims.auth_time,
      expires_at: claims.exp,
      ...expectedOverrides,
    },
  };
}

function invalidFirebase(id, sequence, error, overrides = {}, headerOverrides = {}, keyName = 'firebase') {
  return {
    id,
    kind: 'firebase',
    profile: 'user',
    key_set: 'firebase',
    token: compact(firebaseHeader(headerOverrides, keyName), firebaseClaims(sequence, overrides), keyName),
    valid: false,
    error,
  };
}

const validCoordinator = validAccess('valid_coordinator', 'coordinator', 1);
const futureToken = validAccess('valid_future_after_rotation', 'coordinator', 5, 'future', 'rotated');
const retiringToken = validAccess('valid_retiring_during_overlap', 'coordinator', 6, 'current');

const wrongSignatureParts = validCoordinator.token.split('.');
const signatureBytes = Buffer.from(wrongSignatureParts[2], 'base64url');
signatureBytes[0] ^= 0x80;
const wrongSignature = `${wrongSignatureParts[0]}.${wrongSignatureParts[1]}.${signatureBytes.toString('base64url')}`;

const duplicatePayload = `{"iss":"${issuer}","sub":"${homeId}","aud":"${relayAudience}","aud":"${pushAudience}","exp":${now + 300},"iat":${now},"jti":"${Buffer.alloc(16, 15).toString('base64url')}","client_id":"${clientId}","scope":"relay:coordinator","miakapp_role":"coordinator","miakapp_coordinator":"automation"}`;
const unpairedSurrogatePayload = `{"iss":"${issuer}","sub":"${homeId}","aud":"${relayAudience}","exp":${now + 300},"iat":${now},"jti":"${Buffer.alloc(16, 19).toString('base64url')}","client_id":"${clientId}","scope":"relay:coordinator","miakapp_role":"coordinator","miakapp_coordinator":"\\ud800"}`;
const decimalIntegerPayload = JSON.stringify(accessClaims('coordinator', 22))
  .replace(`"exp":${now + 300}`, `"exp":${now + 300}.0`);
const exponentIntegerPayload = JSON.stringify(accessClaims('coordinator', 23))
  .replace(`"exp":${now + 300}`, `"exp":${now + 300}e0`);

const vectors = [
  validCoordinator,
  validAccess('valid_cli', 'cli', 2),
  validAccess('valid_push', 'push', 3),
  validAccess('valid_components', 'components', 4),
  retiringToken,
  futureToken,
  {
    ...futureToken,
    id: 'unknown_future_before_rotation',
    key_set: 'initial',
    verification_time: now - 61,
    valid: false,
    error: 'unknown_kid',
    expected: undefined,
  },
  {
    ...retiringToken,
    id: 'retiring_removed_after_overlap',
    key_set: 'retired',
    verification_time: now + 330,
    valid: false,
    error: 'unknown_kid',
    expected: undefined,
  },
  invalidAccess('wrong_issuer', 'coordinator', 7, 'invalid_issuer', { iss: 'https://other.example.test' }),
  invalidAccess('wrong_audience', 'coordinator', 8, 'invalid_audience', { aud: 'wss://other-relay.example.test/ws' }),
  invalidAccess('audience_array', 'coordinator', 9, 'invalid_audience', { aud: [relayAudience] }),
  invalidAccess('expired', 'coordinator', 10, 'expired', { iat: now - 600, exp: now }),
  invalidAccess('overlong_ttl', 'coordinator', 11, 'invalid_time', { exp: now + 301 }),
  invalidAccess('future_iat', 'coordinator', 12, 'invalid_time', { iat: now + 31, exp: now + 300 }),
  invalidAccess('future_iat_full_ttl', 'coordinator', 21, 'invalid_time', { iat: now + 30, exp: now + 330 }),
  invalidAccess('multiple_scopes', 'coordinator', 13, 'invalid_scope', { scope: 'relay:coordinator push:send' }),
  invalidAccess('role_scope_mismatch', 'coordinator', 14, 'invalid_profile', { miakapp_role: 'cli' }),
  invalidAccess('missing_coordinator', 'coordinator', 15, 'invalid_profile', { miakapp_coordinator: undefined }),
  invalidAccess('overlong_coordinator', 'coordinator', 24, 'invalid_profile', { miakapp_coordinator: 'a'.repeat(65) }),
  invalidAccess('wrong_type', 'coordinator', 16, 'invalid_header', {}, { typ: 'JWT' }),
  invalidAccess('algorithm_confusion', 'coordinator', 17, 'invalid_header', {}, { alg: 'HS256' }),
  invalidAccess('algorithm_none', 'coordinator', 18, 'invalid_header', {}, { alg: 'none' }),
  invalidAccess('unknown_claim', 'coordinator', 19, 'invalid_claims', { unexpected: true }),
  invalidAccess('unsafe_integer', 'coordinator', 20, 'invalid_claims', { exp: Number.MAX_SAFE_INTEGER + 1 }),
  {
    id: 'integer_decimal_lexeme',
    kind: 'miakapp',
    profile: 'coordinator',
    key_set: 'rotated',
    token: compact(accessHeader(), {}, 'current', decimalIntegerPayload),
    valid: true,
    expected: expectedAccess('coordinator'),
  },
  {
    id: 'integer_exponent_lexeme',
    kind: 'miakapp',
    profile: 'coordinator',
    key_set: 'rotated',
    token: compact(accessHeader(), {}, 'current', exponentIntegerPayload),
    valid: true,
    expected: expectedAccess('coordinator'),
  },
  {
    id: 'duplicate_payload_key',
    kind: 'miakapp',
    profile: 'coordinator',
    key_set: 'rotated',
    token: compact(accessHeader(), {}, 'current', duplicatePayload),
    valid: false,
    error: 'malformed_token',
  },
  {
    id: 'unpaired_surrogate',
    kind: 'miakapp',
    profile: 'coordinator',
    key_set: 'rotated',
    token: compact(accessHeader(), {}, 'current', unpairedSurrogatePayload),
    valid: false,
    error: 'malformed_token',
  },
  {
    id: 'bad_signature',
    kind: 'miakapp',
    profile: 'coordinator',
    key_set: 'rotated',
    token: wrongSignature,
    valid: false,
    error: 'invalid_signature',
  },
  {
    id: 'padded_segment',
    kind: 'miakapp',
    profile: 'coordinator',
    key_set: 'rotated',
    token: `${wrongSignatureParts[0]}=.${wrongSignatureParts[1]}.${wrongSignatureParts[2]}`,
    valid: false,
    error: 'malformed_token',
  },
  validFirebase('valid_firebase_verified_email', 1),
  validFirebase('valid_firebase_unverified_email', 2, { email_verified: false }, { verified_email: null }),
  validFirebase('valid_firebase_without_email', 3, { email: undefined, email_verified: false }, { verified_email: null }),
  invalidFirebase('firebase_wrong_project', 4, 'invalid_audience', { aud: 'demo-other-project' }),
  invalidFirebase('firebase_wrong_issuer', 5, 'invalid_issuer', { iss: 'https://securetoken.google.com/demo-other-project' }),
  invalidFirebase('firebase_expired', 6, 'expired', { exp: now }),
  invalidFirebase('firebase_future_iat', 7, 'invalid_time', { iat: now + 31 }),
  invalidFirebase('firebase_future_auth_time', 8, 'invalid_time', { auth_time: now + 31 }),
  validFirebase('firebase_stale_authentication', 10, { auth_time: now - 601, sub: 'syn_user_1' }),
  invalidFirebase('firebase_null_type', 11, 'invalid_header', {}, { typ: null }),
  invalidFirebase('firebase_oversized_json_string', 12, 'malformed_token', { padding: 'x'.repeat(4_097) }),
  invalidFirebase('firebase_excessive_json_values', 13, 'malformed_token', { padding: Array(2_048).fill(0) }),
  validFirebase('valid_firebase_rs256_3072', 14, {}, {}, 'firebase3072'),
  invalidFirebase('firebase_wrong_algorithm', 9, 'invalid_header', {}, { alg: 'HS256' }),
];

const homeKey = `mhk1_${clientId}_${Buffer.alloc(32, 7).toString('base64url')}`;
const pepper = Buffer.alloc(32, 9);

const fixture = {
  schema: 'miakapp.control-plane-access-token-vectors/1',
  fixture_version: 1,
  provenance: {
    kind: 'hand_authored_synthetic',
    contains_production_data: false,
    test_private_keys: 'test_only_do_not_use',
  },
  now,
  deployment: {
    issuer,
    jwks_uri: `${issuer}/.well-known/jwks.json`,
    exchange_endpoint: `${issuer}/v1/access-tokens:exchange`,
    push_audience: pushAudience,
    components_audience: componentsAudience,
    relay_audience: relayAudience,
  },
  firebase: {
    project_id: firebaseProject,
    issuer: `https://securetoken.google.com/${firebaseProject}`,
    public_keys: [publicJwk('firebase'), publicJwk('firebase3072')],
  },
  home_key: {
    value: homeKey,
    key_id: clientId,
    secret_bytes: 32,
    pepper_base64url: pepper.toString('base64url'),
    verifier_base64url: createHmac('sha256', pepper).update(homeKey, 'ascii').digest('base64url'),
    malformed: [
      '',
      `mhk1_${clientId}_short`,
      `mhk2_${clientId}_${Buffer.alloc(32, 7).toString('base64url')}`,
      `mhk1_${clientId}_${Buffer.alloc(32, 7).toString('base64url')}=`,
    ],
  },
  key_sets: {
    initial: { keys: [publicJwk('current')] },
    prepublished: { keys: [publicJwk('current'), publicJwk('future')] },
    rotated: { keys: [publicJwk('current'), publicJwk('future')] },
    retired: { keys: [publicJwk('future')] },
    firebase: { keys: [publicJwk('firebase'), publicJwk('firebase3072')] },
  },
  rotation: {
    retiring_kid: keyIds.current,
    retiring_last_issued_at: now,
    transitions: [
      { phase: 'initial', at: now - 120, key_set: 'initial', signing_kid: keyIds.current },
      { phase: 'prepublished', at: now - 60, key_set: 'prepublished', signing_kid: keyIds.current },
      { phase: 'activated', at: now, key_set: 'rotated', signing_kid: keyIds.future },
      { phase: 'retiring_removed', at: now + 330, key_set: 'retired', signing_kid: keyIds.future },
    ],
  },
  test_only_private_keys: {
    warning: 'SYNTHETIC TEST KEYS. NEVER LOAD IN PRODUCTION.',
    current: { ...privateKeys.current, kid: keyIds.current },
    future: { ...privateKeys.future, kid: keyIds.future },
    firebase: { ...privateKeys.firebase, kid: keyIds.firebase },
    firebase3072: { ...privateKeys.firebase3072, kid: keyIds.firebase3072 },
  },
  vectors: vectors.map((vector) => {
    const clean = { verification_time: now, ...vector };
    if (clean.expected === undefined) delete clean.expected;
    return clean;
  }),
};

const output = `${JSON.stringify(fixture, null, 2)}\n`;
if (process.argv.includes('--check')) {
  const current = await readFile(target, 'utf8').catch(() => '');
  if (current !== output) {
    console.error('access-tokens.json is not the deterministic generator output');
    process.exitCode = 1;
  }
} else {
  await writeFile(target, output, { encoding: 'utf8', mode: 0o644 });
}
