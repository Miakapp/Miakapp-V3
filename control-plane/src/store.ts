import {
  Firestore,
  Timestamp,
  type DocumentData,
  type DocumentSnapshot,
  type QueryDocumentSnapshot,
  type QuerySnapshot,
  type Transaction,
} from 'firebase-admin/firestore';

import { apiError, ApiError } from './errors.js';
import {
  deriveHomeKeyVerifier,
  generateHomeKey,
  homeKeyVerifierMatches,
  parseHomeKey,
  randomIdentifier,
  type GeneratedHomeKey,
  type SignedAccessToken,
} from './crypto.js';
import {
  HOME_KEY_ACCESS_SCOPES,
  HOME_ID_PATTERN,
  IDENTIFIER_PATTERN,
  type AccessGrant,
  type HomeKeyAccessGrant,
  type HomeKeyAccessScope,
  type Clock,
  type DeploymentConfig,
  type ExchangeRequest,
  type FirebasePrincipal,
  type HomeInput,
  type HomeKeyMetadata,
  type HomePatch,
  type HomeRepresentation,
  type UserRelayAccessGrant,
} from './types.js';

const MAX_OWNED_HOMES = 16;
const MAX_ACTIVE_HOME_KEYS = 64;
const MAX_RETAINED_HOME_KEYS = 64;
const MAX_RELAY_URL_BYTES = 2_048;
const CONTROL_CHARACTER = /\p{Cc}/u;

class IdentifierCollision extends Error {}

interface PrivateHomeData {
  readonly ownerUid: string;
  readonly relayUrl: string;
  readonly activeKeyCount: number;
  readonly retainedKeyCount: number;
}

interface ValidatedKeyRecord {
  readonly data: DocumentData;
  readonly metadata: HomeKeyMetadata;
  readonly status: 'active' | 'revoked';
  readonly createdAt: Timestamp;
  readonly snapshot: QueryDocumentSnapshot | DocumentSnapshot;
}

export interface AccessTokenIssuer {
  sign(grant: AccessGrant): SignedAccessToken | Promise<SignedAccessToken>;
}

export interface AccessTokenExchange {
  readonly grant: AccessGrant;
  readonly signed: SignedAccessToken;
}

export interface HomeKeyAccessTokenExchange extends AccessTokenExchange {
  readonly grant: HomeKeyAccessGrant;
}

export interface UserRelayTokenExchange extends AccessTokenExchange {
  readonly grant: UserRelayAccessGrant;
}

export type HomeKeyGenerator = () => GeneratedHomeKey;

function safeCount(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw apiError('temporarily_unavailable');
  return value as number;
}

function timestamp(value: unknown): Timestamp {
  if (!(value instanceof Timestamp)) throw apiError('temporarily_unavailable');
  return value;
}

function timestampText(value: unknown): string {
  return timestamp(value).toDate().toISOString();
}

function optionalTimestampText(value: unknown): string | null {
  return value === null ? null : timestampText(value);
}

function storedRelayUrl(value: unknown): string {
  if (typeof value !== 'string') throw apiError('temporarily_unavailable');
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw apiError('temporarily_unavailable');
  }
  if (Buffer.byteLength(value, 'utf8') > MAX_RELAY_URL_BYTES
    || parsed.protocol !== 'wss:'
    || parsed.username !== ''
    || parsed.password !== ''
    || parsed.search !== ''
    || parsed.hash !== ''
    || !parsed.pathname.endsWith('/ws')
    || parsed.href !== value) {
    throw apiError('temporarily_unavailable');
  }
  return value;
}

function privateHomeRecord(snapshot: DocumentSnapshot): PrivateHomeData {
  if (!snapshot.exists) throw apiError('home_not_found');
  const data = snapshot.data();
  if (data?.schema !== 'miakapp.control-home/1'
    || data.home_id !== snapshot.id
    || typeof data.owner_uid !== 'string'
    || data.owner_uid.length === 0
    || Buffer.byteLength(data.owner_uid, 'utf8') > 128
    || CONTROL_CHARACTER.test(data.owner_uid)) {
    throw apiError('temporarily_unavailable');
  }
  return {
    ownerUid: data.owner_uid,
    relayUrl: storedRelayUrl(data.relay_url),
    activeKeyCount: safeCount(data.active_key_count),
    retainedKeyCount: safeCount(data.retained_key_count),
  };
}

