import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';

import {
  ContractViolation,
  type JsonValue,
  arrayValue,
  assertKeys,
  integerValue,
  objectValue,
  parseBoundedJson,
  stringValue,
} from './json.js';
import {
  ACCESS_SCOPES,
  type AccessScope,
  type AccessTokenFixture,
  COORDINATOR_NAME_PATTERN,
  type FirebaseIdentity,
  HOME_ID_PATTERN,
  decodeCanonicalBase64url,
} from './profile.js';
import { verifyFixtureVector } from './token.js';
import { inspectArtifactSource } from './artifact.js';

export const SCENARIOS_SCHEMA = 'miakapp.control-plane-scenarios/1' as const;

export type Coverage =
  | 'owner_bootstrap'
  | 'recent_authentication'
  | 'home_key_scope'
  | 'home_key_revocation'
  | 'uniform_revocation'
  | 'access_lease'
  | 'resource_token_authority'
  | 'destination_possession'
  | 'push_consent'
  | 'push_cross_home'
  | 'push_expiry'
  | 'push_revocation'
  | 'publication_upload_binding'
  | 'publication_readback'
  | 'publication_owner_authority'
  | 'publication_reconciliation'
  | 'publication_cas'
  | 'digest_quarantine'
  | 'admission_limits';

export interface OperationResult {
  outcome: 'ok' | 'error';
  code: string | null;
  scope?: AccessScope;
  audience?: string;
  client_id?: string;
  binding_id?: string;
  status?: 'awaiting_upload' | 'delivered' | 'finalized';
}

export interface AuditProjection {
  event: string;
  outcome: 'ok' | 'denied';
}

export interface HomeProjection {
  home_id: string;
  active_keys: number;
  active_grants: number;
  generation: number;
  active_digest: string | null;
}

export interface Scenario {
  id: string;
  coverage: Coverage[];
  operations: { [key: string]: JsonValue }[];
  expected_final: {
    homes: HomeProjection[];
    audit: AuditProjection[];
  };
}

export interface ScenarioFixture {
  schema: typeof SCENARIOS_SCHEMA;
  fixture_version: 1;
  clock: { start_seconds: number };
  required_coverage: Coverage[];
  scenarios: Scenario[];
}

interface Requirements {
  state_read: string[];
  event_subscribe: string[];
  event_publish: string[];
  call: string[];
  presentation: string[];
}

interface ReleaseRecord {
  homeId: string;
  digest: string;
  size: number;
  release: string;
  abi: 'miakapp.component/1';
  requires: Requirements;
  publisherPrincipalId: string;
  bindingId: string;
}

interface HomeRecord {
  owner: string;
  relayUrl: string;
  generation: number;
  activeDigest: string | null;
  finalized: Map<string, ReleaseRecord>;
}

interface KeyRecord {
  homeId: string;
  keyId: string;
  scopes: Set<AccessScope>;
  revoked: boolean;
}

interface TokenRecord {
  homeId: string;
  clientId: string;
  scope: AccessScope;
  audience: string;
  expiresAt: number;
}

interface ChallengeRecord {
  owner: string;
  appId: string;
  deliveryAddress: string;
  proofRef: string;
  expiresAt: number;
}

interface DestinationRecord {
  owner: string;
  appId: string;
  destinationId: string;
  active: boolean;
}

interface GrantRecord {
  grantId: string;
  owner: string;
  homeId: string;
  destinationRef: string;
  expiresAt: number;
  revoked: boolean;
}

interface UploadRecord extends ReleaseRecord {
  capabilityRef: string;
  expiresAt: number;
  capabilityConsumed: boolean;
  delivery: { digest: string; size: number; syntaxValid: boolean } | null;
}

interface ReplayState {
  now: number;
  users: Map<string, FirebaseIdentity>;
  homes: Map<string, HomeRecord>;
  keys: Map<string, KeyRecord>;
  tokens: Map<string, TokenRecord>;
  challenges: Map<string, ChallengeRecord>;
  destinations: Map<string, DestinationRecord>;
  grants: Map<string, GrantRecord>;
  uploads: Map<string, UploadRecord>;
  quarantined: Set<string>;
  audit: AuditProjection[];
}

interface ExecutedOperation {
  operation: { [key: string]: JsonValue };
  result: OperationResult;
  index: number;
  at: number;
}

const LIMITS = Object.freeze({
  maximumBytes: 262_144,
  maximumDepth: 16,
  maximumValues: 16_384,
  maximumStringBytes: 4_096,
  maximumArrayItems: 512,
  maximumObjectEntries: 128,
});
const MAX_ACTIVE_HOME_KEYS = 64;
const MAX_RETAINED_HOME_KEY_RECORDS = 64;
const MAX_RETAINED_GRANT_RECORDS = 256;
const MAX_OWNED_HOMES = 16;
const MAX_ACTIVE_PUSH_CHALLENGES = 4;
const MAX_PUSH_DESTINATIONS = 16;
const MAX_ACTIVE_GRANTS = MAX_PUSH_DESTINATIONS;
const PUSH_AUDIENCE = 'https://control.example.test/v1/push';
const COMPONENTS_AUDIENCE = 'https://control.example.test/v1/components';
const COVERAGE = new Set<Coverage>([
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
]);
const SCENARIO_ID = /^[a-z][a-z0-9_]{0,63}$/;
const REF = /^[a-z][a-z0-9-]{0,63}$/;
const DOTTED_NAME = /^[a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)*(?:\.\*)?$/;
const REQUIREMENT_FIELDS = [
  'state_read',
  'event_subscribe',
  'event_publish',
  'call',
  'presentation',
] as const;

const operationFields = Object.freeze({
  create_home: { required: ['kind', 'user_token', 'home_id', 'relay_url', 'expected'], optional: [] },
  create_key: {
    required: ['kind', 'user_token', 'home_id', 'key_ref', 'key_id', 'scopes', 'expected'],
    optional: [],
  },
  revoke_key: { required: ['kind', 'user_token', 'home_id', 'key_id', 'expected'], optional: [] },
  exchange: { required: ['kind', 'key_ref', 'purpose', 'expected'], optional: ['role', 'coordinator_name', 'token_ref'] },
  advance_time: { required: ['kind', 'seconds', 'expected'], optional: [] },
  verify_access: { required: ['kind', 'token_ref', 'expected'], optional: [] },
  issue_destination_challenge: {
    required: [
      'kind',
      'user_token',
      'verified_app_id',
      'challenge_ref',
      'delivery_address',
      'proof_ref',
      'expected',
    ],
    optional: [],
  },
  complete_destination_challenge: {
    required: [
      'kind',
      'user_token',
      'verified_app_id',
      'challenge_ref',
      'proof_ref',
      'destination_ref',
      'destination_id',
      'expected',
    ],
    optional: [],
  },
  create_grant: {
    required: [
      'kind',
      'user_token',
      'home_id',
      'destination_ref',
      'grant_ref',
      'grant_id',
      'lifetime_seconds',
      'expected',
    ],
    optional: [],
  },
  revoke_grant: {
    required: ['kind', 'user_token', 'home_id', 'grant_id', 'expected'],
    optional: [],
  },
  delete_destination: {
    required: ['kind', 'user_token', 'verified_app_id', 'destination_id', 'expected'],
    optional: [],
  },
  send_push: { required: ['kind', 'token_ref', 'grant_ref', 'expected'], optional: [] },
  request_upload: {
    required: [
      'kind',
      'home_id',
      'upload_ref',
      'capability_ref',
      'release',
      'abi',
      'requires',
      'digest',
      'size',
      'expected',
    ],
    optional: ['token_ref', 'user_token'],
  },
  deliver_upload: {
    required: [
      'kind',
      'upload_ref',
      'capability_ref',
      'artifact_source',
      'expected',
    ],
    optional: [],
  },
  inspect_upload: {
    required: ['kind', 'home_id', 'upload_ref', 'expected'],
    optional: ['token_ref', 'user_token'],
  },
  finalize_release: {
    required: ['kind', 'home_id', 'upload_ref', 'expected'],
    optional: ['token_ref', 'user_token'],
  },
  inspect_release: {
    required: ['kind', 'home_id', 'digest', 'expected'],
    optional: ['token_ref', 'user_token'],
  },
  activate_release: {
    required: ['kind', 'home_id', 'digest', 'expected_generation', 'generation', 'expected'],
    optional: ['token_ref', 'user_token'],
  },
  quarantine_digest: { required: ['kind', 'digest', 'expected'], optional: [] },
} as const);

type OperationKind = keyof typeof operationFields;

function safeString(value: JsonValue | undefined, label: string, pattern = REF): string {
  const string = stringValue(value, label);
  if (!pattern.test(string)) throw new ContractViolation('invalid_fixture', `${label} is invalid`);
  return string;
}

function boundedText(value: JsonValue | undefined, label: string, maximumBytes: number): string {
  const text = stringValue(value, label);
  if (text.length === 0
    || Buffer.byteLength(text, 'utf8') > maximumBytes
    || /\p{Cc}/u.test(text)) {
    throw new ContractViolation('invalid_fixture', `${label} is not bounded text`);
  }
  return text;
}

function secureSyntheticUrl(value: JsonValue | undefined, label: string, expectedProtocol?: 'https:' | 'wss:'): string {
  const string = stringValue(value, label);
  let url: URL;
  try {
    url = new URL(string);
  } catch {
    throw new ContractViolation('invalid_fixture', `${label} is not a URL`);
  }
  if ((expectedProtocol !== undefined && url.protocol !== expectedProtocol)
    || (expectedProtocol === undefined && url.protocol !== 'https:' && url.protocol !== 'wss:')
    || !url.hostname.endsWith('.test')
    || url.username !== ''
    || url.password !== ''
    || url.search !== ''
    || url.hash !== ''
    || url.href !== string) {
    throw new ContractViolation('privacy_violation', `${label} is not a canonical synthetic URL`);
  }
  return string;
}

