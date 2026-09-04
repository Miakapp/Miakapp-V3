import { createHmac, timingSafeEqual } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';

import {
  ContractViolation,
  type JsonValue,
  arrayValue,
  assertKeys,
  booleanValue,
  integerValue,
  objectValue,
  parseBoundedJson,
  stringValue,
} from './json.js';

export const ACCESS_VECTORS_SCHEMA = 'miakapp.control-plane-access-token-vectors/1' as const;
export const HOME_KEY_PATTERN = /^mhk1_([A-Za-z0-9_-]{22})_([A-Za-z0-9_-]{43})$/;
export const HOME_ID_PATTERN = /^[a-z][a-z0-9-]{1,61}[a-z0-9]$/;
export const COORDINATOR_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
export const ACCESS_SCOPES = Object.freeze([
  'relay:user',
  'relay:coordinator',
  'relay:cli',
  'push:send',
  'components:publish',
] as const);

export type AccessScope = typeof ACCESS_SCOPES[number];
export type AccessProfile = 'user' | 'coordinator' | 'cli' | 'push' | 'components';
export type TokenKind = 'miakapp' | 'firebase';
export type VectorProfile = AccessProfile;
export type TokenErrorCode =
  | 'malformed_token'
  | 'invalid_header'
  | 'unknown_kid'
  | 'invalid_signature'
  | 'invalid_issuer'
  | 'invalid_audience'
  | 'expired'
  | 'invalid_time'
  | 'invalid_scope'
  | 'invalid_profile'
  | 'invalid_claims';

export interface PublicJwk {
  kty: 'OKP' | 'RSA';
  kid: string;
  use: 'sig';
  alg: 'EdDSA' | 'RS256';
  crv?: 'Ed25519';
  x?: string;
  n?: string;
  e?: string;
}

export interface HomeKeyAccessIdentity {
  home_id: string;
  principal_id: string;
  client_id: string;
  scope: Exclude<AccessScope, 'relay:user'>;
  expires_at: number;
  role: 'coordinator' | 'cli' | null;
  coordinator_name: string | null;
}

export interface UserAccessIdentity {
  home_id: string;
  principal_id: string;
  scope: 'relay:user';
  expires_at: number;
  role: 'user';
  verified_email: string | null;
}

export type AccessIdentity = HomeKeyAccessIdentity | UserAccessIdentity;

export interface FirebaseIdentity {
  user_id: string;
  verified_email: string | null;
  authenticated_at: number;
  expires_at: number;
}

export type AccessKeySetName = 'initial' | 'prepublished' | 'rotated' | 'retired' | 'firebase';

export interface RotationTransition {
  phase: 'initial' | 'prepublished' | 'activated' | 'retiring_removed';
  at: number;
  key_set: Exclude<AccessKeySetName, 'firebase'>;
  signing_kid: string;
}

export interface TokenVector {
  id: string;
  kind: TokenKind;
  profile: VectorProfile;
  key_set: AccessKeySetName;
  verification_time: number;
  token: string;
  valid: boolean;
  error?: TokenErrorCode;
  expected?: AccessIdentity | FirebaseIdentity;
}

export interface AccessTokenFixture {
  schema: typeof ACCESS_VECTORS_SCHEMA;
  fixture_version: 1;
  now: number;
  deployment: {
    issuer: string;
    jwks_uri: string;
    exchange_endpoint: string;
    user_relay_exchange_endpoint: string;
    push_audience: string;
    components_audience: string;
    relay_audience: string;
  };
  firebase: {
    project_id: string;
    issuer: string;
    public_keys: PublicJwk[];
  };
  home_key: {
    value: string;
    key_id: string;
    secret_bytes: 32;
    pepper_base64url: string;
    verifier_base64url: string;
    malformed: string[];
  };
  key_sets: {
    initial: { keys: PublicJwk[] };
    prepublished: { keys: PublicJwk[] };
    rotated: { keys: PublicJwk[] };
    retired: { keys: PublicJwk[] };
    firebase: { keys: PublicJwk[] };
  };
  rotation: {
    retiring_kid: string;
    retiring_last_issued_at: number;
    transitions: RotationTransition[];
  };
  vectors: TokenVector[];
}

const FIXTURE_LIMITS = Object.freeze({
  maximumBytes: 262_144,
  maximumDepth: 16,
  maximumValues: 8_192,
  maximumStringBytes: 16_384,
  maximumArrayItems: 256,
  maximumObjectEntries: 256,
});