function privateHome(snapshot: DocumentSnapshot, principal: FirebasePrincipal): PrivateHomeData {
  const home = privateHomeRecord(snapshot);
  if (home.ownerUid !== principal.userId) throw apiError('not_home_owner');
  return home;
}

function keyScopes(value: unknown): HomeKeyAccessScope[] {
  if (!Array.isArray(value)
    || value.length === 0
    || value.length > HOME_KEY_ACCESS_SCOPES.length
    || new Set(value).size !== value.length
    || value.some((entry) => (
      typeof entry !== 'string' || !HOME_KEY_ACCESS_SCOPES.includes(entry as HomeKeyAccessScope)
    ))) {
    throw apiError('temporarily_unavailable');
  }
  return value as HomeKeyAccessScope[];
}

function keyMetadataFromData(data: DocumentData | undefined): HomeKeyMetadata {
  if (data === undefined || typeof data.key_id !== 'string'
    || typeof data.label !== 'string'
    || (data.status !== 'active' && data.status !== 'revoked')) {
    throw apiError('temporarily_unavailable');
  }
  return Object.freeze({
    key_id: data.key_id,
    label: data.label,
    scopes: Object.freeze([...keyScopes(data.scopes)]) as HomeKeyAccessScope[],
    created_at: timestampText(data.created_at),
    revoked_at: optionalTimestampText(data.revoked_at),
    last_used_at: optionalTimestampText(data.last_used_at),
  });
}

function validatedKeyRecord(
  snapshot: QueryDocumentSnapshot | DocumentSnapshot,
  homeId: string,
): ValidatedKeyRecord {
  const data = snapshot.data();
  if (data === undefined
    || data.home_id !== homeId
    || data.key_id !== snapshot.id
    || typeof data.key_id !== 'string'
    || !IDENTIFIER_PATTERN.test(data.key_id)
    || Buffer.from(data.key_id, 'base64url').byteLength !== 16
    || Buffer.from(data.key_id, 'base64url').toString('base64url') !== data.key_id
    || typeof data.verifier !== 'string'
    || !/^[A-Za-z0-9_-]{43}$/.test(data.verifier)
    || Buffer.from(data.verifier, 'base64url').byteLength !== 32
    || Buffer.from(data.verifier, 'base64url').toString('base64url') !== data.verifier
    || typeof data.verifier_key_version !== 'string'
    || data.verifier_key_version.length === 0
    || data.verifier_key_version.length > 64) {
    throw apiError('temporarily_unavailable');
  }
  const metadata = keyMetadataFromData(data);
  const status = data.status as 'active' | 'revoked';
  if ((status === 'active' && data.revoked_at !== null)
    || (status === 'revoked' && !(data.revoked_at instanceof Timestamp))) {
    throw apiError('temporarily_unavailable');
  }
  return Object.freeze({
    data,
    metadata,
    status,
    createdAt: timestamp(data.created_at),
    snapshot,
  });
}

function validateKeyIndex(
  snapshot: DocumentSnapshot,
  homeId: string,
  keyId: string,
  status: 'active' | 'revoked',
): void {
  if (!snapshot.exists
    || snapshot.id !== keyId
    || snapshot.get('schema') !== 'miakapp.home-key-index/1'
    || snapshot.get('key_id') !== keyId
    || snapshot.get('home_id') !== homeId
    || snapshot.get('status') !== status) {
    throw apiError('temporarily_unavailable');
  }
  timestamp(snapshot.get('created_at'));
}

function sameScopes(left: unknown, right: readonly HomeKeyAccessScope[]): boolean {
  return Array.isArray(left)
    && left.length === right.length
    && left.every((entry, index) => entry === right[index]);
}

function reconcileKeyRegistry(
  snapshot: QuerySnapshot,
  home: PrivateHomeData,
  homeId: string,
): ValidatedKeyRecord[] {
  if (snapshot.size > MAX_RETAINED_HOME_KEYS
    || snapshot.size !== home.retainedKeyCount
    || home.activeKeyCount > MAX_ACTIVE_HOME_KEYS
    || home.retainedKeyCount > MAX_RETAINED_HOME_KEYS) {
    throw apiError('temporarily_unavailable');
  }
  const records = snapshot.docs.map((document) => validatedKeyRecord(document, homeId));
  if (records.filter((record) => record.status === 'active').length !== home.activeKeyCount) {
    throw apiError('temporarily_unavailable');
  }
  return records;
}