function parseExpected(value: JsonValue | undefined, label: string): OperationResult {
  const object = objectValue(value ?? null, label);
  assertKeys(object, ['outcome', 'code'], ['scope', 'audience', 'client_id', 'binding_id', 'status'], label);
  if (object.outcome !== 'ok' && object.outcome !== 'error') {
    throw new ContractViolation('invalid_fixture', `${label}.outcome is invalid`);
  }
  if ((object.outcome === 'ok' && object.code !== null)
    || (object.outcome === 'error' && typeof object.code !== 'string')) {
    throw new ContractViolation('invalid_fixture', `${label}.code is inconsistent`);
  }
  const result: OperationResult = { outcome: object.outcome, code: object.code as string | null };
  if (object.scope !== undefined) {
    if (!ACCESS_SCOPES.includes(object.scope as AccessScope)) {
      throw new ContractViolation('invalid_fixture', `${label}.scope is invalid`);
    }
    result.scope = object.scope as AccessScope;
  }
  if (object.audience !== undefined) {
    result.audience = secureSyntheticUrl(object.audience, `${label}.audience`);
  }
  if (object.client_id !== undefined) {
    const clientId = stringValue(object.client_id, `${label}.client_id`);
    decodeCanonicalBase64url(clientId, `${label}.client_id`, 16);
    result.client_id = clientId;
  }
  if (object.binding_id !== undefined) {
    const bindingId = stringValue(object.binding_id, `${label}.binding_id`);
    decodeCanonicalBase64url(bindingId, `${label}.binding_id`, 32);
    result.binding_id = bindingId;
  }
  if (object.status !== undefined) {
    if (object.status !== 'awaiting_upload' && object.status !== 'delivered' && object.status !== 'finalized') {
      throw new ContractViolation('invalid_fixture', `${label}.status is invalid`);
    }
    result.status = object.status;
  }
  return Object.freeze(result);
}

function validateOperation(value: JsonValue, label: string): { [key: string]: JsonValue } {
  const operation = objectValue(value, label);
  const kindValue = operation.kind;
  if (typeof kindValue !== 'string' || !(kindValue in operationFields)) {
    throw new ContractViolation('invalid_fixture', `${label}.kind is invalid`);
  }
  const fields = operationFields[kindValue as OperationKind];
  assertKeys(operation, fields.required, fields.optional, label);
  if (kindValue === 'request_upload'
    || kindValue === 'inspect_upload'
    || kindValue === 'finalize_release'
    || kindValue === 'inspect_release'
    || kindValue === 'activate_release') {
    if ((operation.token_ref === undefined) === (operation.user_token === undefined)) {
      throw new ContractViolation('invalid_fixture', `${label} requires exactly one publisher authority`);
    }
  }
  parseExpected(operation.expected, `${label}.expected`);
  return operation;
}

function parseCoverage(value: JsonValue, label: string): Coverage[] {
  const entries = arrayValue(value, label).map((entry, index) => {
    const coverage = stringValue(entry, `${label}[${index}]`) as Coverage;
    if (!COVERAGE.has(coverage)) throw new ContractViolation('invalid_fixture', `${label} contains unknown coverage`);
    return coverage;
  });
  if (new Set(entries).size !== entries.length) {
    throw new ContractViolation('invalid_fixture', `${label} repeats coverage`);
  }
  return entries;
}

function parseFinal(value: JsonValue, label: string): Scenario['expected_final'] {
  const object = objectValue(value, label);
  assertKeys(object, ['homes', 'audit'], [], label);
  const homes = arrayValue(object.homes ?? null, `${label}.homes`).map((entry, index) => {
    const home = objectValue(entry, `${label}.homes[${index}]`);
    assertKeys(home, ['home_id', 'active_keys', 'active_grants', 'generation', 'active_digest'], [], `${label}.homes[${index}]`);
    const activeDigest = home.active_digest;
    if (activeDigest !== null && typeof activeDigest !== 'string') {
      throw new ContractViolation('invalid_fixture', `${label}.homes[${index}].active_digest is invalid`);
    }
    if (typeof activeDigest === 'string') {
      decodeCanonicalBase64url(activeDigest, `${label}.homes[${index}].active_digest`, 32);
    }
    return Object.freeze({
      home_id: safeString(home.home_id, `${label}.homes[${index}].home_id`, HOME_ID_PATTERN),
      active_keys: integerValue(home.active_keys, `${label}.homes[${index}].active_keys`),
      active_grants: integerValue(home.active_grants, `${label}.homes[${index}].active_grants`),
      generation: integerValue(home.generation, `${label}.homes[${index}].generation`),
      active_digest: activeDigest,
    });
  });
  const audit = arrayValue(object.audit ?? null, `${label}.audit`).map((entry, index) => {
    const event = objectValue(entry, `${label}.audit[${index}]`);
    assertKeys(event, ['event', 'outcome'], [], `${label}.audit[${index}]`);
    if (event.outcome !== 'ok' && event.outcome !== 'denied') {
      throw new ContractViolation('invalid_fixture', `${label}.audit[${index}].outcome is invalid`);
    }
    return Object.freeze({
      event: stringValue(event.event, `${label}.audit[${index}].event`),
      outcome: event.outcome,
    });
  });
  return Object.freeze({ homes: Object.freeze(homes) as HomeProjection[], audit: Object.freeze(audit) as AuditProjection[] });
}

export function validateScenarioFixture(raw: JsonValue): ScenarioFixture {
  const root = objectValue(raw, 'scenario fixture');
  assertKeys(
    root,
    ['schema', 'fixture_version', 'provenance', 'clock', 'required_coverage', 'scenarios'],
    [],
    'scenario fixture',
  );
  if (root.schema !== SCENARIOS_SCHEMA || root.fixture_version !== 1) {
    throw new ContractViolation('invalid_fixture', 'scenario fixture schema is unsupported');
  }
  const provenance = objectValue(root.provenance ?? null, 'provenance');
  assertKeys(provenance, ['kind', 'contains_production_data'], [], 'provenance');
  if (provenance.kind !== 'hand_authored_synthetic' || provenance.contains_production_data !== false) {
    throw new ContractViolation('privacy_violation', 'scenario provenance is not synthetic');
  }
  const clock = objectValue(root.clock ?? null, 'clock');
  assertKeys(clock, ['start_seconds'], [], 'clock');
  const startSeconds = integerValue(clock.start_seconds, 'clock.start_seconds');
  const requiredCoverage = parseCoverage(root.required_coverage ?? null, 'required_coverage');
  if (requiredCoverage.length !== COVERAGE.size) {
    throw new ContractViolation('missing_coverage', 'required_coverage is incomplete');
  }
  const scenarios = arrayValue(root.scenarios ?? null, 'scenarios').map((entry, index) => {
    const scenario = objectValue(entry, `scenarios[${index}]`);
    assertKeys(scenario, ['id', 'coverage', 'operations', 'expected_final'], [], `scenarios[${index}]`);
    const operations = arrayValue(scenario.operations ?? null, `scenarios[${index}].operations`).map(
      (operation, operationIndex) => validateOperation(operation, `scenarios[${index}].operations[${operationIndex}]`),
    );
    if (operations.length === 0 || operations.length > 512) {
      throw new ContractViolation('invalid_fixture', `scenarios[${index}] has invalid operation cardinality`);
    }
    return Object.freeze({
      id: safeString(scenario.id, `scenarios[${index}].id`, SCENARIO_ID),
      coverage: Object.freeze(parseCoverage(scenario.coverage ?? null, `scenarios[${index}].coverage`)) as Coverage[],
      operations: Object.freeze(operations) as { [key: string]: JsonValue }[],
      expected_final: parseFinal(scenario.expected_final ?? null, `scenarios[${index}].expected_final`),
    });
  });
  if (scenarios.length === 0 || scenarios.length > 64) {
    throw new ContractViolation('invalid_fixture', 'scenario fixture has invalid scenario cardinality');
  }
  if (new Set(scenarios.map((scenario) => scenario.id)).size !== scenarios.length) {
    throw new ContractViolation('invalid_fixture', 'scenario IDs repeat');
  }
  const covered = new Set(scenarios.flatMap((scenario) => scenario.coverage));
  for (const coverage of requiredCoverage) {
    if (!covered.has(coverage)) throw new ContractViolation('missing_coverage', `scenario fixture lacks ${coverage}`);
  }
  return Object.freeze({
    schema: SCENARIOS_SCHEMA,
    fixture_version: 1,
    clock: Object.freeze({ start_seconds: startSeconds }),
    required_coverage: Object.freeze(requiredCoverage) as Coverage[],
    scenarios: Object.freeze(scenarios) as Scenario[],
  });
}

function ok(extra: Partial<OperationResult> = {}): OperationResult {
  return { outcome: 'ok', code: null, ...extra };
}

function denied(code: string): OperationResult {
  return { outcome: 'error', code };
}

function record(state: ReplayState, event: string, result: OperationResult): OperationResult {
  state.audit.push({ event, outcome: result.outcome === 'ok' ? 'ok' : 'denied' });
  return result;
}

function activeKey(state: ReplayState, reference: string): KeyRecord | undefined {
  const key = state.keys.get(reference);
  return key?.revoked === false ? key : undefined;
}

function userIdentity(state: ReplayState, operation: { [key: string]: JsonValue }, label: string): FirebaseIdentity | undefined {
  const reference = safeString(operation.user_token, `${label}.user_token`, SCENARIO_ID);
  const identity = state.users.get(reference);
  return identity !== undefined && identity.expires_at > state.now ? identity : undefined;
}

function recent(identity: FirebaseIdentity, now: number): boolean {
  return identity.authenticated_at >= now - 600 && identity.authenticated_at <= now + 30;
}

function activeKeyCount(state: ReplayState, homeId: string): number {
  return [...state.keys.values()].filter((key) => key.homeId === homeId && !key.revoked).length;
}

function retainedKeyCount(state: ReplayState, homeId: string): number {
  return [...state.keys.values()].filter((key) => key.homeId === homeId).length;
}

function retainedKeyRemoval(state: ReplayState, homeId: string): string | undefined {
  if (retainedKeyCount(state, homeId) < MAX_RETAINED_HOME_KEY_RECORDS) return undefined;
  return [...state.keys.entries()].find(([, key]) => key.homeId === homeId && key.revoked)?.[0];
}

