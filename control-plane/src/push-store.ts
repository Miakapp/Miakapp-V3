import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import {
  Timestamp,
  type DocumentData,
  type DocumentReference,
  type DocumentSnapshot,
  type Firestore,
  type QueryDocumentSnapshot,
  type QuerySnapshot,
} from 'firebase-admin/firestore';

import { apiError } from './errors.js';
import { randomIdentifier } from './crypto.js';
import {
  IDENTIFIER_PATTERN,
  type AppCheckPrincipal,
  type Clock,
  type DeploymentConfig,
  type FirebasePrincipal,
  type PushAccessPrincipal,
  type PushDestinationMetadata,
  type PushGrantMetadata,
} from './types.js';

const MAX_ACTIVE_CHALLENGES = 4;
const MAX_ACTIVE_DESTINATIONS = 16;
const MAX_RETAINED_GRANTS = 256;
const CHALLENGE_TTL_MILLISECONDS = 5 * 60 * 1_000;
const GRANT_TTL_MILLISECONDS = 180 * 24 * 60 * 60 * 1_000;
const FID_FINGERPRINT_DOMAIN = 'miakapp.push-fid/1\0';
const PROOF_VERIFIER_DOMAIN = 'miakapp.push-proof/1\0';

class IdentifierCollision extends Error {}

export interface PushChallengeDelivery {
  readonly challengeId: string;
  readonly challengeSecret: string;
  readonly expiresAt: string;
  readonly fid: string;
}

export interface AuthorizedPushDestination {
  readonly destinationId: string;
  readonly fid: string;
}

export type IdentifierGenerator = () => string;
export type SecretGenerator = () => string;

interface DestinationOwnerState {
  readonly destinationCount: number;
}

interface GrantOwnerState {
  readonly retainedGrantCount: number;
}

interface ValidatedChallenge {
  readonly appId: string;
  readonly destinationId: string | null;
  readonly expiresAt: Timestamp;
  readonly fid: string;
  readonly fidFingerprint: string;
  readonly proofVerifier: string;
  readonly status: 'pending' | 'consumed';
  readonly verifierKeyVersion: string;
}

interface ValidatedDestination {
  readonly appId: string;
  readonly createdAt: Timestamp;
  readonly fid: string;
  readonly fidFingerprint: string;
  readonly metadata: PushDestinationMetadata;
  readonly ownerUid: string;
  readonly snapshot: QueryDocumentSnapshot | DocumentSnapshot;
}

interface ValidatedGrant {
  readonly createdAt: Timestamp;
  readonly destinationId: string;
  readonly expiresAt: Timestamp;
  readonly homeId: string;
  readonly metadata: PushGrantMetadata;
  readonly ownerUid: string;
  readonly revokedAt: Timestamp | null;
  readonly snapshot: QueryDocumentSnapshot | DocumentSnapshot;
  readonly status: 'active' | 'revoked';
}

function exactKeys(value: DocumentData, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && expected.every((key) => Object.hasOwn(value, key));
}

function safeCount(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw apiError('temporarily_unavailable');
  return value as number;
}

function timestamp(value: unknown): Timestamp {
  if (!(value instanceof Timestamp)) throw apiError('temporarily_unavailable');
  return value;
}

function optionalTimestamp(value: unknown): Timestamp | null {
  if (value === null) return null;
  return timestamp(value);
}

function timestampText(value: Timestamp): string {
  return value.toDate().toISOString();
}

function canonicalIdentifier(value: unknown): value is string {
  return typeof value === 'string'
    && IDENTIFIER_PATTERN.test(value)
    && Buffer.from(value, 'base64url').byteLength === 16
    && Buffer.from(value, 'base64url').toString('base64url') === value;
}

function canonicalSecret(value: unknown): value is string {
  return typeof value === 'string'
    && /^[A-Za-z0-9_-]{43}$/.test(value)
    && Buffer.from(value, 'base64url').byteLength === 32
    && Buffer.from(value, 'base64url').toString('base64url') === value;
}

function boundedFid(value: unknown): value is string {
  return typeof value === 'string'
    && Buffer.byteLength(value, 'utf8') >= 1
    && Buffer.byteLength(value, 'utf8') <= 4_096;
}

function version(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 1 && Buffer.byteLength(value, 'utf8') <= 64;
}

function destinationMetadata(record: ValidatedDestination): PushDestinationMetadata {
  return record.metadata;
}