function compareKeyRecords(left: ValidatedKeyRecord, right: ValidatedKeyRecord): number {
  return left.createdAt.toMillis() - right.createdAt.toMillis()
    || Buffer.compare(Buffer.from(left.snapshot.id, 'ascii'), Buffer.from(right.snapshot.id, 'ascii'));
}

function homeRepresentation(data: DocumentData): HomeRepresentation {
  if (typeof data.home_id !== 'string'
    || typeof data.name !== 'string'
    || typeof data.icon !== 'string'
    || typeof data.relay_url !== 'string') {
    throw apiError('temporarily_unavailable');
  }
  return Object.freeze({
    home_id: data.home_id,
    name: data.name,
    icon: data.icon,
    relay_url: data.relay_url,
    created_at: timestampText(data.created_at),
    updated_at: timestampText(data.updated_at),
  });
}

export class ControlPlaneStore {
  readonly #clock: Clock;
  readonly #config: DeploymentConfig;
  readonly #firestore: Firestore;
  readonly #homeKeyGenerator: HomeKeyGenerator;

  constructor(
    firestore: Firestore,
    config: DeploymentConfig,
    clock: Clock,
    homeKeyGenerator: HomeKeyGenerator = generateHomeKey,
  ) {
    this.#firestore = firestore;
    this.#config = config;
    this.#clock = clock;
    this.#homeKeyGenerator = homeKeyGenerator;
  }