function activeGrantCount(state: ReplayState, homeId: string, owner?: string): number {
  return [...state.grants.values()].filter((grant) => {
    const destination = state.destinations.get(grant.destinationRef);
    return grant.homeId === homeId
      && (owner === undefined || grant.owner === owner)
      && !grant.revoked
      && grant.expiresAt > state.now
      && destination?.active === true;
  }).length;
}

function retainedGrantCount(state: ReplayState, homeId: string, owner?: string): number {
  return [...state.grants.values()].filter((grant) => (
    grant.homeId === homeId && (owner === undefined || grant.owner === owner)
  )).length;
}

function retainedGrantRemoval(
  state: ReplayState,
  homeId: string,
  owner: string,
  replacement: GrantRecord | undefined,
): string | undefined {
  if (retainedGrantCount(state, homeId, owner) < MAX_RETAINED_GRANT_RECORDS) return undefined;
  const inactive = [...state.grants.entries()].find(([, grant]) => (
    grant.homeId === homeId
    && grant.owner === owner
    && (grant.revoked
      || grant.expiresAt <= state.now
      || state.destinations.get(grant.destinationRef)?.active !== true)
  ));
  if (inactive !== undefined) return inactive[0];
  return [...state.grants.entries()].find(([, grant]) => grant === replacement)?.[0];
}

function assertStateCollectionBounds(state: ReplayState): void {
  for (const homeId of state.homes.keys()) {
    if (retainedKeyCount(state, homeId) > MAX_RETAINED_HOME_KEY_RECORDS) {
      throw new ContractViolation('scenario_mismatch', 'retained Home Key limit was exceeded');
    }
  }
  const partitions = new Set([...state.grants.values()].map((grant) => `${grant.owner}\u0000${grant.homeId}`));
  for (const partition of partitions) {
    const separator = partition.indexOf('\u0000');
    const owner = partition.slice(0, separator);
    const homeId = partition.slice(separator + 1);
    if (retainedGrantCount(state, homeId, owner) > MAX_RETAINED_GRANT_RECORDS) {
      throw new ContractViolation('scenario_mismatch', 'retained push-grant limit was exceeded');
    }
  }
}

function ownedHomeCount(state: ReplayState, owner: string): number {
  return [...state.homes.values()].filter((home) => home.owner === owner).length;
}

function destinationCount(state: ReplayState, owner: string): number {
  return [...state.destinations.values()].filter((destination) => (
    destination.owner === owner && destination.active
  )).length;
}

function activeChallengeCount(state: ReplayState, owner: string): number {
  return [...state.challenges.values()].filter((challenge) => (
    challenge.owner === owner && challenge.expiresAt > state.now
  )).length;
}

function pruneExpiredChallenges(state: ReplayState, owner: string): void {
  for (const [reference, challenge] of state.challenges) {
    if (challenge.owner === owner && challenge.expiresAt <= state.now) {
      state.challenges.delete(reference);
    }
  }
}

function parseRequirements(value: JsonValue | undefined, label: string): Requirements {
  const object = objectValue(value ?? null, label);
  assertKeys(object, REQUIREMENT_FIELDS, [], label);
  const result = Object.create(null) as unknown as Requirements;
  let total = 0;
  for (const field of REQUIREMENT_FIELDS) {
    const entries = arrayValue(object[field] ?? null, `${label}.${field}`).map((entry, index) => {
      const name = stringValue(entry, `${label}.${field}[${index}]`);
      if (!DOTTED_NAME.test(name) || (field === 'presentation' && name.endsWith('.*'))) {
        throw new ContractViolation('invalid_fixture', `${label}.${field} contains an invalid name`);
      }
      return name;
    });
    if (entries.length > 128 || new Set(entries).size !== entries.length) {
      throw new ContractViolation('invalid_fixture', `${label}.${field} is not bounded and unique`);
    }
    for (let index = 1; index < entries.length; index += 1) {
      if (Buffer.compare(Buffer.from(entries[index - 1] as string), Buffer.from(entries[index] as string)) >= 0) {
        throw new ContractViolation('invalid_fixture', `${label}.${field} is not byte-sorted`);
      }
    }
    total += entries.length;
    result[field] = entries;
  }
  if (total > 256) throw new ContractViolation('invalid_fixture', `${label} has too many entries`);
  return result;
}

function bindingId(record: Omit<ReleaseRecord, 'bindingId'>): string {
  return createHash('sha256').update(JSON.stringify({
    home_id: record.homeId,
    release: record.release,
    abi: record.abi,
    requires: record.requires,
    digest: record.digest,
    size: record.size,
    publisher_principal_id: record.publisherPrincipalId,
  })).digest('base64url');
}

function resourceToken(
  state: ReplayState,
  reference: string,
  scope: AccessScope,
  audience: string,
  homeId?: string,
): TokenRecord | undefined {
  const token = state.tokens.get(reference);
  return token !== undefined
    && token.expiresAt > state.now
    && token.scope === scope
    && token.audience === audience
    && (homeId === undefined || token.homeId === homeId)
    ? token
    : undefined;
}

type PublisherAuthority = { principalId: string } | { error: string };

function publisherAuthority(
  state: ReplayState,
  operation: { [key: string]: JsonValue },
  homeId: string,
  label: string,
): PublisherAuthority {
  if (operation.token_ref !== undefined) {
    const token = resourceToken(
      state,
      safeString(operation.token_ref, `${label}.token_ref`),
      'components:publish',
      COMPONENTS_AUDIENCE,
      homeId,
    );
    return token === undefined
      ? { error: 'invalid_access_token' }
      : { principalId: `home-key:${token.clientId}` };
  }
  const identity = userIdentity(state, operation, label);
  if (identity === undefined) return { error: 'invalid_firebase_token' };
  const home = state.homes.get(homeId);
  if (home === undefined) return { error: 'home_not_found' };
  if (home.owner !== identity.user_id) return { error: 'not_home_owner' };
  if (!recent(identity, state.now)) return { error: 'recent_authentication_required' };
  return { principalId: `owner:${identity.user_id}` };
}