function validateDestination(
  snapshot: QueryDocumentSnapshot | DocumentSnapshot,
  ownerUid: string,
): ValidatedDestination {
  const data = snapshot.data();
  if (data === undefined
    || !exactKeys(data, [
      'schema',
      'provider',
      'fid',
      'fid_fingerprint',
      'verified_app_id',
      'created_at',
      'updated_at',
    ])
    || data.schema !== 'miakapp.push-destination/1'
    || !canonicalIdentifier(snapshot.id)
    || data.provider !== 'fcm'
    || !boundedFid(data.fid)
    || !canonicalSecret(data.fid_fingerprint)
    || typeof data.verified_app_id !== 'string'
    || Buffer.byteLength(data.verified_app_id, 'utf8') > 128) {
    throw apiError('temporarily_unavailable');
  }
  const createdAt = timestamp(data.created_at);
  const updatedAt = timestamp(data.updated_at);
  if (updatedAt.toMillis() < createdAt.toMillis()) throw apiError('temporarily_unavailable');
  return Object.freeze({
    appId: data.verified_app_id as string,
    createdAt,
    fid: data.fid as string,
    fidFingerprint: data.fid_fingerprint as string,
    metadata: Object.freeze({
      destination_id: snapshot.id,
      provider: 'fcm',
      created_at: timestampText(createdAt),
      updated_at: timestampText(updatedAt),
    }),
    ownerUid,
    snapshot,
  });
}

function destinationOwner(snapshot: DocumentSnapshot, ownerUid: string): DestinationOwnerState {
  if (!snapshot.exists) return { destinationCount: 0 };
  const data = snapshot.data();
  if (data === undefined
    || !exactKeys(data, ['schema', 'owner_uid', 'active_destination_count', 'updated_at'])
    || data.schema !== 'miakapp.push-owner/1'
    || data.owner_uid !== ownerUid) {
    throw apiError('temporarily_unavailable');
  }
  timestamp(data.updated_at);
  return { destinationCount: safeCount(data.active_destination_count) };
}

function reconcileDestinations(
  snapshot: QuerySnapshot,
  owner: DestinationOwnerState,
  ownerUid: string,
): ValidatedDestination[] {
  if (snapshot.size > MAX_ACTIVE_DESTINATIONS
    || snapshot.size !== owner.destinationCount
    || owner.destinationCount > MAX_ACTIVE_DESTINATIONS) {
    throw apiError('temporarily_unavailable');
  }
  return snapshot.docs.map((document) => validateDestination(document, ownerUid));
}

function validateChallenge(snapshot: QueryDocumentSnapshot | DocumentSnapshot, ownerUid: string): ValidatedChallenge {
  const data = snapshot.data();
  if (data === undefined
    || !exactKeys(data, [
      'schema',
      'challenge_id',
      'owner_uid',
      'verified_app_id',
      'fid',
      'fid_fingerprint',
      'proof_verifier',
      'verifier_key_version',
      'status',
      'destination_id',
      'created_at',
      'expires_at',
      'consumed_at',
    ])
    || data.schema !== 'miakapp.push-challenge-record/1'
    || data.challenge_id !== snapshot.id
    || !canonicalIdentifier(data.challenge_id)
    || data.owner_uid !== ownerUid
    || typeof data.verified_app_id !== 'string'
    || Buffer.byteLength(data.verified_app_id, 'utf8') > 128
    || !boundedFid(data.fid)
    || !canonicalSecret(data.fid_fingerprint)
    || !canonicalSecret(data.proof_verifier)
    || !version(data.verifier_key_version)
    || (data.status !== 'pending' && data.status !== 'consumed')
    || (data.destination_id !== null && !canonicalIdentifier(data.destination_id))) {
    throw apiError('temporarily_unavailable');
  }
  const createdAt = timestamp(data.created_at);
  const expiresAt = timestamp(data.expires_at);
  const consumedAt = optionalTimestamp(data.consumed_at);
  if (expiresAt.toMillis() <= createdAt.toMillis()
    || (data.status === 'pending' && (data.destination_id !== null || consumedAt !== null))
    || (data.status === 'consumed' && (data.destination_id === null || consumedAt === null))) {
    throw apiError('temporarily_unavailable');
  }
  return Object.freeze({
    appId: data.verified_app_id as string,
    destinationId: data.destination_id as string | null,
    expiresAt,
    fid: data.fid as string,
    fidFingerprint: data.fid_fingerprint as string,
    proofVerifier: data.proof_verifier as string,
    status: data.status as 'pending' | 'consumed',
    verifierKeyVersion: data.verifier_key_version as string,
  });
}