const CONTROL_CHARACTER = /\p{Cc}/u;
const ASCII_ID = /^[A-Za-z0-9._-]{1,128}$/;
const VECTOR_ID = /^[a-z][a-z0-9_]{0,63}$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const TOKEN_ERRORS = new Set<TokenErrorCode>([
  'malformed_token',
  'invalid_header',
  'unknown_kid',
  'invalid_signature',
  'invalid_issuer',
  'invalid_audience',
  'expired',
  'invalid_time',
  'invalid_scope',
  'invalid_profile',
  'invalid_claims',
]);

export function decodeCanonicalBase64url(value: string, label: string, expectedBytes?: number): Uint8Array {
  if (!BASE64URL.test(value)) {
    throw new ContractViolation('invalid_fixture', `${label} is not unpadded base64url`);
  }
  let decoded: Buffer;
  try {
    decoded = Buffer.from(value, 'base64url');
  } catch {
    throw new ContractViolation('invalid_fixture', `${label} is not base64url`);
  }
  if (decoded.toString('base64url') !== value) {
    throw new ContractViolation('invalid_fixture', `${label} is not canonical base64url`);
  }
  if (expectedBytes !== undefined && decoded.byteLength !== expectedBytes) {
    throw new ContractViolation('invalid_fixture', `${label} has the wrong decoded length`);
  }
  return decoded;
}

function safeString(value: JsonValue | undefined, label: string, maximumBytes = 4_096): string {
  const string = stringValue(value, label);
  if (string.length === 0 || Buffer.byteLength(string, 'utf8') > maximumBytes || CONTROL_CHARACTER.test(string)) {
    throw new ContractViolation('invalid_fixture', `${label} is not a bounded safe string`);
  }
  return string;
}

function exactHttps(
  value: JsonValue | undefined,
  label: string,
  allowWebSocket = false,
  allowSecureTokenHost = false,
): string {
  const string = safeString(value, label, 2_048);
  let url: URL;
  try {
    url = new URL(string);
  } catch {
    throw new ContractViolation('invalid_fixture', `${label} is not a URL`);
  }
  const schemes = allowWebSocket ? new Set(['wss:']) : new Set(['https:']);
  const canonical = url.href === string
    || (url.pathname === '/' && string === url.origin);
  if (!schemes.has(url.protocol)
    || url.username !== ''
    || url.password !== ''
    || url.search !== ''
    || url.hash !== ''
    || !canonical) {
    throw new ContractViolation('invalid_fixture', `${label} is not a canonical secure URL`);
  }
  if (!url.hostname.endsWith('.test')
    && !(allowSecureTokenHost && url.hostname === 'securetoken.google.com')) {
    throw new ContractViolation('privacy_violation', `${label} must use a synthetic .test host`);
  }
  return string;
}

function parseJwk(value: JsonValue, label: string): PublicJwk {
  const object = objectValue(value, label);
  const kty = stringValue(object.kty, `${label}.kty`);
  if (kty === 'OKP') {
    assertKeys(object, ['kty', 'crv', 'x', 'use', 'alg', 'kid'], [], label);
    if (object.crv !== 'Ed25519' || object.use !== 'sig' || object.alg !== 'EdDSA') {
      throw new ContractViolation('invalid_fixture', `${label} is not an Ed25519 signing JWK`);
    }
    const x = stringValue(object.x, `${label}.x`);
    decodeCanonicalBase64url(x, `${label}.x`, 32);
    const kid = safeString(object.kid, `${label}.kid`, 128);
    if (!ASCII_ID.test(kid)) throw new ContractViolation('invalid_fixture', `${label}.kid is invalid`);
    return Object.freeze({ kty: 'OKP', crv: 'Ed25519', x, use: 'sig', alg: 'EdDSA', kid });
  }
  if (kty === 'RSA') {
    assertKeys(object, ['kty', 'n', 'e', 'use', 'alg', 'kid'], [], label);
    if (object.use !== 'sig' || object.alg !== 'RS256') {
      throw new ContractViolation('invalid_fixture', `${label} is not an RS256 signing JWK`);
    }
    const n = stringValue(object.n, `${label}.n`);
    const e = stringValue(object.e, `${label}.e`);
    const modulus = decodeCanonicalBase64url(n, `${label}.n`);
    const modulusBits = modulus.byteLength === 0 || modulus[0] === undefined
      ? 0
      : modulus.byteLength * 8 - Math.clz32(modulus[0]) + 24;
    if (modulusBits < 2_048 || modulusBits > 4_096 || modulus[0] === 0) {
      throw new ContractViolation('invalid_fixture', `${label}.n is outside the 2048..4096-bit profile`);
    }
    const exponentBytes = decodeCanonicalBase64url(e, `${label}.e`);
    const exponent = exponentBytes.reduce((value, byte) => value * 256 + byte, 0);
    if (exponentBytes.byteLength === 0 || exponentBytes.byteLength > 4 || exponent < 3 || exponent % 2 === 0) {
      throw new ContractViolation('invalid_fixture', `${label}.e is invalid`);
    }
    const kid = safeString(object.kid, `${label}.kid`, 128);
    if (!ASCII_ID.test(kid)) throw new ContractViolation('invalid_fixture', `${label}.kid is invalid`);
    return Object.freeze({ kty: 'RSA', n, e, use: 'sig', alg: 'RS256', kid });
  }
  throw new ContractViolation('invalid_fixture', `${label}.kty is unsupported`);
}