  async createHome(principal: FirebasePrincipal, input: HomeInput): Promise<HomeRepresentation> {
    const publicRef = this.#firestore.collection('homes').doc(input.homeId);
    const privateRef = this.#firestore.collection('controlHomes').doc(input.homeId);
    const ownerRef = this.#firestore.collection('controlOwners').doc(principal.userId);
    const ownedHomesQuery = this.#firestore.collection('controlHomes')
      .where('owner_uid', '==', principal.userId)
      .limit(MAX_OWNED_HOMES + 1);
    const now = Timestamp.fromMillis(this.#clock.now());
    const representation = await this.#firestore.runTransaction(async (transaction) => {
      const [publicSnapshot, privateSnapshot, ownerSnapshot, ownedHomes] = await Promise.all([
        transaction.get(publicRef),
        transaction.get(privateRef),
        transaction.get(ownerRef),
        transaction.get(ownedHomesQuery),
      ]);
      if (publicSnapshot.exists || privateSnapshot.exists) throw apiError('home_exists');
      const ownedHomeCount = ownerSnapshot.exists ? safeCount(ownerSnapshot.get('owned_home_count')) : 0;
      if (ownedHomes.size !== ownedHomeCount || ownedHomes.size > MAX_OWNED_HOMES) {
        throw apiError('temporarily_unavailable');
      }
      if (ownedHomeCount >= MAX_OWNED_HOMES) throw apiError('limit_exceeded');
      const publicData = {
        schema: 'miakapp.home/1',
        home_id: input.homeId,
        name: input.name,
        icon: input.icon,
        relay_url: input.relayUrl,
        created_at: now,
        updated_at: now,
      };
      transaction.create(publicRef, publicData);
      transaction.create(privateRef, {
        schema: 'miakapp.control-home/1',
        home_id: input.homeId,
        owner_uid: principal.userId,
        relay_url: input.relayUrl,
        active_key_count: 0,
        retained_key_count: 0,
        created_at: now,
        updated_at: now,
      });
      transaction.set(ownerRef, {
        schema: 'miakapp.control-owner/1',
        owner_uid: principal.userId,
        owned_home_count: ownedHomeCount + 1,
        updated_at: now,
      });
      return publicData;
    });
    return homeRepresentation(representation);
  }

  async patchHome(
    principal: FirebasePrincipal,
    homeId: string,
    patch: HomePatch,
  ): Promise<HomeRepresentation> {
    const publicRef = this.#firestore.collection('homes').doc(homeId);
    const privateRef = this.#firestore.collection('controlHomes').doc(homeId);
    const now = Timestamp.fromMillis(this.#clock.now());
    const result = await this.#firestore.runTransaction(async (transaction) => {
      const [privateSnapshot, publicSnapshot] = await Promise.all([
        transaction.get(privateRef),
        transaction.get(publicRef),
      ]);
      privateHome(privateSnapshot, principal);
      if (!publicSnapshot.exists) throw apiError('temporarily_unavailable');
      const previous = publicSnapshot.data();
      if (previous === undefined) throw apiError('temporarily_unavailable');
      const next = {
        ...previous,
        ...(patch.name === undefined ? {} : { name: patch.name }),
        ...(patch.icon === undefined ? {} : { icon: patch.icon }),
        ...(patch.relayUrl === undefined ? {} : { relay_url: patch.relayUrl }),
        updated_at: now,
      };
      transaction.update(publicRef, {
        ...(patch.name === undefined ? {} : { name: patch.name }),
        ...(patch.icon === undefined ? {} : { icon: patch.icon }),
        ...(patch.relayUrl === undefined ? {} : { relay_url: patch.relayUrl }),
        updated_at: now,
      });
      if (patch.relayUrl !== undefined) {
        transaction.update(privateRef, { relay_url: patch.relayUrl, updated_at: now });
      }
      return next;
    });
    return homeRepresentation(result);
  }

  async createHomeKey(
    principal: FirebasePrincipal,
    homeId: string,
    label: string,
    scopes: HomeKeyAccessScope[],
  ): Promise<{ readonly metadata: HomeKeyMetadata; readonly homeKey: string }> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const generated = this.#homeKeyGenerator();
      const pepper = this.#pepperForVersion(this.#config.verifierKeyVersion);
      const verifier = deriveHomeKeyVerifier(generated.value, pepper);
      try {
        const metadata = await this.#createHomeKeyTransaction(
          principal,
          homeId,
          generated.keyId,
          label,
          scopes,
          verifier,
        );
        return Object.freeze({ metadata, homeKey: generated.value });
      } catch (error) {
        if (!(error instanceof IdentifierCollision)) throw error;
      }
    }
    throw apiError('temporarily_unavailable');
  }

  async #createHomeKeyTransaction(
    principal: FirebasePrincipal,
    homeId: string,
    keyId: string,
    label: string,
    scopes: HomeKeyAccessScope[],
    verifier: string,
  ): Promise<HomeKeyMetadata> {
    const homeRef = this.#firestore.collection('controlHomes').doc(homeId);
    const keyRef = homeRef.collection('homeKeys').doc(keyId);
    const indexRef = this.#firestore.collection('homeKeyIndex').doc(keyId);
    const now = Timestamp.fromMillis(this.#clock.now());
    const result = await this.#firestore.runTransaction(async (transaction) => {
      const homeSnapshot = await transaction.get(homeRef);
      const home = privateHome(homeSnapshot, principal);
      const [keySnapshot, indexSnapshot] = await Promise.all([
        transaction.get(keyRef),
        transaction.get(indexRef),
      ]);
      const registrySnapshot = await transaction.get(
        homeRef.collection('homeKeys').limit(MAX_RETAINED_HOME_KEYS + 1),
      );
      const registry = reconcileKeyRegistry(registrySnapshot, home, homeId);
      if (keySnapshot.exists || indexSnapshot.exists) {
        if (!keySnapshot.exists) throw new IdentifierCollision();
        if (!indexSnapshot.exists) throw apiError('temporarily_unavailable');
        const existing = validatedKeyRecord(keySnapshot, homeId);
        validateKeyIndex(indexSnapshot, homeId, keyId, existing.status);
        if (existing.status === 'active'
          && existing.data.verifier === verifier
          && existing.data.verifier_key_version === this.#config.verifierKeyVersion
          && existing.data.created_by === principal.userId
          && existing.data.label === label
          && sameScopes(existing.data.scopes, scopes)) {
          return existing.data;
        }
        throw new IdentifierCollision();
      }
      if (home.activeKeyCount >= MAX_ACTIVE_HOME_KEYS) throw apiError('limit_exceeded');

      let compacted: ValidatedKeyRecord | undefined;
      if (home.retainedKeyCount >= MAX_RETAINED_HOME_KEYS) {
        compacted = registry
          .filter((record) => record.status === 'revoked')
          .sort(compareKeyRecords)[0];
        if (compacted === undefined) throw apiError('limit_exceeded');
      }

      if (compacted !== undefined) {
        const compactedIndexRef = this.#firestore.collection('homeKeyIndex').doc(compacted.snapshot.id);
        const compactedIndex = await transaction.get(compactedIndexRef);
        validateKeyIndex(compactedIndex, homeId, compacted.snapshot.id, 'revoked');
        transaction.delete(compacted.snapshot.ref);
        transaction.delete(compactedIndexRef);
      }
      const record = {
        schema: 'miakapp.home-key-record/1',
        key_id: keyId,
        home_id: homeId,
        verifier,
        verifier_key_version: this.#config.verifierKeyVersion,
        label,
        scopes,
        status: 'active',
        created_at: now,
        created_by: principal.userId,
        revoked_at: null,
        last_used_at: null,
        last_issuance_id: null,
      };
      transaction.create(keyRef, record);
      transaction.create(indexRef, {
        schema: 'miakapp.home-key-index/1',
        key_id: keyId,
        home_id: homeId,
        status: 'active',
        created_at: now,
      });
      transaction.update(homeRef, {
        active_key_count: home.activeKeyCount + 1,
        retained_key_count: compacted === undefined
          ? home.retainedKeyCount + 1
          : home.retainedKeyCount,
        updated_at: now,
      });
      return record;
    });
    return keyMetadataFromData(result);
  }

  async listHomeKeys(principal: FirebasePrincipal, homeId: string): Promise<HomeKeyMetadata[]> {
    const homeRef = this.#firestore.collection('controlHomes').doc(homeId);
    return this.#firestore.runTransaction(async (transaction) => {
      const homeSnapshot = await transaction.get(homeRef);
      const home = privateHome(homeSnapshot, principal);
      const snapshot = await transaction.get(
        homeRef.collection('homeKeys').limit(MAX_RETAINED_HOME_KEYS + 1),
      );
      const records = reconcileKeyRegistry(snapshot, home, homeId)
        .sort(compareKeyRecords);
      return Object.freeze(records.map((record) => record.metadata)) as HomeKeyMetadata[];
    });
  }

  async revokeHomeKey(principal: FirebasePrincipal, homeId: string, keyId: string): Promise<void> {
    const homeRef = this.#firestore.collection('controlHomes').doc(homeId);
    const keyRef = homeRef.collection('homeKeys').doc(keyId);
    const indexRef = this.#firestore.collection('homeKeyIndex').doc(keyId);
    const now = Timestamp.fromMillis(this.#clock.now());
    await this.#firestore.runTransaction(async (transaction) => {
      const homeSnapshot = await transaction.get(homeRef);
      const home = privateHome(homeSnapshot, principal);
      const [keySnapshot, indexSnapshot] = await Promise.all([
        transaction.get(keyRef),
        transaction.get(indexRef),
      ]);
      const registrySnapshot = await transaction.get(
        homeRef.collection('homeKeys').limit(MAX_RETAINED_HOME_KEYS + 1),
      );
      reconcileKeyRegistry(registrySnapshot, home, homeId);
      if (!keySnapshot.exists) return;
      if (keySnapshot.get('status') === 'revoked') return;
      if (keySnapshot.get('status') !== 'active' || !indexSnapshot.exists || home.activeKeyCount === 0) {
        throw apiError('temporarily_unavailable');
      }
      transaction.update(keyRef, { status: 'revoked', revoked_at: now });
      transaction.update(indexRef, { status: 'revoked', revoked_at: now });
      transaction.update(homeRef, { active_key_count: home.activeKeyCount - 1, updated_at: now });
    });
  }

  async exchangeHomeKey(
    homeKey: string,
    request: ExchangeRequest,
    issuer: AccessTokenIssuer,
    beforeSigning: (grant: HomeKeyAccessGrant) => Promise<void> = async () => undefined,
  ): Promise<HomeKeyAccessTokenExchange> {
    const { keyId } = parseHomeKey(homeKey);
    const issuedAt = Math.floor(this.#clock.now() / 1_000);
    const tokenId = randomIdentifier();
    const grant = await this.#firestore.runTransaction((transaction) => (
      this.#reserveGrant(transaction, homeKey, keyId, request, issuedAt, tokenId)
    ));
    await beforeSigning(grant);
    const signed = await issuer.sign(grant);
    return Object.freeze({ grant, signed });
  }

  async exchangeUserRelay(
    principal: FirebasePrincipal,
    homeId: string,
    issuer: AccessTokenIssuer,
    beforeSigning: (grant: UserRelayAccessGrant) => Promise<void> = async () => undefined,
  ): Promise<UserRelayTokenExchange> {
    const issuedAt = Math.floor(this.#clock.now() / 1_000);
    const snapshot = await this.#firestore.collection('controlHomes').doc(homeId).get();
    const home = privateHomeRecord(snapshot);
    const grant: UserRelayAccessGrant = Object.freeze({
      subjectKind: 'firebase_user',
      issuedAt,
      tokenId: randomIdentifier(),
      homeId,
      userId: principal.userId,
      verifiedEmail: principal.verifiedEmail,
      scope: 'relay:user',
      audience: home.relayUrl,
      role: 'user',
    });
    await beforeSigning(grant);
    if (issuedAt + 300 <= Math.floor(this.#clock.now() / 1_000)) {
      throw apiError('temporarily_unavailable');
    }
    const signed = await issuer.sign(grant);
    return Object.freeze({ grant, signed });
  }

  async #reserveGrant(
    transaction: Transaction,
    homeKey: string,
    keyId: string,
    request: ExchangeRequest,
    issuedAt: number,
    tokenId: string,
  ): Promise<HomeKeyAccessGrant> {
    const indexRef = this.#firestore.collection('homeKeyIndex').doc(keyId);
    const indexSnapshot = await transaction.get(indexRef);
    if (!indexSnapshot.exists) throw apiError('invalid_home_key');
    const homeId = indexSnapshot.get('home_id');
    if (typeof homeId !== 'string' || !HOME_ID_PATTERN.test(homeId)) throw apiError('invalid_home_key');
    const homeRef = this.#firestore.collection('controlHomes').doc(homeId);
    const keyRef = homeRef.collection('homeKeys').doc(keyId);
    const [homeSnapshot, keySnapshot] = await Promise.all([
      transaction.get(homeRef),
      transaction.get(keyRef),
    ]);
    if (!homeSnapshot.exists || !keySnapshot.exists || indexSnapshot.get('status') !== 'active') {
      throw apiError('invalid_home_key');
    }
    const record = validatedKeyRecord(keySnapshot, homeId);
    validateKeyIndex(indexSnapshot, homeId, keyId, record.status);
    if (record.status !== 'active') throw apiError('invalid_home_key');
    const pepper = this.#pepperForVersion(record.data.verifier_key_version as string);
    if (!homeKeyVerifierMatches(homeKey, pepper, record.data.verifier)) throw apiError('invalid_home_key');
    const scopes = keyScopes(record.data.scopes);
    const label = record.data.label;
    const relayUrl = privateHomeRecord(homeSnapshot).relayUrl;
    if (typeof label !== 'string') throw apiError('temporarily_unavailable');
    if (issuedAt + 300 <= Math.floor(this.#clock.now() / 1_000)) {
      throw apiError('temporarily_unavailable');
    }
    const grant = this.#grantForRequest(
      request,
      issuedAt,
      tokenId,
      homeId,
      keyId,
      label,
      relayUrl,
      scopes,
    );
    transaction.update(keyRef, {
      last_used_at: Timestamp.fromMillis(issuedAt * 1_000),
      last_issuance_id: tokenId,
    });
    return grant;
  }

  #pepperForVersion(version: string): Uint8Array {
    const pepper = this.#config.homeKeyPepperForVersion(version);
    if (pepper === undefined || pepper.byteLength !== 32) throw apiError('temporarily_unavailable');
    return pepper;
  }

  #grantForRequest(
    request: ExchangeRequest,
    issuedAt: number,
    tokenId: string,
    homeId: string,
    clientId: string,
    label: string,
    relayUrl: string,
    scopes: HomeKeyAccessScope[],
  ): HomeKeyAccessGrant {
    let scope: HomeKeyAccessScope;
    let audience: string;
    let role: HomeKeyAccessGrant['role'] = null;
    let coordinatorName: string | null = null;
    if (request.purpose === 'relay') {
      role = request.role;
      scope = request.role === 'coordinator' ? 'relay:coordinator' : 'relay:cli';
      audience = relayUrl;
      if (request.role === 'coordinator') coordinatorName = request.coordinatorName;
    } else if (request.purpose === 'push') {
      scope = 'push:send';
      audience = this.#config.pushAudience;
    } else {
      scope = 'components:publish';
      audience = this.#config.componentsAudience;
    }
    if (!scopes.includes(scope)) throw apiError('insufficient_scope');
    return Object.freeze({
      subjectKind: 'home_key',
      issuedAt,
      tokenId,
      homeId,
      clientId,
      label,
      scope,
      audience,
      role,
      coordinatorName,
    });
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}