function grantMetadata(record: ValidatedGrant): PushGrantMetadata {
  return record.metadata;
}

function validateGrant(
  snapshot: QueryDocumentSnapshot | DocumentSnapshot,
  ownerUid: string,
  homeId: string,
): ValidatedGrant {
  const data = snapshot.data();
  if (data === undefined
    || !exactKeys(data, [
      'schema',
      'grant_id',
      'home_id',
      'owner_uid',
      'destination_id',
      'status',
      'created_at',
      'expires_at',
      'revoked_at',
    ])
    || data.schema !== 'miakapp.push-grant-record/1'
    || data.grant_id !== snapshot.id
    || !canonicalIdentifier(data.grant_id)
    || data.home_id !== homeId
    || data.owner_uid !== ownerUid
    || !canonicalIdentifier(data.destination_id)
    || (data.status !== 'active' && data.status !== 'revoked')) {
    throw apiError('temporarily_unavailable');
  }
  const createdAt = timestamp(data.created_at);
  const expiresAt = timestamp(data.expires_at);
  const revokedAt = optionalTimestamp(data.revoked_at);
  if (expiresAt.toMillis() <= createdAt.toMillis()
    || (data.status === 'active' && revokedAt !== null)
    || (data.status === 'revoked' && revokedAt === null)) {
    throw apiError('temporarily_unavailable');
  }
  return Object.freeze({
    createdAt,
    destinationId: data.destination_id as string,
    expiresAt,
    homeId,
    metadata: Object.freeze({
      grant_id: data.grant_id as string,
      home_id: homeId,
      destination_id: data.destination_id as string,
      created_at: timestampText(createdAt),
      expires_at: timestampText(expiresAt),
      revoked_at: revokedAt === null ? null : timestampText(revokedAt),
    }),
    ownerUid,
    revokedAt,
    snapshot,
    status: data.status as 'active' | 'revoked',
  });
}

function grantOwner(snapshot: DocumentSnapshot, ownerUid: string, homeId: string): GrantOwnerState {
  if (!snapshot.exists) return { retainedGrantCount: 0 };
  const data = snapshot.data();
  if (data === undefined
    || !exactKeys(data, ['schema', 'owner_uid', 'home_id', 'retained_grant_count', 'updated_at'])
    || data.schema !== 'miakapp.push-grant-owner/1'
    || data.owner_uid !== ownerUid
    || data.home_id !== homeId) {
    throw apiError('temporarily_unavailable');
  }
  timestamp(data.updated_at);
  return { retainedGrantCount: safeCount(data.retained_grant_count) };
}

function reconcileGrants(
  snapshot: QuerySnapshot,
  owner: GrantOwnerState,
  ownerUid: string,
  homeId: string,
): ValidatedGrant[] {
  if (snapshot.size > MAX_RETAINED_GRANTS
    || snapshot.size !== owner.retainedGrantCount
    || owner.retainedGrantCount > MAX_RETAINED_GRANTS) {
    throw apiError('temporarily_unavailable');
  }
  const records = snapshot.docs.map((document) => validateGrant(document, ownerUid, homeId));
  const liveDestinations = new Set<string>();
  for (const record of records) {
    if (record.status !== 'active') continue;
    if (liveDestinations.has(record.destinationId)) throw apiError('temporarily_unavailable');
    liveDestinations.add(record.destinationId);
  }
  return records;
}

function validateGrantIndex(
  snapshot: DocumentSnapshot,
  grant: ValidatedGrant,
): void {
  const data = snapshot.data();
  if (!snapshot.exists
    || data === undefined
    || !exactKeys(data, ['schema', 'grant_id', 'home_id', 'owner_uid', 'destination_id', 'status', 'created_at'])
    || data.schema !== 'miakapp.push-grant-index/1'
    || data.grant_id !== snapshot.id
    || data.grant_id !== grant.snapshot.id
    || data.home_id !== grant.homeId
    || data.owner_uid !== grant.ownerUid
    || data.destination_id !== grant.destinationId
    || data.status !== grant.status) {
    throw apiError('temporarily_unavailable');
  }
  timestamp(data.created_at);
}