function parseKeySet(value: JsonValue | undefined, label: string): { keys: PublicJwk[] } {
  const object = objectValue(value ?? null, label);
  assertKeys(object, ['keys'], [], label);
  const keys = arrayValue(object.keys ?? null, `${label}.keys`).map((entry, index) => (
    parseJwk(entry, `${label}.keys[${index}]`)
  ));
  if (keys.length === 0 || keys.length > 16) {
    throw new ContractViolation('invalid_fixture', `${label}.keys has invalid cardinality`);
  }
  const ids = new Set(keys.map((key) => key.kid));
  if (ids.size !== keys.length) throw new ContractViolation('invalid_fixture', `${label} repeats a kid`);
  return Object.freeze({ keys: Object.freeze(keys) as PublicJwk[] });
}

function parseAccessExpected(value: JsonValue, profile: AccessProfile, label: string): AccessIdentity {
  const object = objectValue(value, label);
  if (profile === 'user') {
    assertKeys(
      object,
      ['home_id', 'principal_id', 'scope', 'expires_at', 'role', 'verified_email'],
      [],
      label,
    );
    if (object.scope !== 'relay:user' || object.role !== 'user') {
      throw new ContractViolation('invalid_fixture', `${label} is not a user access identity`);
    }
    const email = object.verified_email;
    if (email !== null && typeof email !== 'string') {
      throw new ContractViolation('invalid_fixture', `${label}.verified_email is invalid`);
    }
    return Object.freeze({
      home_id: safeString(object.home_id, `${label}.home_id`, 63),
      principal_id: safeString(object.principal_id, `${label}.principal_id`, 128),
      scope: 'relay:user',
      expires_at: integerValue(object.expires_at, `${label}.expires_at`),
      role: 'user',
      verified_email: email === null ? null : safeString(email, `${label}.verified_email`, 320),
    });
  }
  assertKeys(
    object,
    ['home_id', 'principal_id', 'client_id', 'scope', 'expires_at', 'role', 'coordinator_name'],
    [],
    label,
  );
  const scope = stringValue(object.scope, `${label}.scope`);
  if (!ACCESS_SCOPES.includes(scope as AccessScope)) {
    throw new ContractViolation('invalid_fixture', `${label}.scope is unknown`);
  }
  const role = object.role;
  if (role !== null && role !== 'coordinator' && role !== 'cli') {
    throw new ContractViolation('invalid_fixture', `${label}.role is invalid`);
  }
  const coordinator = object.coordinator_name;
  if (coordinator !== null && typeof coordinator !== 'string') {
    throw new ContractViolation('invalid_fixture', `${label}.coordinator_name is invalid`);
  }
  return Object.freeze({
    home_id: safeString(object.home_id, `${label}.home_id`, 63),
    principal_id: safeString(object.principal_id, `${label}.principal_id`, 128),
    client_id: safeString(object.client_id, `${label}.client_id`, 22),
    scope: scope as Exclude<AccessScope, 'relay:user'>,
    expires_at: integerValue(object.expires_at, `${label}.expires_at`),
    role,
    coordinator_name: coordinator,
  });
}

function parseFirebaseExpected(value: JsonValue, label: string): FirebaseIdentity {
  const object = objectValue(value, label);
  assertKeys(object, ['user_id', 'verified_email', 'authenticated_at', 'expires_at'], [], label);
  const email = object.verified_email;
  if (email !== null && typeof email !== 'string') {
    throw new ContractViolation('invalid_fixture', `${label}.verified_email is invalid`);
  }
  return Object.freeze({
    user_id: safeString(object.user_id, `${label}.user_id`, 128),
    verified_email: email,
    authenticated_at: integerValue(object.authenticated_at, `${label}.authenticated_at`),
    expires_at: integerValue(object.expires_at, `${label}.expires_at`),
  });
}