function executeOperation(state: ReplayState, operation: { [key: string]: JsonValue }): OperationResult {
  const kind = stringValue(operation.kind, 'operation.kind') as OperationKind;
  switch (kind) {
    case 'create_home': {
      const identity = userIdentity(state, operation, 'create_home');
      const homeId = safeString(operation.home_id, 'create_home.home_id', HOME_ID_PATTERN);
      const relayUrl = secureSyntheticUrl(operation.relay_url, 'create_home.relay_url', 'wss:');
      if (identity === undefined) return record(state, 'home.create', denied('invalid_firebase_token'));
      if (!recent(identity, state.now)) return record(state, 'home.create', denied('recent_authentication_required'));
      if (ownedHomeCount(state, identity.user_id) >= MAX_OWNED_HOMES) {
        return record(state, 'home.create', denied('limit_exceeded'));
      }
      if (state.homes.has(homeId)) return record(state, 'home.create', denied('home_exists'));
      state.homes.set(homeId, {
        owner: identity.user_id,
        relayUrl,
        generation: 0,
        activeDigest: null,
        finalized: new Map(),
      });
      return record(state, 'home.create', ok());
    }
    case 'create_key': {
      const identity = userIdentity(state, operation, 'create_key');
      if (identity === undefined) return record(state, 'home_key.create', denied('invalid_firebase_token'));
      const homeId = safeString(operation.home_id, 'create_key.home_id', HOME_ID_PATTERN);
      const home = state.homes.get(homeId);
      if (home === undefined) return record(state, 'home_key.create', denied('home_not_found'));
      if (home.owner !== identity.user_id) return record(state, 'home_key.create', denied('not_home_owner'));
      if (!recent(identity, state.now)) {
        return record(state, 'home_key.create', denied('recent_authentication_required'));
      }
      if (activeKeyCount(state, homeId) >= MAX_ACTIVE_HOME_KEYS) {
        return record(state, 'home_key.create', denied('limit_exceeded'));
      }
      const reference = safeString(operation.key_ref, 'create_key.key_ref');
      if (state.keys.has(reference)) throw new ContractViolation('invalid_fixture', 'key_ref repeats');
      const keyId = stringValue(operation.key_id, 'create_key.key_id');
      decodeCanonicalBase64url(keyId, 'create_key.key_id', 16);
      if ([...state.keys.values()].some((key) => key.homeId === homeId && key.keyId === keyId)) {
        throw new ContractViolation('invalid_fixture', 'create_key repeats a key_id within one home');
      }
      const scopes = arrayValue(operation.scopes ?? null, 'create_key.scopes').map((entry, index) => {
        const scope = stringValue(entry, `create_key.scopes[${index}]`) as AccessScope;
        if (!ACCESS_SCOPES.includes(scope)) throw new ContractViolation('invalid_fixture', 'create_key has unknown scope');
        return scope;
      });
      if (scopes.length === 0 || new Set(scopes).size !== scopes.length) {
        throw new ContractViolation('invalid_fixture', 'create_key scope set is invalid');
      }
      const removal = retainedKeyRemoval(state, homeId);
      if (retainedKeyCount(state, homeId) >= MAX_RETAINED_HOME_KEY_RECORDS && removal === undefined) {
        return record(state, 'home_key.create', denied('limit_exceeded'));
      }
      if (removal !== undefined) state.keys.delete(removal);
      state.keys.set(reference, { homeId, keyId, scopes: new Set(scopes), revoked: false });
      return record(state, 'home_key.create', ok());
    }
    case 'revoke_key': {
      const identity = userIdentity(state, operation, 'revoke_key');
      if (identity === undefined) return record(state, 'home_key.revoke', denied('invalid_firebase_token'));
      const homeId = safeString(operation.home_id, 'revoke_key.home_id', HOME_ID_PATTERN);
      const home = state.homes.get(homeId);
      if (home === undefined) return record(state, 'home_key.revoke', denied('home_not_found'));
      if (home.owner !== identity.user_id) return record(state, 'home_key.revoke', denied('not_home_owner'));
      if (!recent(identity, state.now)) {
        return record(state, 'home_key.revoke', denied('recent_authentication_required'));
      }
      const keyId = stringValue(operation.key_id, 'revoke_key.key_id');
      decodeCanonicalBase64url(keyId, 'revoke_key.key_id', 16);
      const key = [...state.keys.values()].find((candidate) => candidate.homeId === homeId && candidate.keyId === keyId);
      if (key !== undefined) key.revoked = true;
      return record(state, 'home_key.revoke', ok());
    }
    case 'exchange': {
      const key = activeKey(state, safeString(operation.key_ref, 'exchange.key_ref'));
      if (key === undefined) return record(state, 'access.exchange', denied('invalid_home_key'));
      const purpose = stringValue(operation.purpose, 'exchange.purpose');
      let scope: AccessScope;
      let audience: string;
      if (purpose === 'relay') {
        const role = stringValue(operation.role, 'exchange.role');
        if (role === 'coordinator') {
          const coordinator = stringValue(operation.coordinator_name, 'exchange.coordinator_name');
          if (!COORDINATOR_NAME_PATTERN.test(coordinator)) {
            throw new ContractViolation('invalid_fixture', 'exchange coordinator_name is invalid');
          }
          scope = 'relay:coordinator';
        } else if (role === 'cli' && operation.coordinator_name === undefined) {
          scope = 'relay:cli';
        } else {
          throw new ContractViolation('invalid_fixture', 'exchange relay role is invalid');
        }
        const home = state.homes.get(key.homeId);
        if (home === undefined) return record(state, 'access.exchange', denied('home_not_found'));
        audience = home.relayUrl;
      } else if (purpose === 'push' && operation.role === undefined && operation.coordinator_name === undefined) {
        scope = 'push:send';
        audience = PUSH_AUDIENCE;
      } else if (purpose === 'components' && operation.role === undefined && operation.coordinator_name === undefined) {
        scope = 'components:publish';
        audience = COMPONENTS_AUDIENCE;
      } else {
        throw new ContractViolation('invalid_fixture', 'exchange purpose is invalid');
      }
      if (!key.scopes.has(scope)) return record(state, 'access.exchange', denied('insufficient_scope'));
      const tokenRef = safeString(operation.token_ref, 'exchange.token_ref');
      if (state.tokens.has(tokenRef) || state.keys.has(tokenRef)) {
        throw new ContractViolation('invalid_fixture', 'token_ref repeats another reference');
      }
      state.tokens.set(tokenRef, {
        homeId: key.homeId,
        clientId: key.keyId,
        scope,
        audience,
        expiresAt: state.now + 300,
      });
      return record(state, 'access.exchange', ok({ scope, audience, client_id: key.keyId }));
    }
    case 'advance_time': {
      const seconds = integerValue(operation.seconds, 'advance_time.seconds');
      if (seconds <= 0 || seconds > 86_400) throw new ContractViolation('invalid_fixture', 'advance_time is out of range');
      state.now += seconds;
      return ok();
    }
    case 'verify_access': {
      const token = state.tokens.get(safeString(operation.token_ref, 'verify_access.token_ref'));
      return token !== undefined && token.expiresAt > state.now ? ok() : denied('invalid_access_token');
    }
    case 'issue_destination_challenge': {
      const identity = userIdentity(state, operation, 'issue_destination_challenge');
      if (identity === undefined) return record(state, 'push.destination.challenge', denied('invalid_firebase_token'));
      pruneExpiredChallenges(state, identity.user_id);
      if (activeChallengeCount(state, identity.user_id) >= MAX_ACTIVE_PUSH_CHALLENGES) {
        return record(state, 'push.destination.challenge', denied('limit_exceeded'));
      }
      const challengeRef = safeString(operation.challenge_ref, 'issue_destination_challenge.challenge_ref');
      if (state.challenges.has(challengeRef)) throw new ContractViolation('invalid_fixture', 'challenge_ref repeats');
      state.challenges.set(challengeRef, {
        owner: identity.user_id,
        appId: safeString(operation.verified_app_id, 'issue_destination_challenge.verified_app_id'),
        deliveryAddress: boundedText(operation.delivery_address, 'issue_destination_challenge.delivery_address', 4_096),
        proofRef: safeString(operation.proof_ref, 'issue_destination_challenge.proof_ref'),
        expiresAt: state.now + 300,
      });
      return record(state, 'push.destination.challenge', ok());
    }
    case 'complete_destination_challenge': {
      const identity = userIdentity(state, operation, 'complete_destination_challenge');
      if (identity === undefined) return record(state, 'push.destination.register', denied('invalid_firebase_token'));
      const challengeRef = safeString(operation.challenge_ref, 'complete_destination_challenge.challenge_ref');
      const challenge = state.challenges.get(challengeRef);
      const proofRef = safeString(operation.proof_ref, 'complete_destination_challenge.proof_ref');
      const appId = safeString(operation.verified_app_id, 'complete_destination_challenge.verified_app_id');
      if (challenge === undefined
        || challenge.expiresAt <= state.now
        || challenge.owner !== identity.user_id
        || challenge.appId !== appId
        || challenge.proofRef !== proofRef) {
        if (challenge !== undefined && challenge.expiresAt <= state.now) state.challenges.delete(challengeRef);
        return record(state, 'push.destination.register', denied('invalid_destination_proof'));
      }
      if (destinationCount(state, identity.user_id) >= MAX_PUSH_DESTINATIONS) {
        return record(state, 'push.destination.register', denied('limit_exceeded'));
      }
      const reference = safeString(operation.destination_ref, 'complete_destination_challenge.destination_ref');
      if (state.destinations.has(reference)) throw new ContractViolation('invalid_fixture', 'destination_ref repeats');
      const destinationId = stringValue(operation.destination_id, 'complete_destination_challenge.destination_id');
      decodeCanonicalBase64url(destinationId, 'complete_destination_challenge.destination_id', 16);
      if ([...state.destinations.values()].some((destination) => (
        destination.owner === identity.user_id && destination.destinationId === destinationId
      ))) {
        throw new ContractViolation('invalid_fixture', 'destination_id repeats within one user');
      }
      state.challenges.delete(challengeRef);
      state.destinations.set(reference, {
        owner: identity.user_id,
        appId,
        destinationId,
        active: true,
      });
      return record(state, 'push.destination.register', ok());
    }
    case 'create_grant': {
      const identity = userIdentity(state, operation, 'create_grant');
      if (identity === undefined) return record(state, 'push.grant.create', denied('invalid_firebase_token'));
      const homeId = safeString(operation.home_id, 'create_grant.home_id', HOME_ID_PATTERN);
      if (!state.homes.has(homeId)) return record(state, 'push.grant.create', denied('home_not_found'));
      const destinationRef = safeString(operation.destination_ref, 'create_grant.destination_ref');
      const destination = state.destinations.get(destinationRef);
      if (destination === undefined || !destination.active || destination.owner !== identity.user_id) {
        return record(state, 'push.grant.create', denied('invalid_push_grant'));
      }
      const replacement = [...state.grants.values()].find((grant) => (
        grant.owner === identity.user_id
        && grant.homeId === homeId
        && grant.destinationRef === destinationRef
        && !grant.revoked
        && grant.expiresAt > state.now
      ));
      const lifetime = integerValue(operation.lifetime_seconds, 'create_grant.lifetime_seconds');
      if (lifetime <= 0 || lifetime > 15_552_000) {
        throw new ContractViolation('invalid_fixture', 'grant lifetime exceeds 180 days');
      }
      const grantRef = safeString(operation.grant_ref, 'create_grant.grant_ref');
      if (state.grants.has(grantRef)) throw new ContractViolation('invalid_fixture', 'grant_ref repeats');
      const grantId = stringValue(operation.grant_id, 'create_grant.grant_id');
      decodeCanonicalBase64url(grantId, 'create_grant.grant_id', 16);
      if ([...state.grants.values()].some((grant) => grant.homeId === homeId && grant.grantId === grantId)) {
        throw new ContractViolation('invalid_fixture', 'grant_id repeats within one home');
      }
      const removal = retainedGrantRemoval(state, homeId, identity.user_id, replacement);
      if (retainedGrantCount(state, homeId, identity.user_id) >= MAX_RETAINED_GRANT_RECORDS
        && removal === undefined) {
        return record(state, 'push.grant.create', denied('limit_exceeded'));
      }
      if (replacement !== undefined) replacement.revoked = true;
      if (removal !== undefined) state.grants.delete(removal);
      state.grants.set(grantRef, {
        grantId,
        owner: identity.user_id,
        homeId,
        destinationRef,
        expiresAt: state.now + lifetime,
        revoked: false,
      });
      return record(state, 'push.grant.create', ok());
    }
    case 'revoke_grant': {
      const identity = userIdentity(state, operation, 'revoke_grant');
      if (identity === undefined) return record(state, 'push.grant.revoke', denied('invalid_firebase_token'));
      const homeId = safeString(operation.home_id, 'revoke_grant.home_id', HOME_ID_PATTERN);
      const grantId = stringValue(operation.grant_id, 'revoke_grant.grant_id');
      decodeCanonicalBase64url(grantId, 'revoke_grant.grant_id', 16);
      const grant = [...state.grants.values()].find((candidate) => (
        candidate.grantId === grantId && candidate.homeId === homeId && candidate.owner === identity.user_id
      ));
      if (grant !== undefined) grant.revoked = true;
      return record(state, 'push.grant.revoke', ok());
    }
    case 'delete_destination': {
      const identity = userIdentity(state, operation, 'delete_destination');
      if (identity === undefined) return record(state, 'push.destination.delete', denied('invalid_firebase_token'));
      safeString(operation.verified_app_id, 'delete_destination.verified_app_id');
      const destinationId = stringValue(operation.destination_id, 'delete_destination.destination_id');
      decodeCanonicalBase64url(destinationId, 'delete_destination.destination_id', 16);
      const destinationEntry = [...state.destinations.entries()].find(([, candidate]) => (
        candidate.destinationId === destinationId && candidate.owner === identity.user_id
      ));
      if (destinationEntry !== undefined) {
        const [reference] = destinationEntry;
        for (const grant of state.grants.values()) {
          if (grant.destinationRef === reference) grant.revoked = true;
        }
        state.destinations.delete(reference);
      }
      return record(state, 'push.destination.delete', ok());
    }
    case 'send_push': {
      const token = resourceToken(
        state,
        safeString(operation.token_ref, 'send_push.token_ref'),
        'push:send',
        PUSH_AUDIENCE,
      );
      if (token === undefined) return record(state, 'push.send', denied('invalid_access_token'));
      const grant = state.grants.get(safeString(operation.grant_ref, 'send_push.grant_ref'));
      const destination = grant === undefined ? undefined : state.destinations.get(grant.destinationRef);
      if (grant === undefined
        || grant.revoked
        || grant.expiresAt <= state.now
        || grant.homeId !== token.homeId
        || destination === undefined
        || !destination.active
        || destination.owner !== grant.owner) {
        return record(state, 'push.send', denied('invalid_push_grant'));
      }
      return record(state, 'push.send', ok());
    }
    case 'request_upload': {
      const homeId = safeString(operation.home_id, 'request_upload.home_id', HOME_ID_PATTERN);
      const authority = publisherAuthority(state, operation, homeId, 'request_upload');
      if ('error' in authority) return record(state, 'component.upload.issue', denied(authority.error));
      if (!state.homes.has(homeId)) return record(state, 'component.upload.issue', denied('home_not_found'));
      const uploadRef = safeString(operation.upload_ref, 'request_upload.upload_ref');
      const capabilityRef = safeString(operation.capability_ref, 'request_upload.capability_ref');
      if (state.uploads.has(uploadRef)) throw new ContractViolation('invalid_fixture', 'upload_ref repeats');
      const digest = stringValue(operation.digest, 'request_upload.digest');
      decodeCanonicalBase64url(digest, 'request_upload.digest', 32);
      const size = integerValue(operation.size, 'request_upload.size');
      if (size <= 0) return record(state, 'component.upload.issue', denied('invalid_request'));
      if (size > 2_097_152) return record(state, 'component.upload.issue', denied('limit_exceeded'));
      const release = boundedText(operation.release, 'request_upload.release', 64);
      if (operation.abi !== 'miakapp.component/1') {
        throw new ContractViolation('invalid_fixture', 'request_upload.abi is unsupported');
      }
      const requires = parseRequirements(operation.requires, 'request_upload.requires');
      const base: Omit<ReleaseRecord, 'bindingId'> = {
        homeId,
        digest,
        size,
        release,
        abi: 'miakapp.component/1',
        requires,
        publisherPrincipalId: authority.principalId,
      };
      const bound = bindingId(base);
      state.uploads.set(uploadRef, {
        ...base,
        bindingId: bound,
        capabilityRef,
        expiresAt: state.now + 900,
        capabilityConsumed: false,
        delivery: null,
      });
      return record(state, 'component.upload.issue', ok({ binding_id: bound }));
    }
    case 'deliver_upload': {
      const upload = state.uploads.get(safeString(operation.upload_ref, 'deliver_upload.upload_ref'));
      const capabilityRef = safeString(operation.capability_ref, 'deliver_upload.capability_ref');
      if (upload === undefined
        || upload.capabilityRef !== capabilityRef
        || upload.capabilityConsumed
        || upload.expiresAt <= state.now) {
        return record(state, 'component.upload.deliver', denied('invalid_upload_capability'));
      }
      const artifactSource = stringValue(operation.artifact_source, 'deliver_upload.artifact_source');
      const evidence = inspectArtifactSource(artifactSource);
      if (evidence.size <= 0 || evidence.size > 2_097_152) {
        return record(state, 'component.upload.deliver', denied('invalid_artifact'));
      }
      upload.capabilityConsumed = true;
      upload.delivery = evidence;
      return record(state, 'component.upload.deliver', ok());
    }
    case 'inspect_upload': {
      const homeId = safeString(operation.home_id, 'inspect_upload.home_id', HOME_ID_PATTERN);
      const authority = publisherAuthority(state, operation, homeId, 'inspect_upload');
      if ('error' in authority) return denied(authority.error);
      const home = state.homes.get(homeId);
      const upload = state.uploads.get(safeString(operation.upload_ref, 'inspect_upload.upload_ref'));
      if (home === undefined || upload === undefined || upload.homeId !== homeId) return denied('invalid_artifact');
      if (upload.publisherPrincipalId !== authority.principalId) return denied('publisher_mismatch');
      const finalized = home.finalized.get(upload.digest) === upload;
      return ok({
        binding_id: upload.bindingId,
        status: finalized ? 'finalized' : upload.delivery === null ? 'awaiting_upload' : 'delivered',
      });
    }
    case 'finalize_release': {
      const homeId = safeString(operation.home_id, 'finalize_release.home_id', HOME_ID_PATTERN);
      const authority = publisherAuthority(state, operation, homeId, 'finalize_release');
      if ('error' in authority) return record(state, 'component.finalize', denied(authority.error));
      const home = state.homes.get(homeId);
      if (home === undefined) return record(state, 'component.finalize', denied('home_not_found'));
      const upload = state.uploads.get(safeString(operation.upload_ref, 'finalize_release.upload_ref'));
      if (upload === undefined
        || upload.homeId !== homeId
        || upload.delivery === null
        || upload.delivery.digest !== upload.digest
        || upload.delivery.size !== upload.size
        || !upload.delivery.syntaxValid) {
        return record(state, 'component.finalize', denied('invalid_artifact'));
      }
      if (upload.publisherPrincipalId !== authority.principalId) {
        return record(state, 'component.finalize', denied('publisher_mismatch'));
      }
      const existing = home.finalized.get(upload.digest);
      if (existing !== undefined && existing.bindingId !== upload.bindingId) {
        return record(state, 'component.finalize', denied('invalid_artifact'));
      }
      home.finalized.set(upload.digest, upload);
      return record(state, 'component.finalize', ok({ binding_id: upload.bindingId }));
    }
    case 'inspect_release': {
      const homeId = safeString(operation.home_id, 'inspect_release.home_id', HOME_ID_PATTERN);
      const authority = publisherAuthority(state, operation, homeId, 'inspect_release');
      if ('error' in authority) return denied(authority.error);
      const home = state.homes.get(homeId);
      const digest = stringValue(operation.digest, 'inspect_release.digest');
      decodeCanonicalBase64url(digest, 'inspect_release.digest', 32);
      const release = home?.finalized.get(digest);
      return release === undefined
        ? denied('invalid_artifact')
        : ok({ binding_id: release.bindingId, status: 'finalized' });
    }
    case 'activate_release': {
      const homeId = safeString(operation.home_id, 'activate_release.home_id', HOME_ID_PATTERN);
      const authority = publisherAuthority(state, operation, homeId, 'activate_release');
      if ('error' in authority) return record(state, 'component.activate', denied(authority.error));
      const home = state.homes.get(homeId);
      if (home === undefined) return record(state, 'component.activate', denied('home_not_found'));
      const digest = stringValue(operation.digest, 'activate_release.digest');
      decodeCanonicalBase64url(digest, 'activate_release.digest', 32);
      const expectedGeneration = integerValue(operation.expected_generation, 'activate_release.expected_generation');
      const generation = integerValue(operation.generation, 'activate_release.generation');
      if (expectedGeneration !== home.generation || generation <= expectedGeneration) {
        return record(state, 'component.activate', denied('generation_conflict'));
      }
      if (!home.finalized.has(digest)) return record(state, 'component.activate', denied('invalid_artifact'));
      if (state.quarantined.has(digest)) return record(state, 'component.activate', denied('digest_quarantined'));
      home.generation = generation;
      home.activeDigest = digest;
      return record(state, 'component.activate', ok());
    }
    case 'quarantine_digest': {
      const digest = stringValue(operation.digest, 'quarantine_digest.digest');
      decodeCanonicalBase64url(digest, 'quarantine_digest.digest', 32);
      state.quarantined.add(digest);
      return record(state, 'component.quarantine', ok());
    }
  }
}