function compareRecords(
  left: { readonly createdAt: Timestamp; readonly snapshot: QueryDocumentSnapshot | DocumentSnapshot },
  right: { readonly createdAt: Timestamp; readonly snapshot: QueryDocumentSnapshot | DocumentSnapshot },
): number {
  return left.createdAt.toMillis() - right.createdAt.toMillis()
    || Buffer.compare(Buffer.from(left.snapshot.id, 'ascii'), Buffer.from(right.snapshot.id, 'ascii'));
}

export class PushStore {
  readonly #clock: Clock;
  readonly #config: DeploymentConfig;
  readonly #firestore: Firestore;
  readonly #identifierGenerator: IdentifierGenerator;
  readonly #secretGenerator: SecretGenerator;

  constructor(
    firestore: Firestore,
    config: DeploymentConfig,
    clock: Clock,
    identifierGenerator: IdentifierGenerator = randomIdentifier,
    secretGenerator: SecretGenerator = () => randomBytes(32).toString('base64url'),
  ) {
    this.#firestore = firestore;
    this.#config = config;
    this.#clock = clock;
    this.#identifierGenerator = identifierGenerator;
    this.#secretGenerator = secretGenerator;
  }

  async issueDestinationChallenge(
    principal: FirebasePrincipal,
    appCheck: AppCheckPrincipal,
    fid: string,
  ): Promise<PushChallengeDelivery> {
    if (!boundedFid(fid)) throw apiError('invalid_request');
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const challengeId = this.#identifierGenerator();
      const challengeSecret = this.#secretGenerator();
      if (!canonicalIdentifier(challengeId) || !canonicalSecret(challengeSecret)) {
        throw apiError('temporarily_unavailable');
      }
      try {
        return await this.#issueChallengeTransaction(principal, appCheck, fid, challengeId, challengeSecret);
      } catch (error) {
        if (!(error instanceof IdentifierCollision)) throw error;
      }
    }
    throw apiError('temporarily_unavailable');
  }

  async #issueChallengeTransaction(
    principal: FirebasePrincipal,
    appCheck: AppCheckPrincipal,
    fid: string,
    challengeId: string,
    challengeSecret: string,
  ): Promise<PushChallengeDelivery> {
    const collection = this.#firestore.collection('users').doc(principal.userId).collection('pushChallenges');
    const challengeRef = collection.doc(challengeId);
    const ownerRef = this.#firestore.collection('controlPushOwners').doc(principal.userId);
    const nowMilliseconds = this.#clock.now();
    const now = Timestamp.fromMillis(nowMilliseconds);
    const expiresAt = Timestamp.fromMillis(nowMilliseconds + CHALLENGE_TTL_MILLISECONDS);
    const keyVersion = this.#config.pushKeyVersion;
    const fidFingerprint = this.#keyedDigest(FID_FINGERPRINT_DOMAIN, fid, keyVersion);
    const proofVerifier = this.#keyedDigest(
      PROOF_VERIFIER_DOMAIN,
      JSON.stringify([principal.userId, appCheck.appId, challengeId, challengeSecret]),
      keyVersion,
    );
    const result = await this.#firestore.runTransaction(async (transaction) => {
      const [existing, ownerSnapshot, registry] = await Promise.all([
        transaction.get(challengeRef),
        transaction.get(ownerRef),
        transaction.get(collection.limit(MAX_ACTIVE_CHALLENGES + 1)),
      ]);
      const owner = destinationOwner(ownerSnapshot, principal.userId);
      if (registry.size > MAX_ACTIVE_CHALLENGES) throw apiError('temporarily_unavailable');
      const records = registry.docs.map((document) => ({
        record: validateChallenge(document, principal.userId),
        snapshot: document,
      }));
      if (existing.exists) {
        const record = validateChallenge(existing, principal.userId);
        if (record.status === 'pending'
          && record.appId === appCheck.appId
          && record.fid === fid
          && record.fidFingerprint === fidFingerprint
          && record.proofVerifier === proofVerifier
          && record.verifierKeyVersion === keyVersion
          && record.expiresAt.isEqual(expiresAt)) {
          return record;
        }
        throw new IdentifierCollision();
      }
      const live = records.filter(({ record }) => (
        record.status === 'pending' && record.expiresAt.toMillis() > now.toMillis()
      ));
      if (live.length >= MAX_ACTIVE_CHALLENGES) throw apiError('limit_exceeded');
      for (const { record, snapshot } of records) {
        if (record.status === 'consumed' || record.expiresAt.toMillis() <= now.toMillis()) {
          transaction.delete(snapshot.ref);
        }
      }
      const data = {
        schema: 'miakapp.push-challenge-record/1',
        challenge_id: challengeId,
        owner_uid: principal.userId,
        verified_app_id: appCheck.appId,
        fid,
        fid_fingerprint: fidFingerprint,
        proof_verifier: proofVerifier,
        verifier_key_version: keyVersion,
        status: 'pending',
        destination_id: null,
        created_at: now,
        expires_at: expiresAt,
        consumed_at: null,
      };
      transaction.create(challengeRef, data);
      transaction.set(ownerRef, {
        schema: 'miakapp.push-owner/1',
        owner_uid: principal.userId,
        active_destination_count: owner.destinationCount,
        updated_at: now,
      });
      return Object.freeze({ expiresAt });
    });
    return Object.freeze({
      challengeId,
      challengeSecret,
      expiresAt: timestampText(result.expiresAt),
      fid,
    });
  }

  async completeDestinationChallenge(
    principal: FirebasePrincipal,
    appCheck: AppCheckPrincipal,
    challengeId: string,
    challengeSecret: string,
  ): Promise<PushDestinationMetadata> {
    if (!canonicalIdentifier(challengeId) || !canonicalSecret(challengeSecret)) {
      throw apiError('invalid_destination_proof');
    }
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const destinationId = this.#identifierGenerator();
      if (!canonicalIdentifier(destinationId)) throw apiError('temporarily_unavailable');
      try {
        return await this.#completeChallengeTransaction(
          principal,
          appCheck,
          challengeId,
          challengeSecret,
          destinationId,
        );
      } catch (error) {
        if (!(error instanceof IdentifierCollision)) throw error;
      }
    }
    throw apiError('temporarily_unavailable');
  }

  async #completeChallengeTransaction(
    principal: FirebasePrincipal,
    appCheck: AppCheckPrincipal,
    challengeId: string,
    challengeSecret: string,
    destinationId: string,
  ): Promise<PushDestinationMetadata> {
    const userRef = this.#firestore.collection('users').doc(principal.userId);
    const challengeRef = userRef.collection('pushChallenges').doc(challengeId);
    const destinationRef = userRef.collection('pushDestinations').doc(destinationId);
    const ownerRef = this.#firestore.collection('controlPushOwners').doc(principal.userId);
    const destinationsQuery = userRef.collection('pushDestinations').limit(MAX_ACTIVE_DESTINATIONS + 1);
    const now = Timestamp.fromMillis(this.#clock.now());
    return this.#firestore.runTransaction(async (transaction) => {
      const [challengeSnapshot, destinationSnapshot, ownerSnapshot, destinations] = await Promise.all([
        transaction.get(challengeRef),
        transaction.get(destinationRef),
        transaction.get(ownerRef),
        transaction.get(destinationsQuery),
      ]);
      const owner = destinationOwner(ownerSnapshot, principal.userId);
      reconcileDestinations(destinations, owner, principal.userId);
      if (!challengeSnapshot.exists) throw apiError('invalid_destination_proof');
      const challenge = validateChallenge(challengeSnapshot, principal.userId);
      if (challenge.status === 'consumed') {
        if (challenge.destinationId === destinationId && destinationSnapshot.exists) {
          return destinationMetadata(validateDestination(destinationSnapshot, principal.userId));
        }
        throw apiError('invalid_destination_proof');
      }
      const proofVerifier = this.#keyedDigest(
        PROOF_VERIFIER_DOMAIN,
        JSON.stringify([principal.userId, appCheck.appId, challengeId, challengeSecret]),
        challenge.verifierKeyVersion,
      );
      if (challenge.appId !== appCheck.appId
        || challenge.expiresAt.toMillis() <= now.toMillis()
        || !this.#digestMatches(proofVerifier, challenge.proofVerifier)
        || this.#keyedDigest(FID_FINGERPRINT_DOMAIN, challenge.fid, challenge.verifierKeyVersion)
          !== challenge.fidFingerprint) {
        throw apiError('invalid_destination_proof');
      }
      if (destinationSnapshot.exists) throw new IdentifierCollision();
      if (owner.destinationCount >= MAX_ACTIVE_DESTINATIONS) throw apiError('limit_exceeded');
      const data = {
        schema: 'miakapp.push-destination/1',
        provider: 'fcm',
        fid: challenge.fid,
        fid_fingerprint: challenge.fidFingerprint,
        verified_app_id: appCheck.appId,
        created_at: now,
        updated_at: now,
      };
      transaction.create(destinationRef, data);
      transaction.set(ownerRef, {
        schema: 'miakapp.push-owner/1',
        owner_uid: principal.userId,
        active_destination_count: owner.destinationCount + 1,
        updated_at: now,
      });
      transaction.update(challengeRef, {
        status: 'consumed',
        destination_id: destinationId,
        consumed_at: now,
      });
      return Object.freeze({
        destination_id: destinationId,
        provider: 'fcm',
        created_at: timestampText(now),
        updated_at: timestampText(now),
      });
    });
  }

  async listDestinations(principal: FirebasePrincipal): Promise<PushDestinationMetadata[]> {
    const userRef = this.#firestore.collection('users').doc(principal.userId);
    const ownerRef = this.#firestore.collection('controlPushOwners').doc(principal.userId);
    return this.#firestore.runTransaction(async (transaction) => {
      const [ownerSnapshot, destinations] = await Promise.all([
        transaction.get(ownerRef),
        transaction.get(userRef.collection('pushDestinations').limit(MAX_ACTIVE_DESTINATIONS + 1)),
      ]);
      const owner = destinationOwner(ownerSnapshot, principal.userId);
      return Object.freeze(reconcileDestinations(destinations, owner, principal.userId)
        .sort(compareRecords)
        .map(destinationMetadata)) as PushDestinationMetadata[];
    });
  }

  async deleteDestination(principal: FirebasePrincipal, destinationId: string): Promise<void> {
    const userRef = this.#firestore.collection('users').doc(principal.userId);
    const destinationRef = userRef.collection('pushDestinations').doc(destinationId);
    const ownerRef = this.#firestore.collection('controlPushOwners').doc(principal.userId);
    const now = Timestamp.fromMillis(this.#clock.now());
    await this.#firestore.runTransaction(async (transaction) => {
      const [destinationSnapshot, ownerSnapshot, destinations] = await Promise.all([
        transaction.get(destinationRef),
        transaction.get(ownerRef),
        transaction.get(userRef.collection('pushDestinations').limit(MAX_ACTIVE_DESTINATIONS + 1)),
      ]);
      const owner = destinationOwner(ownerSnapshot, principal.userId);
      reconcileDestinations(destinations, owner, principal.userId);
      if (!destinationSnapshot.exists) return;
      validateDestination(destinationSnapshot, principal.userId);
      if (owner.destinationCount === 0) throw apiError('temporarily_unavailable');
      transaction.delete(destinationRef);
      transaction.set(ownerRef, {
        schema: 'miakapp.push-owner/1',
        owner_uid: principal.userId,
        active_destination_count: owner.destinationCount - 1,
        updated_at: now,
      });
    });
  }

  async createGrant(
    principal: FirebasePrincipal,
    homeId: string,
    destinationId: string,
  ): Promise<PushGrantMetadata> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const grantId = this.#identifierGenerator();
      if (!canonicalIdentifier(grantId)) throw apiError('temporarily_unavailable');
      try {
        return await this.#createGrantTransaction(principal, homeId, destinationId, grantId);
      } catch (error) {
        if (!(error instanceof IdentifierCollision)) throw error;
      }
    }
    throw apiError('temporarily_unavailable');
  }

  async #createGrantTransaction(
    principal: FirebasePrincipal,
    homeId: string,
    destinationId: string,
    grantId: string,
  ): Promise<PushGrantMetadata> {
    const ownerRef = this.#grantOwnerRef(principal.userId, homeId);
    const grantRef = ownerRef.collection('grants').doc(grantId);
    const indexRef = this.#firestore.collection('pushGrantIndex').doc(grantId);
    const homeRef = this.#firestore.collection('controlHomes').doc(homeId);
    const userRef = this.#firestore.collection('users').doc(principal.userId);
    const destinationOwnerRef = this.#firestore.collection('controlPushOwners').doc(principal.userId);
    const nowMilliseconds = this.#clock.now();
    const now = Timestamp.fromMillis(nowMilliseconds);
    const expiresAt = Timestamp.fromMillis(nowMilliseconds + GRANT_TTL_MILLISECONDS);
    return this.#firestore.runTransaction(async (transaction) => {
      const [
        home,
        destinationOwnerSnapshot,
        destinations,
        ownerSnapshot,
        grants,
        grantSnapshot,
        indexSnapshot,
      ] = await Promise.all([
        transaction.get(homeRef),
        transaction.get(destinationOwnerRef),
        transaction.get(userRef.collection('pushDestinations').limit(MAX_ACTIVE_DESTINATIONS + 1)),
        transaction.get(ownerRef),
        transaction.get(ownerRef.collection('grants').limit(MAX_RETAINED_GRANTS + 1)),
        transaction.get(grantRef),
        transaction.get(indexRef),
      ]);
      if (!home.exists) throw apiError('home_not_found');
      if (home.get('schema') !== 'miakapp.control-home/1' || home.get('home_id') !== homeId) {
        throw apiError('temporarily_unavailable');
      }
      const destinationOwnerState = destinationOwner(destinationOwnerSnapshot, principal.userId);
      const destinationRecords = reconcileDestinations(
        destinations,
        destinationOwnerState,
        principal.userId,
      );
      const currentDestinationIds = new Set(destinationRecords.map((record) => record.snapshot.id));
      if (!currentDestinationIds.has(destinationId)) throw apiError('invalid_push_grant');
      const owner = grantOwner(ownerSnapshot, principal.userId, homeId);
      const records = reconcileGrants(grants, owner, principal.userId, homeId);
      if (grantSnapshot.exists || indexSnapshot.exists) {
        if (!grantSnapshot.exists || !indexSnapshot.exists) throw new IdentifierCollision();
        const existing = validateGrant(grantSnapshot, principal.userId, homeId);
        validateGrantIndex(indexSnapshot, existing);
        if (existing.status === 'active'
          && existing.destinationId === destinationId
          && existing.createdAt.isEqual(now)
          && existing.expiresAt.isEqual(expiresAt)) {
          return grantMetadata(existing);
        }
        throw new IdentifierCollision();
      }
      const previous = records.find((record) => (
        record.status === 'active' && record.destinationId === destinationId
      ));
      let compacted: ValidatedGrant | undefined;
      if (owner.retainedGrantCount >= MAX_RETAINED_GRANTS) {
        compacted = records
          .filter((record) => (
            record.status === 'revoked'
              || record.expiresAt.toMillis() <= now.toMillis()
              || !currentDestinationIds.has(record.destinationId)
          ))
          .sort(compareRecords)[0];
        if (compacted === undefined) throw apiError('limit_exceeded');
      }
      const readIndexes = [previous, compacted]
        .filter((record): record is ValidatedGrant => record !== undefined)
        .filter((record, index, values) => values.indexOf(record) === index);
      const indexSnapshots = await Promise.all(readIndexes.map((record) => (
        transaction.get(this.#firestore.collection('pushGrantIndex').doc(record.snapshot.id))
      )));
      indexSnapshots.forEach((snapshot, index) => {
        const record = readIndexes[index];
        if (record === undefined) throw apiError('temporarily_unavailable');
        validateGrantIndex(snapshot, record);
      });
      if (compacted !== undefined) {
        transaction.delete(compacted.snapshot.ref);
        transaction.delete(this.#firestore.collection('pushGrantIndex').doc(compacted.snapshot.id));
      }
      if (previous !== undefined && previous !== compacted) {
        transaction.update(previous.snapshot.ref, { status: 'revoked', revoked_at: now });
        transaction.update(this.#firestore.collection('pushGrantIndex').doc(previous.snapshot.id), {
          status: 'revoked',
        });
      }
      const record = {
        schema: 'miakapp.push-grant-record/1',
        grant_id: grantId,
        home_id: homeId,
        owner_uid: principal.userId,
        destination_id: destinationId,
        status: 'active',
        created_at: now,
        expires_at: expiresAt,
        revoked_at: null,
      };
      transaction.create(grantRef, record);
      transaction.create(indexRef, {
        schema: 'miakapp.push-grant-index/1',
        grant_id: grantId,
        home_id: homeId,
        owner_uid: principal.userId,
        destination_id: destinationId,
        status: 'active',
        created_at: now,
      });
      transaction.set(ownerRef, {
        schema: 'miakapp.push-grant-owner/1',
        owner_uid: principal.userId,
        home_id: homeId,
        retained_grant_count: compacted === undefined
          ? owner.retainedGrantCount + 1
          : owner.retainedGrantCount,
        updated_at: now,
      });
      return Object.freeze({
        grant_id: grantId,
        home_id: homeId,
        destination_id: destinationId,
        created_at: timestampText(now),
        expires_at: timestampText(expiresAt),
        revoked_at: null,
      });
    });
  }

  async listGrants(principal: FirebasePrincipal, homeId: string): Promise<PushGrantMetadata[]> {
    const ownerRef = this.#grantOwnerRef(principal.userId, homeId);
    return this.#firestore.runTransaction(async (transaction) => {
      const [ownerSnapshot, grants] = await Promise.all([
        transaction.get(ownerRef),
        transaction.get(ownerRef.collection('grants').limit(MAX_RETAINED_GRANTS + 1)),
      ]);
      const owner = grantOwner(ownerSnapshot, principal.userId, homeId);
      return Object.freeze(reconcileGrants(grants, owner, principal.userId, homeId)
        .sort(compareRecords)
        .map(grantMetadata)) as PushGrantMetadata[];
    });
  }

  async revokeGrant(principal: FirebasePrincipal, homeId: string, grantId: string): Promise<void> {
    const ownerRef = this.#grantOwnerRef(principal.userId, homeId);
    const grantRef = ownerRef.collection('grants').doc(grantId);
    const indexRef = this.#firestore.collection('pushGrantIndex').doc(grantId);
    const now = Timestamp.fromMillis(this.#clock.now());
    await this.#firestore.runTransaction(async (transaction) => {
      const [grantSnapshot, indexSnapshot] = await Promise.all([
        transaction.get(grantRef),
        transaction.get(indexRef),
      ]);
      if (!grantSnapshot.exists) return;
      const grant = validateGrant(grantSnapshot, principal.userId, homeId);
      if (!indexSnapshot.exists) throw apiError('temporarily_unavailable');
      validateGrantIndex(indexSnapshot, grant);
      if (grant.status === 'revoked') return;
      transaction.update(grantRef, { status: 'revoked', revoked_at: now });
      transaction.update(indexRef, { status: 'revoked' });
    });
  }

  async authorizePush(
    principal: PushAccessPrincipal,
    grantId: string,
  ): Promise<AuthorizedPushDestination> {
    const indexRef = this.#firestore.collection('pushGrantIndex').doc(grantId);
    const now = this.#clock.now();
    return this.#firestore.runTransaction(async (transaction) => {
      const index = await transaction.get(indexRef);
      if (!index.exists) throw apiError('invalid_push_grant');
      const homeId = index.get('home_id');
      const ownerUid = index.get('owner_uid');
      if (homeId !== principal.homeId
        || typeof ownerUid !== 'string'
        || ownerUid.length === 0
        || ownerUid.length > 128
        || index.get('status') !== 'active') {
        throw apiError('invalid_push_grant');
      }
      const grantRef = this.#grantOwnerRef(ownerUid, homeId).collection('grants').doc(grantId);
      const grantSnapshot = await transaction.get(grantRef);
      if (!grantSnapshot.exists) throw apiError('invalid_push_grant');
      const grant = validateGrant(grantSnapshot, ownerUid, homeId);
      validateGrantIndex(index, grant);
      if (grant.status !== 'active' || grant.expiresAt.toMillis() <= now) {
        throw apiError('invalid_push_grant');
      }
      const destinationRef = this.#firestore.collection('users').doc(ownerUid)
        .collection('pushDestinations').doc(grant.destinationId);
      const destinationSnapshot = await transaction.get(destinationRef);
      if (!destinationSnapshot.exists) throw apiError('invalid_push_grant');
      const destination = validateDestination(destinationSnapshot, ownerUid);
      return Object.freeze({ destinationId: destination.snapshot.id, fid: destination.fid });
    });
  }

  #grantOwnerRef(ownerUid: string, homeId: string): DocumentReference {
    return this.#firestore.collection('controlHomes').doc(homeId)
      .collection('pushGrantOwners').doc(ownerUid);
  }

  #keyedDigest(domain: string, value: string, keyVersion: string): string {
    const key = this.#config.pushHmacKeyForVersion(keyVersion);
    if (key === undefined || key.byteLength !== 32) throw apiError('temporarily_unavailable');
    return createHmac('sha256', key).update(domain, 'utf8').update(value, 'utf8').digest('base64url');
  }

  #digestMatches(left: string, right: string): boolean {
    if (!canonicalSecret(left) || !canonicalSecret(right)) return false;
    return timingSafeEqual(Buffer.from(left, 'base64url'), Buffer.from(right, 'base64url'));
  }
}