function parseVector(value: JsonValue, label: string): TokenVector {
  const object = objectValue(value, label);
  assertKeys(
    object,
    ['id', 'kind', 'profile', 'key_set', 'verification_time', 'token', 'valid'],
    ['error', 'expected'],
    label,
  );
  const id = stringValue(object.id, `${label}.id`);
  if (!VECTOR_ID.test(id)) throw new ContractViolation('invalid_fixture', `${label}.id is invalid`);
  const kind = stringValue(object.kind, `${label}.kind`);
  const profile = stringValue(object.profile, `${label}.profile`);
  const keySet = stringValue(object.key_set, `${label}.key_set`);
  if (kind !== 'miakapp' && kind !== 'firebase') {
    throw new ContractViolation('invalid_fixture', `${label}.kind is invalid`);
  }
  if (!['coordinator', 'cli', 'push', 'components', 'user'].includes(profile)) {
    throw new ContractViolation('invalid_fixture', `${label}.profile is invalid`);
  }
  if (kind === 'firebase' && profile !== 'user') {
    throw new ContractViolation('invalid_fixture', `${label} mixes token profiles`);
  }
  if ((kind === 'firebase') !== (keySet === 'firebase')) {
    throw new ContractViolation('invalid_fixture', `${label} mixes token and key profiles`);
  }
  if (!['initial', 'prepublished', 'rotated', 'retired', 'firebase'].includes(keySet)) {
    throw new ContractViolation('invalid_fixture', `${label}.key_set is invalid`);
  }
  const verificationTime = integerValue(object.verification_time, `${label}.verification_time`);
  const valid = booleanValue(object.valid, `${label}.valid`);
  const token = stringValue(object.token, `${label}.token`);
  if (Buffer.byteLength(token, 'ascii') > 8_192) {
    throw new ContractViolation('invalid_fixture', `${label}.token exceeds the access-token limit`);
  }
  if (valid) {
    if (object.error !== undefined || object.expected === undefined) {
      throw new ContractViolation('invalid_fixture', `${label} has inconsistent valid evidence`);
    }
    return Object.freeze({
      id,
      kind,
      profile: profile as VectorProfile,
      key_set: keySet as TokenVector['key_set'],
      verification_time: verificationTime,
      token,
      valid,
      expected: kind === 'miakapp'
        ? parseAccessExpected(object.expected, profile as AccessProfile, `${label}.expected`)
        : parseFirebaseExpected(object.expected, `${label}.expected`),
    });
  }
  const error = stringValue(object.error, `${label}.error`) as TokenErrorCode;
  if (!TOKEN_ERRORS.has(error) || object.expected !== undefined) {
    throw new ContractViolation('invalid_fixture', `${label} has inconsistent invalid evidence`);
  }
  return Object.freeze({
    id,
    kind,
    profile: profile as VectorProfile,
    key_set: keySet as TokenVector['key_set'],
    verification_time: verificationTime,
    token,
    valid,
    error,
  });
}

function decodedVectorObject(vector: TokenVector, segmentIndex: 0 | 1, label: string): { [key: string]: unknown } {
  const segment = vector.token.split('.')[segmentIndex];
  if (segment === undefined) throw new ContractViolation('missing_coverage', `${label} lacks a JWT segment`);
  let value: unknown;
  try {
    const bytes = decodeCanonicalBase64url(segment, label);
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw new ContractViolation('missing_coverage', `${label} is not inspectable signed JSON`);
  }
  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    throw new ContractViolation('missing_coverage', `${label} is not a JSON object`);
  }
  return value as { [key: string]: unknown };
}

function jsonEvidenceMetrics(root: unknown): { values: number; maximumStringBytes: number } {
  const stack: unknown[] = [root];
  let values = 0;
  let maximumStringBytes = 0;
  while (stack.length > 0) {
    const value = stack.pop();
    values += 1;
    if (typeof value === 'string') maximumStringBytes = Math.max(maximumStringBytes, Buffer.byteLength(value, 'utf8'));
    else if (Array.isArray(value)) stack.push(...value);
    else if (value !== null && typeof value === 'object') stack.push(...Object.values(value));
  }
  return { values, maximumStringBytes };
}

export function parseHomeKey(value: string): { keyId: string; secret: Uint8Array } {
  const match = HOME_KEY_PATTERN.exec(value);
  if (match === null) throw new ContractViolation('invalid_home_key', 'Home Key has an invalid format');
  const keyId = match[1];
  const secret = match[2];
  if (keyId === undefined || secret === undefined) {
    throw new ContractViolation('invalid_home_key', 'Home Key has an invalid format');
  }
  decodeCanonicalBase64url(keyId, 'Home Key ID', 16);
  return { keyId, secret: decodeCanonicalBase64url(secret, 'Home Key secret', 32) };
}