function assertResult(actual: OperationResult, expected: OperationResult, scenario: string, index: number): void {
  const fields = new Set([...Object.keys(actual), ...Object.keys(expected)]);
  for (const field of fields) {
    const key = field as keyof OperationResult;
    if (actual[key] !== expected[key]) {
      throw new ContractViolation(
        'scenario_mismatch',
        `${scenario} operation ${index} expected ${field}=${String(expected[key])}, received ${String(actual[key])}`,
      );
    }
  }
}

function byteCompare(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

function finalProjection(state: ReplayState): Scenario['expected_final'] {
  const homes = [...state.homes.entries()].sort(([left], [right]) => byteCompare(left, right)).map(([homeId, home]) => ({
    home_id: homeId,
    active_keys: activeKeyCount(state, homeId),
    active_grants: activeGrantCount(state, homeId),
    generation: home.generation,
    active_digest: home.activeDigest,
  }));
  return { homes, audit: state.audit.map((event) => ({ ...event })) };
}

function equalJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function operationField(entry: ExecutedOperation, field: string): JsonValue | undefined {
  return entry.operation[field];
}

function operationIs(
  entry: ExecutedOperation,
  kind: OperationKind,
  outcome: OperationResult['outcome'],
  code: string | null,
): boolean {
  return entry.operation.kind === kind && entry.result.outcome === outcome && entry.result.code === code;
}

function activeGrantEvidenceBefore(
  executed: readonly ExecutedOperation[],
  before: ExecutedOperation,
  userToken: JsonValue | undefined,
  homeId: JsonValue | undefined,
): Map<JsonValue | undefined, ExecutedOperation> {
  const active = new Map<JsonValue | undefined, ExecutedOperation>();
  const destinations = new Map<JsonValue | undefined, JsonValue | undefined>();
  for (const entry of executed) {
    if (entry.index >= before.index) break;
    if (operationIs(entry, 'complete_destination_challenge', 'ok', null)
      && operationField(entry, 'user_token') === userToken) {
      destinations.set(operationField(entry, 'destination_id'), operationField(entry, 'destination_ref'));
      continue;
    }
    if (operationIs(entry, 'create_grant', 'ok', null)
      && operationField(entry, 'user_token') === userToken
      && operationField(entry, 'home_id') === homeId) {
      active.set(operationField(entry, 'destination_ref'), entry);
      continue;
    }
    if (operationIs(entry, 'revoke_grant', 'ok', null)
      && operationField(entry, 'user_token') === userToken
      && operationField(entry, 'home_id') === homeId) {
      for (const [destination, grant] of active) {
        if (operationField(grant, 'grant_id') === operationField(entry, 'grant_id')) active.delete(destination);
      }
      continue;
    }
    if (operationIs(entry, 'delete_destination', 'ok', null)
      && operationField(entry, 'user_token') === userToken) {
      active.delete(destinations.get(operationField(entry, 'destination_id')));
    }
  }
  for (const [destination, grant] of active) {
    const lifetime = operationField(grant, 'lifetime_seconds');
    if (typeof lifetime !== 'number' || grant.at + lifetime <= before.at) active.delete(destination);
  }
  return active;
}

function assertCoverageEvidence(scenario: Scenario, executed: ExecutedOperation[]): void {
  const fail = (coverage: Coverage): never => {
    throw new ContractViolation('missing_coverage', `${scenario.id} does not exercise ${coverage}`);
  };
  const some = (predicate: (entry: ExecutedOperation) => boolean): boolean => executed.some(predicate);
  for (const coverage of scenario.coverage) {
    switch (coverage) {
      case 'owner_bootstrap':
        if (!some((entry) => operationIs(entry, 'create_home', 'ok', null))
          || !some((entry) => operationIs(entry, 'create_key', 'error', 'not_home_owner'))) fail(coverage);
        break;
      case 'recent_authentication':
        if (!some((entry) => operationIs(entry, 'create_key', 'error', 'recent_authentication_required')
          && operationField(entry, 'user_token') === 'firebase_stale_authentication')) fail(coverage);
        break;
      case 'home_key_scope': {
        const successfulKeys = new Set(executed.filter((entry) => operationIs(entry, 'exchange', 'ok', null))
          .map((entry) => operationField(entry, 'key_ref')));
        if (!some((entry) => operationIs(entry, 'exchange', 'error', 'insufficient_scope')
          && successfulKeys.has(operationField(entry, 'key_ref')))) fail(coverage);
        break;
      }
      case 'home_key_revocation': {
        const creations = executed.filter((entry) => operationIs(entry, 'create_key', 'ok', null));
        const revocations = executed.filter((entry) => operationIs(entry, 'revoke_key', 'ok', null));
        const active = revocations.find((revocation) => creations.some((creation) => (
          operationField(creation, 'home_id') === operationField(revocation, 'home_id')
          && operationField(creation, 'key_id') === operationField(revocation, 'key_id')
          && operationField(creation, 'user_token') === operationField(revocation, 'user_token')
          && some((exchange) => exchange.index > revocation.index
            && operationIs(exchange, 'exchange', 'error', 'invalid_home_key')
            && operationField(exchange, 'key_ref') === operationField(creation, 'key_ref'))
        )));
        const repeated = active !== undefined && revocations.some((entry) => entry.index > active.index
          && operationField(entry, 'home_id') === operationField(active, 'home_id')
          && operationField(entry, 'key_id') === operationField(active, 'key_id')
          && operationField(entry, 'user_token') === operationField(active, 'user_token'));
        const absent = revocations.some((revocation) => !creations.some((creation) => (
          operationField(creation, 'home_id') === operationField(revocation, 'home_id')
          && operationField(creation, 'key_id') === operationField(revocation, 'key_id')
        )));
        if (active === undefined || !repeated || !absent) fail(coverage);
        break;
      }
      case 'uniform_revocation': {
        const grantCreations = executed.filter((entry) => operationIs(entry, 'create_grant', 'ok', null));
        const grantDeletes = executed.filter((entry) => operationIs(entry, 'revoke_grant', 'ok', null));
        const activeGrantDelete = grantDeletes.find((deletion) => grantCreations.some((creation) => (
          operationField(creation, 'home_id') === operationField(deletion, 'home_id')
          && operationField(creation, 'grant_id') === operationField(deletion, 'grant_id')
          && operationField(creation, 'user_token') === operationField(deletion, 'user_token')
        )));
        const repeatedGrant = activeGrantDelete !== undefined && grantDeletes.some((entry) => (
          entry.index > activeGrantDelete.index
          && operationField(entry, 'home_id') === operationField(activeGrantDelete, 'home_id')
          && operationField(entry, 'grant_id') === operationField(activeGrantDelete, 'grant_id')
          && operationField(entry, 'user_token') === operationField(activeGrantDelete, 'user_token')
        ));
        const foreignGrant = grantDeletes.some((deletion) => grantCreations.some((creation) => (
          operationField(creation, 'home_id') === operationField(deletion, 'home_id')
          && operationField(creation, 'grant_id') === operationField(deletion, 'grant_id')
          && operationField(creation, 'user_token') !== operationField(deletion, 'user_token')
        )));
        const absentGrant = grantDeletes.some((deletion) => !grantCreations.some((creation) => (
          creation.index < deletion.index
          && operationField(creation, 'home_id') === operationField(deletion, 'home_id')
          && operationField(creation, 'grant_id') === operationField(deletion, 'grant_id')
        )));
        const destinationCreations = executed.filter((entry) => operationIs(
          entry,
          'complete_destination_challenge',
          'ok',
          null,
        ));
        const destinationDeletes = executed.filter((entry) => operationIs(entry, 'delete_destination', 'ok', null));
        const activeDestinationDelete = destinationDeletes.find((deletion) => destinationCreations.some((creation) => (
          operationField(creation, 'destination_id') === operationField(deletion, 'destination_id')
          && operationField(creation, 'user_token') === operationField(deletion, 'user_token')
        )));
        const repeatedDestination = activeDestinationDelete !== undefined && destinationDeletes.some((entry) => (
          entry.index > activeDestinationDelete.index
          && operationField(entry, 'destination_id') === operationField(activeDestinationDelete, 'destination_id')
          && operationField(entry, 'user_token') === operationField(activeDestinationDelete, 'user_token')
        ));
        const foreignDestination = destinationDeletes.some((deletion) => destinationCreations.some((creation) => (
          operationField(creation, 'destination_id') === operationField(deletion, 'destination_id')
          && operationField(creation, 'user_token') !== operationField(deletion, 'user_token')
        )));
        const absentDestination = destinationDeletes.some((deletion) => !destinationCreations.some((creation) => (
          operationField(creation, 'destination_id') === operationField(deletion, 'destination_id')
          && operationField(creation, 'user_token') === operationField(deletion, 'user_token')
        )));
        if (activeGrantDelete === undefined
          || !repeatedGrant
          || !foreignGrant
          || !absentGrant
          || activeDestinationDelete === undefined
          || !repeatedDestination
          || !foreignDestination
          || !absentDestination) fail(coverage);
        break;
      }
      case 'access_lease': {
        const issued = new Set(executed.filter((entry) => operationIs(entry, 'exchange', 'ok', null))
          .map((entry) => operationField(entry, 'token_ref')));
        if (!some((accepted) => operationIs(accepted, 'verify_access', 'ok', null)
          && issued.has(operationField(accepted, 'token_ref'))
          && some((expired) => expired.index > accepted.index
            && operationIs(expired, 'verify_access', 'error', 'invalid_access_token')
            && operationField(expired, 'token_ref') === operationField(accepted, 'token_ref')))) fail(coverage);
        break;
      }
      case 'resource_token_authority': {
        const keyRefs = new Set(executed.filter((entry) => operationIs(entry, 'create_key', 'ok', null))
          .map((entry) => operationField(entry, 'key_ref')));
        const directKeyDenied = some((entry) => (
          (entry.operation.kind === 'send_push' || entry.operation.kind === 'request_upload')
          && entry.result.code === 'invalid_access_token'
          && keyRefs.has(operationField(entry, 'token_ref'))
        ));
        const successfulPushToken = some((exchange) => operationIs(exchange, 'exchange', 'ok', null)
          && exchange.result.scope === 'push:send'
          && some((send) => send.index > exchange.index
            && (operationIs(send, 'send_push', 'ok', null)
              || operationIs(send, 'send_push', 'error', 'invalid_push_grant'))
            && operationField(send, 'token_ref') === operationField(exchange, 'token_ref')));
        const successfulComponentToken = some((exchange) => operationIs(exchange, 'exchange', 'ok', null)
          && exchange.result.scope === 'components:publish'
          && some((request) => request.index > exchange.index
            && operationIs(request, 'request_upload', 'ok', null)
            && operationField(request, 'token_ref') === operationField(exchange, 'token_ref')));
        if (!directKeyDenied || !successfulPushToken || !successfulComponentToken) fail(coverage);
        break;
      }
      case 'destination_possession': {
        const completeProofFlow = some((challenge) => {
          if (!operationIs(challenge, 'issue_destination_challenge', 'ok', null)) return false;
          const completions = executed.filter((entry) => entry.index > challenge.index
            && entry.operation.kind === 'complete_destination_challenge'
            && operationField(entry, 'challenge_ref') === operationField(challenge, 'challenge_ref'));
          const success = completions.find((entry) => operationIs(entry, 'complete_destination_challenge', 'ok', null));
          if (success === undefined
            || operationField(success, 'user_token') !== operationField(challenge, 'user_token')
            || operationField(success, 'verified_app_id') !== operationField(challenge, 'verified_app_id')
            || operationField(success, 'proof_ref') !== operationField(challenge, 'proof_ref')) return false;
          const denied = (predicate: (entry: ExecutedOperation) => boolean): boolean => completions.some((entry) => (
            operationIs(entry, 'complete_destination_challenge', 'error', 'invalid_destination_proof')
            && predicate(entry)
          ));
          const wrongUser = denied((entry) => operationField(entry, 'user_token') !== operationField(challenge, 'user_token')
            && operationField(entry, 'verified_app_id') === operationField(challenge, 'verified_app_id')
            && operationField(entry, 'proof_ref') === operationField(challenge, 'proof_ref'));
          const wrongApp = denied((entry) => operationField(entry, 'user_token') === operationField(challenge, 'user_token')
            && operationField(entry, 'verified_app_id') !== operationField(challenge, 'verified_app_id')
            && operationField(entry, 'proof_ref') === operationField(challenge, 'proof_ref'));
          const wrongProof = denied((entry) => operationField(entry, 'user_token') === operationField(challenge, 'user_token')
            && operationField(entry, 'verified_app_id') === operationField(challenge, 'verified_app_id')
            && operationField(entry, 'proof_ref') !== operationField(challenge, 'proof_ref'));
          const replay = completions.some((entry) => entry.index > success.index
            && operationIs(entry, 'complete_destination_challenge', 'error', 'invalid_destination_proof')
            && operationField(entry, 'user_token') === operationField(success, 'user_token')
            && operationField(entry, 'verified_app_id') === operationField(success, 'verified_app_id')
            && operationField(entry, 'proof_ref') === operationField(success, 'proof_ref'));
          return wrongUser && wrongApp && wrongProof && replay;
        });
        const causalExpiry = some((challenge) => operationIs(
          challenge,
          'issue_destination_challenge',
          'ok',
          null,
        ) && some((completion) => completion.index > challenge.index
          && completion.at >= challenge.at + 300
          && operationIs(completion, 'complete_destination_challenge', 'error', 'invalid_destination_proof')
          && operationField(completion, 'challenge_ref') === operationField(challenge, 'challenge_ref')
          && operationField(completion, 'user_token') === operationField(challenge, 'user_token')
          && operationField(completion, 'verified_app_id') === operationField(challenge, 'verified_app_id')
          && operationField(completion, 'proof_ref') === operationField(challenge, 'proof_ref'))
          && !some((completion) => completion.index > challenge.index
            && operationIs(completion, 'complete_destination_challenge', 'ok', null)
            && operationField(completion, 'challenge_ref') === operationField(challenge, 'challenge_ref')));
        if (!completeProofFlow || !causalExpiry) fail(coverage);
        break;
      }
      case 'push_consent':
        if (!some((grant) => operationIs(grant, 'create_grant', 'ok', null)
          && some((send) => send.index > grant.index
            && operationIs(send, 'send_push', 'ok', null)
            && operationField(send, 'grant_ref') === operationField(grant, 'grant_ref')))) fail(coverage);
        break;
      case 'push_cross_home': {
        const tokens = new Map(executed.filter((entry) => operationIs(entry, 'exchange', 'ok', null))
          .map((entry) => [operationField(entry, 'token_ref'), operationField(entry, 'key_ref')]));
        const keys = new Map(executed.filter((entry) => operationIs(entry, 'create_key', 'ok', null))
          .map((entry) => [operationField(entry, 'key_ref'), operationField(entry, 'home_id')]));
        const grants = new Map(executed.filter((entry) => operationIs(entry, 'create_grant', 'ok', null))
          .map((entry) => [operationField(entry, 'grant_ref'), operationField(entry, 'home_id')]));
        if (!some((entry) => operationIs(entry, 'send_push', 'error', 'invalid_push_grant')
          && keys.get(tokens.get(operationField(entry, 'token_ref'))) !== grants.get(operationField(entry, 'grant_ref')))) fail(coverage);
        break;
      }
      case 'push_expiry': {
        const hasCausalExpiry = executed.some((grant) => {
          if (!operationIs(grant, 'create_grant', 'ok', null)) return false;
          const lifetime = operationField(grant, 'lifetime_seconds');
          if (typeof lifetime !== 'number') return false;
          const accepted = executed.find((entry) => entry.index > grant.index
            && operationIs(entry, 'send_push', 'ok', null)
            && operationField(entry, 'grant_ref') === operationField(grant, 'grant_ref'));
          const expired = executed.find((entry) => entry.index > (accepted?.index ?? Number.MAX_SAFE_INTEGER)
            && operationIs(entry, 'send_push', 'error', 'invalid_push_grant')
            && operationField(entry, 'grant_ref') === operationField(grant, 'grant_ref')
            && entry.at >= grant.at + lifetime);
          if (accepted === undefined || expired === undefined) return false;
          return !executed.some((invalidator) => invalidator.index > grant.index
            && invalidator.index < expired.index
            && (invalidator.operation.kind === 'revoke_grant'
              || invalidator.operation.kind === 'delete_destination'
              || (operationIs(invalidator, 'create_grant', 'ok', null)
                && operationField(invalidator, 'user_token') === operationField(grant, 'user_token')
                && operationField(invalidator, 'home_id') === operationField(grant, 'home_id')
                && operationField(invalidator, 'destination_ref') === operationField(grant, 'destination_ref'))));
        });
        if (!hasCausalExpiry) fail(coverage);
        break;
      }
      case 'push_revocation': {
        const explicit = some((revocation) => operationIs(revocation, 'revoke_grant', 'ok', null)
          && some((grant) => grant.index < revocation.index
            && operationIs(grant, 'create_grant', 'ok', null)
            && operationField(grant, 'home_id') === operationField(revocation, 'home_id')
            && operationField(grant, 'grant_id') === operationField(revocation, 'grant_id')
            && operationField(grant, 'user_token') === operationField(revocation, 'user_token')
            && some((send) => send.index > revocation.index
              && operationIs(send, 'send_push', 'error', 'invalid_push_grant')
              && operationField(send, 'grant_ref') === operationField(grant, 'grant_ref'))));
        const destination = some((deletion) => operationIs(deletion, 'delete_destination', 'ok', null)
          && some((registered) => registered.index < deletion.index
            && operationIs(registered, 'complete_destination_challenge', 'ok', null)
            && operationField(registered, 'destination_id') === operationField(deletion, 'destination_id')
            && operationField(registered, 'user_token') === operationField(deletion, 'user_token')
            && some((grant) => grant.index > registered.index && grant.index < deletion.index
              && operationIs(grant, 'create_grant', 'ok', null)
              && operationField(grant, 'destination_ref') === operationField(registered, 'destination_ref')
              && some((send) => send.index > deletion.index
                && operationIs(send, 'send_push', 'error', 'invalid_push_grant')
                && operationField(send, 'grant_ref') === operationField(grant, 'grant_ref')))));
        if (!explicit || !destination) fail(coverage);
        break;
      }
      case 'publication_upload_binding': {
        const requests = executed.filter((entry) => operationIs(entry, 'request_upload', 'ok', null));
        const fullTuple = requests.some((request) => request.result.binding_id !== undefined
          && ['home_id', 'release', 'abi', 'requires', 'digest', 'size', 'capability_ref']
            .every((field) => operationField(request, field) !== undefined));
        const capabilityDenial = some((delivery) => operationIs(delivery, 'deliver_upload', 'ok', null)
          && some((reuse) => reuse.index > delivery.index
            && operationIs(reuse, 'deliver_upload', 'error', 'invalid_upload_capability')
            && operationField(reuse, 'upload_ref') === operationField(delivery, 'upload_ref')
            && operationField(reuse, 'capability_ref') === operationField(delivery, 'capability_ref')));
        const publisherDenial = some((entry) => operationIs(entry, 'finalize_release', 'error', 'publisher_mismatch'));
        const matchingFinalize = requests.some((request) => some((finalize) => finalize.index > request.index
          && operationIs(finalize, 'finalize_release', 'ok', null)
          && operationField(finalize, 'upload_ref') === operationField(request, 'upload_ref')
          && finalize.result.binding_id === request.result.binding_id));
        if (!fullTuple || !capabilityDenial || !publisherDenial || !matchingFinalize) fail(coverage);
        break;
      }
      case 'publication_readback': {
        const requests = new Map(executed.filter((entry) => operationIs(entry, 'request_upload', 'ok', null))
          .map((entry) => [operationField(entry, 'upload_ref'), entry]));
        if (!some((delivery) => {
          if (!operationIs(delivery, 'deliver_upload', 'ok', null)) return false;
          const request = requests.get(operationField(delivery, 'upload_ref'));
          if (request === undefined) return false;
          const source = operationField(delivery, 'artifact_source');
          if (typeof source !== 'string') return false;
          const evidence = inspectArtifactSource(source);
          const mismatches = evidence.digest !== operationField(request, 'digest')
            || evidence.size !== operationField(request, 'size')
            || !evidence.syntaxValid;
          return mismatches && some((rejected) => rejected.index > delivery.index
            && operationIs(rejected, 'finalize_release', 'error', 'invalid_artifact')
            && operationField(rejected, 'upload_ref') === operationField(delivery, 'upload_ref'));
        })) fail(coverage);
        break;
      }
      case 'publication_owner_authority': {
        const ownerRequest = executed.find((entry) => operationIs(entry, 'request_upload', 'ok', null)
          && operationField(entry, 'user_token') !== undefined);
        if (ownerRequest === undefined
          || !some((entry) => operationIs(entry, 'request_upload', 'error', 'recent_authentication_required')
            && operationField(entry, 'user_token') === 'firebase_stale_authentication')
          || !some((entry) => operationIs(entry, 'request_upload', 'error', 'not_home_owner'))
          || !some((entry) => entry.index > ownerRequest.index
            && operationIs(entry, 'finalize_release', 'ok', null)
            && operationField(entry, 'user_token') === operationField(ownerRequest, 'user_token')
            && operationField(entry, 'upload_ref') === operationField(ownerRequest, 'upload_ref'))) fail(coverage);
        break;
      }
      case 'publication_reconciliation': {
        const exchanges = new Map(executed.filter((entry) => operationIs(entry, 'exchange', 'ok', null))
          .map((entry) => [operationField(entry, 'token_ref'), entry.result.client_id]));
        if (!some((request) => operationIs(request, 'request_upload', 'ok', null)
          && typeof operationField(request, 'token_ref') === 'string'
          && some((delivery) => delivery.index > request.index
            && operationIs(delivery, 'deliver_upload', 'ok', null)
            && operationField(delivery, 'upload_ref') === operationField(request, 'upload_ref')
            && some((uploadRead) => uploadRead.index > delivery.index
              && operationIs(uploadRead, 'inspect_upload', 'ok', null)
              && uploadRead.result.status === 'delivered'
              && uploadRead.result.binding_id === request.result.binding_id
              && operationField(uploadRead, 'upload_ref') === operationField(request, 'upload_ref'))
            && some((finalize) => finalize.index > delivery.index
              && finalize.at > request.at + 900
              && operationIs(finalize, 'finalize_release', 'ok', null)
              && operationField(finalize, 'upload_ref') === operationField(request, 'upload_ref')
              && operationField(finalize, 'token_ref') !== operationField(request, 'token_ref')
              && exchanges.get(operationField(finalize, 'token_ref'))
                === exchanges.get(operationField(request, 'token_ref'))
              && some((releaseRead) => releaseRead.index > finalize.index
                && operationIs(releaseRead, 'inspect_release', 'ok', null)
                && releaseRead.result.status === 'finalized'
                && releaseRead.result.binding_id === request.result.binding_id
                && operationField(releaseRead, 'digest') === operationField(request, 'digest')))))) fail(coverage);
        break;
      }
      case 'publication_cas':
        if (!some((activation) => operationIs(activation, 'activate_release', 'ok', null)
          && some((conflict) => conflict.index > activation.index
            && operationIs(conflict, 'activate_release', 'error', 'generation_conflict')
            && operationField(conflict, 'home_id') === operationField(activation, 'home_id')))) fail(coverage);
        break;
      case 'digest_quarantine': {
        const requests = new Map(executed.filter((entry) => operationIs(entry, 'request_upload', 'ok', null))
          .map((entry) => [operationField(entry, 'upload_ref'), entry]));
        if (!some((quarantine) => operationIs(quarantine, 'quarantine_digest', 'ok', null)
          && some((prior) => prior.index < quarantine.index
            && operationIs(prior, 'activate_release', 'ok', null)
            && operationField(prior, 'digest') === operationField(quarantine, 'digest'))
          && some((deniedActivation) => deniedActivation.index > quarantine.index
            && operationIs(deniedActivation, 'activate_release', 'error', 'digest_quarantined')
            && operationField(deniedActivation, 'digest') === operationField(quarantine, 'digest'))
          && some((rollback) => rollback.index > quarantine.index
            && operationIs(rollback, 'activate_release', 'ok', null)
            && operationField(rollback, 'digest') !== operationField(quarantine, 'digest')
            && some((verifiedBefore) => {
              const request = requests.get(operationField(verifiedBefore, 'upload_ref'));
              return verifiedBefore.index < quarantine.index
                && operationIs(verifiedBefore, 'finalize_release', 'ok', null)
                && operationField(verifiedBefore, 'home_id') === operationField(rollback, 'home_id')
                && request !== undefined
                && operationField(request, 'digest') === operationField(rollback, 'digest');
            })))) fail(coverage);
        break;
      }
      case 'admission_limits':
        if (!some((homeDenial) => operationIs(homeDenial, 'create_home', 'error', 'limit_exceeded')
          && executed.filter((entry) => entry.index < homeDenial.index
            && operationIs(entry, 'create_home', 'ok', null)
            && operationField(entry, 'user_token') === operationField(homeDenial, 'user_token')).length
              === MAX_OWNED_HOMES)
          || !some((keyDenial) => operationIs(keyDenial, 'create_key', 'error', 'limit_exceeded')
            && executed.filter((entry) => entry.index < keyDenial.index
              && operationIs(entry, 'create_key', 'ok', null)
              && operationField(entry, 'home_id') === operationField(keyDenial, 'home_id')).length
                === MAX_ACTIVE_HOME_KEYS)
          || !some((compactedKey) => operationIs(compactedKey, 'create_key', 'ok', null)
            && executed.filter((entry) => entry.index < compactedKey.index
              && operationIs(entry, 'create_key', 'ok', null)
              && operationField(entry, 'home_id') === operationField(compactedKey, 'home_id')).length
                === MAX_RETAINED_HOME_KEY_RECORDS
            && some((revocation) => revocation.index < compactedKey.index
              && operationIs(revocation, 'revoke_key', 'ok', null)
              && operationField(revocation, 'home_id') === operationField(compactedKey, 'home_id')
              && some((created) => created.index < revocation.index
                && operationIs(created, 'create_key', 'ok', null)
                && operationField(created, 'home_id') === operationField(revocation, 'home_id')
                && operationField(created, 'key_id') === operationField(revocation, 'key_id'))))
          || !some((destinationDenial) => operationIs(
            destinationDenial,
            'complete_destination_challenge',
            'error',
            'limit_exceeded',
          ) && executed.filter((entry) => entry.index < destinationDenial.index
            && operationIs(entry, 'complete_destination_challenge', 'ok', null)
            && operationField(entry, 'user_token') === operationField(destinationDenial, 'user_token')).length
              === MAX_PUSH_DESTINATIONS)
          || !some((challengeDenial) => {
            if (!operationIs(challengeDenial, 'issue_destination_challenge', 'error', 'limit_exceeded')) return false;
            const active = new Set<JsonValue | undefined>();
            for (const entry of executed.slice(0, challengeDenial.index)) {
              if (operationField(entry, 'user_token') !== operationField(challengeDenial, 'user_token')) continue;
              if (operationIs(entry, 'issue_destination_challenge', 'ok', null)) {
                active.add(operationField(entry, 'challenge_ref'));
              } else if (operationIs(entry, 'complete_destination_challenge', 'ok', null)) {
                active.delete(operationField(entry, 'challenge_ref'));
              }
            }
            return active.size === MAX_ACTIVE_PUSH_CHALLENGES;
          })
          || !some((renewal) => operationIs(renewal, 'create_grant', 'ok', null)
            && activeGrantEvidenceBefore(
              executed,
              renewal,
              operationField(renewal, 'user_token'),
              operationField(renewal, 'home_id'),
            ).size === MAX_ACTIVE_GRANTS
            && some((destinationDenial) => destinationDenial.index < renewal.index
              && operationIs(
                destinationDenial,
                'complete_destination_challenge',
                'error',
                'limit_exceeded',
              )
              && operationField(destinationDenial, 'user_token') === operationField(renewal, 'user_token')
              && executed.filter((entry) => entry.index < destinationDenial.index
                && operationIs(entry, 'complete_destination_challenge', 'ok', null)
                && operationField(entry, 'user_token') === operationField(renewal, 'user_token')).length
                  === MAX_PUSH_DESTINATIONS)
            && some((prior) => prior.index < renewal.index
              && operationIs(prior, 'create_grant', 'ok', null)
              && operationField(prior, 'user_token') === operationField(renewal, 'user_token')
              && operationField(prior, 'home_id') === operationField(renewal, 'home_id')
              && operationField(prior, 'destination_ref') === operationField(renewal, 'destination_ref'))
            && some((otherUserGrant) => otherUserGrant.index > renewal.index
              && operationIs(otherUserGrant, 'create_grant', 'ok', null)
              && operationField(otherUserGrant, 'home_id') === operationField(renewal, 'home_id')
              && operationField(otherUserGrant, 'user_token') !== operationField(renewal, 'user_token')))
          || !some((compactedRenewal) => operationIs(compactedRenewal, 'create_grant', 'ok', null)
            && executed.filter((entry) => entry.index < compactedRenewal.index
              && operationIs(entry, 'create_grant', 'ok', null)
              && operationField(entry, 'user_token') === operationField(compactedRenewal, 'user_token')
              && operationField(entry, 'home_id') === operationField(compactedRenewal, 'home_id')).length
                === MAX_RETAINED_GRANT_RECORDS
            && some((prior) => prior.index < compactedRenewal.index
              && operationIs(prior, 'create_grant', 'ok', null)
              && operationField(prior, 'user_token') === operationField(compactedRenewal, 'user_token')
              && operationField(prior, 'home_id') === operationField(compactedRenewal, 'home_id')
              && operationField(prior, 'destination_ref') === operationField(compactedRenewal, 'destination_ref')))) {
          fail(coverage);
        }
        break;
    }
  }
}

function verifiedUsers(fixture: AccessTokenFixture): Map<string, FirebaseIdentity> {
  const users = new Map<string, FirebaseIdentity>();
  for (const vector of fixture.vectors) {
    if (vector.kind !== 'firebase' || !vector.valid) continue;
    const identity = verifyFixtureVector(vector, fixture);
    if (!('user_id' in identity)) throw new ContractViolation('invalid_fixture', 'Firebase vector did not yield a user');
    users.set(vector.id, identity);
  }
  return users;
}

export function replayScenario(
  scenario: Scenario,
  startSeconds: number,
  accessFixture: AccessTokenFixture,
): Scenario['expected_final'] {
  if (startSeconds !== accessFixture.now) {
    throw new ContractViolation('invalid_fixture', 'behavioral and token fixture clocks disagree');
  }
  const state: ReplayState = {
    now: startSeconds,
    users: verifiedUsers(accessFixture),
    homes: new Map(),
    keys: new Map(),
    tokens: new Map(),
    challenges: new Map(),
    destinations: new Map(),
    grants: new Map(),
    uploads: new Map(),
    quarantined: new Set(),
    audit: [],
  };
  const executed: ExecutedOperation[] = [];
  scenario.operations.forEach((operation, index) => {
    const at = state.now;
    const expected = parseExpected(operation.expected, `${scenario.id}.operations[${index}].expected`);
    const result = executeOperation(state, operation);
    assertResult(result, expected, scenario.id, index);
    assertStateCollectionBounds(state);
    executed.push({ operation, result, index, at });
  });
  assertCoverageEvidence(scenario, executed);
  const projection = finalProjection(state);
  if (!equalJson(projection, scenario.expected_final)) {
    throw new ContractViolation('scenario_mismatch', `${scenario.id} final projection does not match`);
  }
  return projection;
}

export function replayScenarioFixture(fixture: ScenarioFixture, accessFixture: AccessTokenFixture): void {
  for (const scenario of fixture.scenarios) replayScenario(scenario, fixture.clock.start_seconds, accessFixture);
}

export async function loadScenarioFixture(
  url = new URL('../../fixtures/v1/scenarios.json', import.meta.url),
): Promise<ScenarioFixture> {
  const metadata = await stat(url);
  if (!metadata.isFile() || metadata.size > LIMITS.maximumBytes) {
    throw new ContractViolation('limit_exceeded', 'scenario fixture exceeds its file limit');
  }
  return validateScenarioFixture(parseBoundedJson(await readFile(url), LIMITS));
}