export function deriveHomeKeyVerifier(homeKey: string, pepper: Uint8Array): string {
  parseHomeKey(homeKey);
  if (pepper.byteLength !== 32) throw new ContractViolation('invalid_fixture', 'Home Key pepper must be 32 bytes');
  return createHmac('sha256', pepper).update(homeKey, 'ascii').digest('base64url');
}

export function homeKeyVerifierMatches(homeKey: string, pepper: Uint8Array, verifier: string): boolean {
  const calculated = Buffer.from(deriveHomeKeyVerifier(homeKey, pepper), 'ascii');
  const expected = Buffer.from(verifier, 'ascii');
  return calculated.byteLength === expected.byteLength && timingSafeEqual(calculated, expected);
}

export function validateAccessTokenFixture(raw: JsonValue): AccessTokenFixture {
  const root = objectValue(raw, 'access-token fixture');
  assertKeys(
    root,
    [
      'schema',
      'fixture_version',
      'provenance',
      'now',
      'deployment',
      'firebase',
      'home_key',
      'key_sets',
      'rotation',
      'test_only_private_keys',
      'vectors',
    ],
    [],
    'access-token fixture',
  );
  if (root.schema !== ACCESS_VECTORS_SCHEMA || root.fixture_version !== 1) {
    throw new ContractViolation('invalid_fixture', 'access-token fixture schema is unsupported');
  }
  const provenance = objectValue(root.provenance ?? null, 'provenance');
  assertKeys(provenance, ['kind', 'contains_production_data', 'test_private_keys'], [], 'provenance');
  if (provenance.kind !== 'hand_authored_synthetic'
    || provenance.contains_production_data !== false
    || provenance.test_private_keys !== 'test_only_do_not_use') {
    throw new ContractViolation('privacy_violation', 'fixture provenance is not synthetic');
  }
  const now = integerValue(root.now, 'now');

  const deploymentValue = objectValue(root.deployment ?? null, 'deployment');
  assertKeys(
    deploymentValue,
    [
      'issuer',
      'jwks_uri',
      'exchange_endpoint',
      'user_relay_exchange_endpoint',
      'push_audience',
      'components_audience',
      'relay_audience',
    ],
    [],
    'deployment',
  );
  const deployment = Object.freeze({
    issuer: exactHttps(deploymentValue.issuer, 'deployment.issuer'),
    jwks_uri: exactHttps(deploymentValue.jwks_uri, 'deployment.jwks_uri'),
    exchange_endpoint: exactHttps(deploymentValue.exchange_endpoint, 'deployment.exchange_endpoint'),
    user_relay_exchange_endpoint: exactHttps(
      deploymentValue.user_relay_exchange_endpoint,
      'deployment.user_relay_exchange_endpoint',
    ),
    push_audience: exactHttps(deploymentValue.push_audience, 'deployment.push_audience'),
    components_audience: exactHttps(deploymentValue.components_audience, 'deployment.components_audience'),
    relay_audience: exactHttps(deploymentValue.relay_audience, 'deployment.relay_audience', true),
  });
  if (deployment.issuer.endsWith('/')) {
    throw new ContractViolation('invalid_fixture', 'deployment.issuer has a trailing slash');
  }

  const firebaseValue = objectValue(root.firebase ?? null, 'firebase');
  assertKeys(firebaseValue, ['project_id', 'issuer', 'public_keys'], [], 'firebase');
  const projectId = safeString(firebaseValue.project_id, 'firebase.project_id', 128);
  if (!projectId.startsWith('demo-')) {
    throw new ContractViolation('privacy_violation', 'Firebase fixture project must be demo-*');
  }
  const firebase = Object.freeze({
    project_id: projectId,
    issuer: exactHttps(firebaseValue.issuer, 'firebase.issuer', false, true),
    public_keys: Object.freeze(arrayValue(firebaseValue.public_keys ?? null, 'firebase.public_keys').map(
      (entry, index) => parseJwk(entry, `firebase.public_keys[${index}]`),
    )) as PublicJwk[],
  });
  if (firebase.issuer !== `https://securetoken.google.com/${projectId}`) {
    throw new ContractViolation('invalid_fixture', 'Firebase issuer does not match its project');
  }

  const homeKeyValue = objectValue(root.home_key ?? null, 'home_key');
  assertKeys(
    homeKeyValue,
    ['value', 'key_id', 'secret_bytes', 'pepper_base64url', 'verifier_base64url', 'malformed'],
    [],
    'home_key',
  );
  const homeKey = stringValue(homeKeyValue.value, 'home_key.value');
  const parsedKey = parseHomeKey(homeKey);
  const keyId = stringValue(homeKeyValue.key_id, 'home_key.key_id');
  if (parsedKey.keyId !== keyId || homeKeyValue.secret_bytes !== 32) {
    throw new ContractViolation('invalid_fixture', 'Home Key metadata does not match its value');
  }
  const pepperBase64url = stringValue(homeKeyValue.pepper_base64url, 'home_key.pepper_base64url');
  const pepper = decodeCanonicalBase64url(pepperBase64url, 'home_key.pepper_base64url', 32);
  const verifierBase64url = stringValue(homeKeyValue.verifier_base64url, 'home_key.verifier_base64url');
  decodeCanonicalBase64url(verifierBase64url, 'home_key.verifier_base64url', 32);
  if (!homeKeyVerifierMatches(homeKey, pepper, verifierBase64url)) {
    throw new ContractViolation('invalid_fixture', 'Home Key verifier does not match');
  }
  const malformed = arrayValue(homeKeyValue.malformed ?? null, 'home_key.malformed').map((entry, index) => (
    stringValue(entry, `home_key.malformed[${index}]`)
  ));
  for (const invalid of malformed) {
    try {
      parseHomeKey(invalid);
      throw new ContractViolation('invalid_fixture', 'malformed Home Key fixture is valid');
    } catch (error) {
      if (!(error instanceof ContractViolation) || error.code !== 'invalid_home_key') throw error;
    }
  }

  const keySetsValue = objectValue(root.key_sets ?? null, 'key_sets');
  assertKeys(keySetsValue, ['initial', 'prepublished', 'rotated', 'retired', 'firebase'], [], 'key_sets');
  const keySets = Object.freeze({
    initial: parseKeySet(keySetsValue.initial, 'key_sets.initial'),
    prepublished: parseKeySet(keySetsValue.prepublished, 'key_sets.prepublished'),
    rotated: parseKeySet(keySetsValue.rotated, 'key_sets.rotated'),
    retired: parseKeySet(keySetsValue.retired, 'key_sets.retired'),
    firebase: parseKeySet(keySetsValue.firebase, 'key_sets.firebase'),
  });

  for (const name of ['initial', 'prepublished', 'rotated', 'retired'] as const) {
    if (keySets[name].keys.some((key) => key.kty !== 'OKP')) {
      throw new ContractViolation('invalid_fixture', `${name} contains a non-Ed25519 access-token key`);
    }
  }
  if (keySets.firebase.keys.some((key) => key.kty !== 'RSA')) {
    throw new ContractViolation('invalid_fixture', 'firebase contains a non-RSA ID-token key');
  }

  if (JSON.stringify(firebase.public_keys) !== JSON.stringify(keySets.firebase.keys)) {
    throw new ContractViolation('invalid_fixture', 'Firebase public key sources disagree');
  }

  const rotationValue = objectValue(root.rotation ?? null, 'rotation');
  assertKeys(rotationValue, ['retiring_kid', 'retiring_last_issued_at', 'transitions'], [], 'rotation');
  const retiringKid = safeString(rotationValue.retiring_kid, 'rotation.retiring_kid', 128);
  const retiringLastIssuedAt = integerValue(rotationValue.retiring_last_issued_at, 'rotation.retiring_last_issued_at');
  const phases = ['initial', 'prepublished', 'activated', 'retiring_removed'] as const;
  const transitionKeySets = ['initial', 'prepublished', 'rotated', 'retired'] as const;
  const transitions = arrayValue(rotationValue.transitions ?? null, 'rotation.transitions').map((entry, index) => {
    const transition = objectValue(entry, `rotation.transitions[${index}]`);
    assertKeys(transition, ['phase', 'at', 'key_set', 'signing_kid'], [], `rotation.transitions[${index}]`);
    if (transition.phase !== phases[index] || transition.key_set !== transitionKeySets[index]) {
      throw new ContractViolation('invalid_fixture', 'rotation transitions are not the canonical sequence');
    }
    return Object.freeze({
      phase: transition.phase as RotationTransition['phase'],
      at: integerValue(transition.at, `rotation.transitions[${index}].at`),
      key_set: transition.key_set as RotationTransition['key_set'],
      signing_kid: safeString(transition.signing_kid, `rotation.transitions[${index}].signing_kid`, 128),
    });
  });
  if (transitions.length !== 4) {
    throw new ContractViolation('missing_coverage', 'rotation requires four explicit transitions');
  }
  const [initialTransition, prepublishedTransition, activatedTransition, removedTransition] = transitions;
  if (initialTransition === undefined
    || prepublishedTransition === undefined
    || activatedTransition === undefined
    || removedTransition === undefined
    || activatedTransition.at - prepublishedTransition.at < 60
    || retiringLastIssuedAt !== activatedTransition.at
    || removedTransition.at - retiringLastIssuedAt < 330
    || initialTransition.at >= prepublishedTransition.at
    || initialTransition.signing_kid !== prepublishedTransition.signing_kid
    || retiringKid !== prepublishedTransition.signing_kid
    || activatedTransition.signing_kid !== removedTransition.signing_kid
    || activatedTransition.signing_kid === prepublishedTransition.signing_kid) {
    throw new ContractViolation('missing_coverage', 'rotation timing or signing transitions are unsafe');
  }
  const kidSet = (name: Exclude<AccessKeySetName, 'firebase'>): Set<string> => (
    new Set(keySets[name].keys.map((key) => key.kid))
  );
  const initialKids = kidSet('initial');
  const prepublishedKids = kidSet('prepublished');
  const rotatedKids = kidSet('rotated');
  const retiredKids = kidSet('retired');
  const futureKid = activatedTransition.signing_kid;
  if (!initialKids.has(retiringKid)
    || !initialKids.has(initialTransition.signing_kid)
    || initialKids.has(futureKid)
    || !prepublishedKids.has(retiringKid)
    || !prepublishedKids.has(prepublishedTransition.signing_kid)
    || !prepublishedKids.has(futureKid)
    || !rotatedKids.has(retiringKid)
    || !rotatedKids.has(futureKid)
    || retiredKids.has(retiringKid)
    || !retiredKids.has(futureKid)) {
    throw new ContractViolation('missing_coverage', 'rotation key-set membership is unsafe');
  }
  const rotation = Object.freeze({
    retiring_kid: retiringKid,
    retiring_last_issued_at: retiringLastIssuedAt,
    transitions: Object.freeze(transitions) as RotationTransition[],
  });

  const privateKeys = objectValue(root.test_only_private_keys ?? null, 'test_only_private_keys');
  if (privateKeys.warning !== 'SYNTHETIC TEST KEYS. NEVER LOAD IN PRODUCTION.') {
    throw new ContractViolation('privacy_violation', 'private fixture keys lack their warning');
  }

  const vectors = arrayValue(root.vectors ?? null, 'vectors').map((entry, index) => (
    parseVector(entry, `vectors[${index}]`)
  ));
  const accessKeySetAt = (at: number): Exclude<AccessKeySetName, 'firebase'> => {
    if (at < initialTransition.at) {
      throw new ContractViolation('invalid_fixture', 'access-token vector predates the rotation timeline');
    }
    if (at < prepublishedTransition.at) return 'initial';
    if (at < activatedTransition.at) return 'prepublished';
    if (at < removedTransition.at) return 'rotated';
    return 'retired';
  };
  for (const vector of vectors) {
    const expectedKeySet = vector.kind === 'firebase' ? 'firebase' : accessKeySetAt(vector.verification_time);
    if (vector.key_set !== expectedKeySet) {
      throw new ContractViolation('missing_coverage', `${vector.id} does not use its clock-derived key set`);
    }
  }
  const vectorIds = new Set(vectors.map((vector) => vector.id));
  if (vectorIds.size !== vectors.length) throw new ContractViolation('invalid_fixture', 'vector IDs repeat');
  const requiredVectors = [
    'valid_coordinator',
    'valid_cli',
    'valid_push',
    'valid_components',
    'valid_user_access',
    'valid_user_access_without_email',
    'user_wrong_audience',
    'user_invalid_home',
    'user_invalid_uid',
    'user_wrong_role',
    'user_missing_role',
    'user_wrong_scope',
    'user_multiple_scopes',
    'user_forbidden_client_id',
    'user_forbidden_coordinator',
    'user_invalid_verified_email',
    'user_overlong_ttl',
    'user_future_iat',
    'user_bad_signature',
    'valid_retiring_during_overlap',
    'valid_future_after_rotation',
    'unknown_future_before_rotation',
    'retiring_removed_after_overlap',
    'wrong_issuer',
    'wrong_audience',
    'audience_array',
    'expired',
    'overlong_ttl',
    'future_iat',
    'future_iat_full_ttl',
    'multiple_scopes',
    'role_scope_mismatch',
    'missing_coordinator',
    'overlong_coordinator',
    'wrong_type',
    'algorithm_confusion',
    'algorithm_none',
    'unknown_claim',
    'unsafe_integer',
    'integer_decimal_lexeme',
    'integer_exponent_lexeme',
    'duplicate_payload_key',
    'unpaired_surrogate',
    'bad_signature',
    'padded_segment',
    'valid_firebase_verified_email',
    'valid_firebase_unverified_email',
    'valid_firebase_without_email',
    'firebase_wrong_project',
    'firebase_wrong_issuer',
    'firebase_expired',
    'firebase_future_iat',
    'firebase_future_auth_time',
    'firebase_stale_authentication',
    'firebase_null_type',
    'firebase_oversized_json_string',
    'firebase_excessive_json_values',
    'valid_firebase_rs256_3072',
    'firebase_wrong_algorithm',
  ];
  for (const id of requiredVectors) {
    if (!vectorIds.has(id)) throw new ContractViolation('missing_coverage', `fixture lacks ${id}`);
  }

  const requiredVector = (id: string): TokenVector => {
    const vector = vectors.find((entry) => entry.id === id);
    if (vector === undefined) throw new ContractViolation('missing_coverage', `fixture lacks ${id}`);
    return vector;
  };
  const rsa3072 = requiredVector('valid_firebase_rs256_3072');
  const rsaHeader = decodedVectorObject(rsa3072, 0, 'valid_firebase_rs256_3072 header');
  const rsaKey = keySets.firebase.keys.find((key) => key.kid === rsaHeader.kid);
  const rsaModulus = rsaKey?.n === undefined
    ? new Uint8Array()
    : decodeCanonicalBase64url(rsaKey.n, 'valid_firebase_rs256_3072 modulus');
  const rsaBits = rsaModulus[0] === undefined
    ? 0
    : rsaModulus.byteLength * 8 - Math.clz32(rsaModulus[0]) + 24;
  if (rsaKey?.kty !== 'RSA' || rsaBits !== 3_072 || !rsa3072.valid) {
    throw new ContractViolation('missing_coverage', 'valid_firebase_rs256_3072 does not exercise RSA-3072');
  }

  const oversizedClaims = decodedVectorObject(
    requiredVector('firebase_oversized_json_string'),
    1,
    'firebase_oversized_json_string claims',
  );
  if (jsonEvidenceMetrics(oversizedClaims).maximumStringBytes <= 4_096) {
    throw new ContractViolation('missing_coverage', 'firebase_oversized_json_string does not exceed the string bound');
  }
  const excessiveClaims = decodedVectorObject(
    requiredVector('firebase_excessive_json_values'),
    1,
    'firebase_excessive_json_values claims',
  );
  if (jsonEvidenceMetrics(excessiveClaims).values <= 2_048) {
    throw new ContractViolation('missing_coverage', 'firebase_excessive_json_values does not exceed the value bound');
  }

  const staleClaims = decodedVectorObject(
    requiredVector('firebase_stale_authentication'),
    1,
    'firebase_stale_authentication claims',
  );
  const ownerClaims = decodedVectorObject(
    requiredVector('valid_firebase_verified_email'),
    1,
    'valid_firebase_verified_email claims',
  );
  if (staleClaims.sub !== ownerClaims.sub
    || typeof staleClaims.auth_time !== 'number'
    || staleClaims.auth_time > now - 601) {
    throw new ContractViolation('missing_coverage', 'firebase_stale_authentication is not a stale token for the owner');
  }

  return Object.freeze({
    schema: ACCESS_VECTORS_SCHEMA,
    fixture_version: 1,
    now,
    deployment,
    firebase,
    home_key: Object.freeze({
      value: homeKey,
      key_id: keyId,
      secret_bytes: 32,
      pepper_base64url: pepperBase64url,
      verifier_base64url: verifierBase64url,
      malformed: Object.freeze(malformed) as string[],
    }),
    key_sets: keySets,
    rotation,
    vectors: Object.freeze(vectors) as TokenVector[],
  });
}

export async function loadAccessTokenFixture(
  url = new URL('../../fixtures/v1/access-tokens.json', import.meta.url),
): Promise<AccessTokenFixture> {
  const metadata = await stat(url);
  if (!metadata.isFile() || metadata.size > FIXTURE_LIMITS.maximumBytes) {
    throw new ContractViolation('limit_exceeded', 'access-token fixture exceeds its file limit');
  }
  const bytes = await readFile(url);
  return validateAccessTokenFixture(parseBoundedJson(bytes, FIXTURE_LIMITS));
}
