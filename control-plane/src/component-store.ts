import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import {
  Firestore,
  Timestamp,
  type DocumentData,
  type DocumentReference,
  type DocumentSnapshot,
} from 'firebase-admin/firestore';

import {
  inspectComponentArtifact,
  MAX_COMPONENT_ARTIFACT_BYTES,
  validateComponentRequirements,
} from './component-artifact.js';
import { type ComponentObjectStorage } from './component-storage.js';
import { apiError, ApiError } from './errors.js';
import { randomIdentifier } from './crypto.js';
import {
  COMPONENT_ABI,
  HOME_ID_PATTERN,
  type Clock,
  type ComponentPointerRepresentation,
  type ComponentPublisherPrincipal,
  type ComponentReleaseRepresentation,
  type ComponentRequirements,
  type ComponentUploadInput,
  type ComponentUploadRepresentation,
  type ComponentUploadStatus,
  type ComponentUploadStatusRepresentation,
  type DeploymentConfig,
} from './types.js';

const UPLOAD_TTL_MILLISECONDS = 900_000;
const UPLOAD_SCHEMA = 'miakapp.component-upload-record/1';
const UPLOAD_INDEX_SCHEMA = 'miakapp.component-upload-index/1';
const RELEASE_SCHEMA = 'miakapp.component-release-record/1';
const ARTIFACT_PUBLICATION_SCHEMA = 'miakapp.component-artifact-publication/1';
const POINTER_SCHEMA = 'miakapp.component-pointer/1';
const QUARANTINE_SCHEMA = 'miakapp.component-quarantine/1';
const CONTROL_CHARACTER = /\p{Cc}/u;

class IdentifierCollision extends Error {}

type InternalUploadStatus = 'awaiting_upload' | 'delivery_reserved' | 'delivered' | 'finalized';

interface ComponentStoreConfig extends Pick<DeploymentConfig,
  | 'componentUploadBaseUrl'
  | 'componentArtifactBaseUrl'
  | 'componentKeyVersion'
  | 'componentHmacKeyForVersion'> {}

interface ValidatedUpload {
  readonly snapshot: DocumentSnapshot;
  readonly uploadId: string;
  readonly homeId: string;
  readonly input: ComponentUploadInput;
  readonly publisherKind: ComponentPublisherPrincipal['kind'];
  readonly publisherId: string;
  readonly bindingId: string;
  readonly capabilityVerifier: string;
  readonly capabilityKeyVersion: string;
  readonly status: InternalUploadStatus;
  readonly createdAt: Timestamp;
  readonly expiresAt: Timestamp;
  readonly consumedAt: Timestamp | null;
  readonly deliveredAt: Timestamp | null;
  readonly finalizedAt: Timestamp | null;
}

interface ValidatedRelease {
  readonly snapshot: DocumentSnapshot;
  readonly homeId: string;
  readonly input: ComponentUploadInput;
  readonly publisherKind: ComponentPublisherPrincipal['kind'];
  readonly publisherId: string;
  readonly bindingId: string;
  readonly publicUrl: string;
  readonly finalizedAt: Timestamp;
}

export interface ComponentActivationInput {
  readonly sha256: string;
  readonly expectedGeneration: number;
  readonly generation: number;
}

export type ComponentIdentifierGenerator = () => string;
export type ComponentSecretGenerator = () => string;

function exactKeys(data: DocumentData, expected: readonly string[]): boolean {
  const actual = Object.keys(data);
  return actual.length === expected.length && expected.every((key) => Object.hasOwn(data, key));
}

function timestamp(value: unknown): Timestamp {
  if (!(value instanceof Timestamp)) throw apiError('temporarily_unavailable');
  return value;
}

function optionalTimestamp(value: unknown): Timestamp | null {
  return value === null ? null : timestamp(value);
}

function timestampText(value: Timestamp): string {
  return value.toDate().toISOString();
}

function canonicalBase64url(value: unknown, bytes: number): value is string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) return false;
  const decoded = Buffer.from(value, 'base64url');
  return decoded.byteLength === bytes && decoded.toString('base64url') === value;
}

function boundedRelease(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && Buffer.byteLength(value, 'utf8') <= 64
    && !CONTROL_CHARACTER.test(value);
}

function normalizedRequirements(value: ComponentRequirements): ComponentRequirements {
  return validateComponentRequirements({
    state_read: [...value.state_read],
    event_subscribe: [...value.event_subscribe],
    event_publish: [...value.event_publish],
    call: [...value.call],
    presentation: [...value.presentation],
  });
}

function storedRequirements(value: unknown): ComponentRequirements {
  try {
    return validateComponentRequirements(value as never);
  } catch (error) {
    if (error instanceof ApiError) throw apiError('temporarily_unavailable');
    throw error;
  }
}

function canonicalInput(input: ComponentUploadInput): ComponentUploadInput {
  if (!boundedRelease(input.release)
    || input.abi !== COMPONENT_ABI
    || !canonicalBase64url(input.sha256, 32)
    || !Number.isSafeInteger(input.size)
    || input.size <= 0
    || input.size > MAX_COMPONENT_ARTIFACT_BYTES) {
    throw apiError('invalid_artifact');
  }
  return Object.freeze({
    release: input.release,
    abi: COMPONENT_ABI,
    sha256: input.sha256,
    size: input.size,
    requires: normalizedRequirements(input.requires),
  });
}

function bindingId(
  homeId: string,
  input: ComponentUploadInput,
  publisherKind: ComponentPublisherPrincipal['kind'],
  publisherId: string,
): string {
  return createHash('sha256').update(JSON.stringify({
    home_id: homeId,
    release: input.release,
    abi: input.abi,
    sha256: input.sha256,
    size: input.size,
    requires: input.requires,
    publisher_kind: publisherKind,
    publisher_id: publisherId,
  }), 'utf8').digest('base64url');
}

function publisherIdentity(principal: ComponentPublisherPrincipal, homeId: string): {
  readonly kind: ComponentPublisherPrincipal['kind'];
  readonly id: string;
} {
  if (principal.homeId !== homeId) {
    throw apiError(principal.kind === 'owner' ? 'not_home_owner' : 'invalid_access_token');
  }
  if (principal.kind === 'owner') {
    if (principal.userId.length === 0 || Buffer.byteLength(principal.userId, 'utf8') > 128) {
      throw apiError('invalid_firebase_token');
    }
    return { kind: 'owner', id: principal.userId };
  }
  if (!canonicalBase64url(principal.clientId, 16)) throw apiError('invalid_access_token');
  return { kind: 'access_token', id: principal.clientId };
}

function authorizeHome(
  home: DocumentSnapshot,
  principal: ComponentPublisherPrincipal,
  homeId: string,
): { readonly kind: ComponentPublisherPrincipal['kind']; readonly id: string } {
  if (!home.exists) throw apiError('home_not_found');
  if (home.get('schema') !== 'miakapp.control-home/1'
    || home.get('home_id') !== homeId
    || typeof home.get('owner_uid') !== 'string') {
    throw apiError('temporarily_unavailable');
  }
  const publisher = publisherIdentity(principal, homeId);
  if (publisher.kind === 'owner' && home.get('owner_uid') !== publisher.id) {
    throw apiError('not_home_owner');
  }
  return publisher;
}

function sameRequirements(left: ComponentRequirements, right: ComponentRequirements): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameInput(left: ComponentUploadInput, right: ComponentUploadInput): boolean {
  return left.release === right.release
    && left.abi === right.abi
    && left.sha256 === right.sha256
    && left.size === right.size
    && sameRequirements(left.requires, right.requires);
}

function validateUpload(snapshot: DocumentSnapshot, expectedHomeId?: string): ValidatedUpload {
  const data = snapshot.data();
  if (data === undefined
    || !exactKeys(data, [
      'schema',
      'upload_id',
      'home_id',
      'release',
      'abi',
      'sha256',
      'size',
      'requires',
      'publisher_kind',
      'publisher_id',
      'binding_id',
      'capability_verifier',
      'capability_key_version',
      'status',
      'created_at',
      'expires_at',
      'consumed_at',
      'delivered_at',
      'finalized_at',
    ])
    || data.schema !== UPLOAD_SCHEMA
    || data.upload_id !== snapshot.id
    || !canonicalBase64url(data.upload_id, 16)
    || typeof data.home_id !== 'string'
    || !HOME_ID_PATTERN.test(data.home_id)
    || (expectedHomeId !== undefined && data.home_id !== expectedHomeId)
    || !boundedRelease(data.release)
    || data.abi !== COMPONENT_ABI
    || !canonicalBase64url(data.sha256, 32)
    || !Number.isSafeInteger(data.size)
    || data.size <= 0
    || data.size > MAX_COMPONENT_ARTIFACT_BYTES
    || (data.publisher_kind !== 'owner' && data.publisher_kind !== 'access_token')
    || typeof data.publisher_id !== 'string'
    || data.publisher_id.length === 0
    || Buffer.byteLength(data.publisher_id, 'utf8') > 128
    || !canonicalBase64url(data.binding_id, 32)
    || !canonicalBase64url(data.capability_verifier, 32)
    || typeof data.capability_key_version !== 'string'
    || data.capability_key_version.length === 0
    || data.capability_key_version.length > 64
    || !['awaiting_upload', 'delivery_reserved', 'delivered', 'finalized'].includes(data.status)) {
    throw apiError('temporarily_unavailable');
  }
  const createdAt = timestamp(data.created_at);
  const expiresAt = timestamp(data.expires_at);
  const consumedAt = optionalTimestamp(data.consumed_at);
  const deliveredAt = optionalTimestamp(data.delivered_at);
  const finalizedAt = optionalTimestamp(data.finalized_at);
  const status = data.status as InternalUploadStatus;
  const createdMilliseconds = createdAt.toMillis();
  const expiresMilliseconds = expiresAt.toMillis();
  const consumedMilliseconds = consumedAt?.toMillis();
  const deliveredMilliseconds = deliveredAt?.toMillis();
  const finalizedMilliseconds = finalizedAt?.toMillis();
  if (expiresMilliseconds <= createdMilliseconds
    || expiresMilliseconds - createdMilliseconds > UPLOAD_TTL_MILLISECONDS
    || (consumedMilliseconds !== undefined
      && (consumedMilliseconds < createdMilliseconds || consumedMilliseconds >= expiresMilliseconds))
    || (deliveredMilliseconds !== undefined
      && (consumedMilliseconds === undefined || deliveredMilliseconds < consumedMilliseconds))
    || (finalizedMilliseconds !== undefined
      && (deliveredMilliseconds === undefined || finalizedMilliseconds < deliveredMilliseconds))
    || (status === 'awaiting_upload' && (consumedAt !== null || deliveredAt !== null || finalizedAt !== null))
    || (status === 'delivery_reserved' && (consumedAt === null || deliveredAt !== null || finalizedAt !== null))
    || (status === 'delivered' && (consumedAt === null || deliveredAt === null || finalizedAt !== null))
    || (status === 'finalized' && (consumedAt === null || deliveredAt === null || finalizedAt === null))) {
    throw apiError('temporarily_unavailable');
  }
  const input = Object.freeze({
    release: data.release as string,
    abi: COMPONENT_ABI,
    sha256: data.sha256 as string,
    size: data.size as number,
    requires: storedRequirements(data.requires),
  });
  const expectedBinding = bindingId(
    data.home_id as string,
    input,
    data.publisher_kind as ComponentPublisherPrincipal['kind'],
    data.publisher_id as string,
  );
  if (expectedBinding !== data.binding_id) throw apiError('temporarily_unavailable');
  return Object.freeze({
    snapshot,
    uploadId: data.upload_id as string,
    homeId: data.home_id as string,
    input,
    publisherKind: data.publisher_kind as ComponentPublisherPrincipal['kind'],
    publisherId: data.publisher_id as string,
    bindingId: data.binding_id as string,
    capabilityVerifier: data.capability_verifier as string,
    capabilityKeyVersion: data.capability_key_version as string,
    status,
    createdAt,
    expiresAt,
    consumedAt,
    deliveredAt,
    finalizedAt,
  });
}

function validateUploadIndex(
  snapshot: DocumentSnapshot,
  upload: ValidatedUpload,
): void {
  const data = snapshot.data();
  if (data === undefined
    || !exactKeys(data, ['schema', 'upload_id', 'home_id', 'status', 'created_at'])
    || data.schema !== UPLOAD_INDEX_SCHEMA
    || data.upload_id !== upload.uploadId
    || snapshot.id !== upload.uploadId
    || data.home_id !== upload.homeId
    || data.status !== upload.status
    || !timestamp(data.created_at).isEqual(upload.createdAt)) {
    throw apiError('temporarily_unavailable');
  }
}

function validateRelease(snapshot: DocumentSnapshot, expectedHomeId: string): ValidatedRelease {
  const data = snapshot.data();
  if (data === undefined
    || !exactKeys(data, [
      'schema',
      'home_id',
      'release',
      'abi',
      'sha256',
      'size',
      'requires',
      'publisher_kind',
      'publisher_id',
      'binding_id',
      'public_url',
      'finalized_at',
    ])
    || data.schema !== RELEASE_SCHEMA
    || data.home_id !== expectedHomeId
    || !boundedRelease(data.release)
    || data.abi !== COMPONENT_ABI
    || data.sha256 !== snapshot.id
    || !canonicalBase64url(data.sha256, 32)
    || !Number.isSafeInteger(data.size)
    || data.size <= 0
    || data.size > MAX_COMPONENT_ARTIFACT_BYTES
    || (data.publisher_kind !== 'owner' && data.publisher_kind !== 'access_token')
    || typeof data.publisher_id !== 'string'
    || data.publisher_id.length === 0
    || Buffer.byteLength(data.publisher_id, 'utf8') > 128
    || !canonicalBase64url(data.binding_id, 32)
    || typeof data.public_url !== 'string') {
    throw apiError('temporarily_unavailable');
  }
  let publicUrl: URL;
  try {
    publicUrl = new URL(data.public_url);
  } catch {
    throw apiError('temporarily_unavailable');
  }
  if (publicUrl.protocol !== 'https:'
    || publicUrl.username
    || publicUrl.password
    || publicUrl.search
    || publicUrl.hash) {
    throw apiError('temporarily_unavailable');
  }
  const input = Object.freeze({
    release: data.release as string,
    abi: COMPONENT_ABI,
    sha256: data.sha256 as string,
    size: data.size as number,
    requires: storedRequirements(data.requires),
  });
  const expectedBinding = bindingId(
    expectedHomeId,
    input,
    data.publisher_kind as ComponentPublisherPrincipal['kind'],
    data.publisher_id as string,
  );
  if (expectedBinding !== data.binding_id) throw apiError('temporarily_unavailable');
  return Object.freeze({
    snapshot,
    homeId: expectedHomeId,
    input,
    publisherKind: data.publisher_kind as ComponentPublisherPrincipal['kind'],
    publisherId: data.publisher_id as string,
    bindingId: data.binding_id as string,
    publicUrl: publicUrl.href,
    finalizedAt: timestamp(data.finalized_at),
  });
}

function validateArtifactPublication(
  snapshot: DocumentSnapshot,
  sha256: string,
  publicUrl: string,
): void {
  const data = snapshot.data();
  const artifact = `${sha256}.js`;
  if (data === undefined
    || !exactKeys(data, ['schema', 'artifact', 'sha256', 'public_url', 'published_at'])
    || snapshot.id !== artifact
    || data.schema !== ARTIFACT_PUBLICATION_SCHEMA
    || data.artifact !== artifact
    || data.sha256 !== sha256
    || data.public_url !== publicUrl) {
    throw apiError('temporarily_unavailable');
  }
  timestamp(data.published_at);
}

function publisherMatches(
  record: Pick<ValidatedUpload | ValidatedRelease, 'publisherKind' | 'publisherId'>,
  publisher: { readonly kind: ComponentPublisherPrincipal['kind']; readonly id: string },
): boolean {
  return record.publisherKind === publisher.kind && record.publisherId === publisher.id;
}

function uploadStatusRepresentation(
  upload: ValidatedUpload,
  status: ComponentUploadStatus,
): ComponentUploadStatusRepresentation {
  return Object.freeze({
    schema: 'miakapp.component-upload-status/1',
    upload_id: upload.uploadId,
    status,
    ...upload.input,
    expires_at: timestampText(upload.expiresAt),
  });
}

function releaseRepresentation(release: ValidatedRelease): ComponentReleaseRepresentation {
  return Object.freeze({
    schema: 'miakapp.component-release/1',
    ...release.input,
    finalized_at: timestampText(release.finalizedAt),
  });
}

export class ComponentStore {
  readonly #artifactBaseUrl: string;
  readonly #clock: Clock;
  readonly #config: ComponentStoreConfig;
  readonly #firestore: Firestore;
  readonly #identifierGenerator: ComponentIdentifierGenerator;
  readonly #secretGenerator: ComponentSecretGenerator;
  readonly #storage: ComponentObjectStorage;
  readonly #uploadBaseUrl: string;

  constructor(
    firestore: Firestore,
    storage: ComponentObjectStorage,
    config: ComponentStoreConfig,
    clock: Clock,
    identifierGenerator: ComponentIdentifierGenerator = randomIdentifier,
    secretGenerator: ComponentSecretGenerator = () => randomBytes(32).toString('base64url'),
  ) {
    this.#firestore = firestore;
    this.#storage = storage;
    this.#config = config;
    this.#clock = clock;
    this.#identifierGenerator = identifierGenerator;
    this.#secretGenerator = secretGenerator;
    this.#uploadBaseUrl = this.#validatedBaseUrl(config.componentUploadBaseUrl, 'upload');
    this.#artifactBaseUrl = this.#validatedBaseUrl(config.componentArtifactBaseUrl, 'artifact');
    this.#capabilityKey(config.componentKeyVersion);
  }

  async issueUpload(
    principal: ComponentPublisherPrincipal,
    homeId: string,
    requestedInput: ComponentUploadInput,
  ): Promise<ComponentUploadRepresentation> {
    if (!HOME_ID_PATTERN.test(homeId)) throw apiError('invalid_request');
    const input = canonicalInput(requestedInput);
    const publisher = publisherIdentity(principal, homeId);
    const createdAt = Timestamp.fromMillis(this.#clock.now());
    const expiresAt = Timestamp.fromMillis(createdAt.toMillis() + UPLOAD_TTL_MILLISECONDS);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const uploadId = this.#identifierGenerator();
      const uploadToken = this.#secretGenerator();
      if (!canonicalBase64url(uploadId, 16) || !canonicalBase64url(uploadToken, 32)) {
        throw apiError('temporarily_unavailable');
      }
      const verifier = this.#capabilityVerifier(uploadId, uploadToken, this.#config.componentKeyVersion);
      const bound = bindingId(homeId, input, publisher.kind, publisher.id);
      try {
        await this.#createUploadTransaction(
          principal,
          homeId,
          uploadId,
          input,
          publisher,
          bound,
          verifier,
          createdAt,
          expiresAt,
        );
        return Object.freeze({
          schema: 'miakapp.component-upload/1',
          upload_id: uploadId,
          upload_url: `${this.#uploadBaseUrl}/${uploadId}`,
          upload_token: uploadToken,
          expires_at: timestampText(expiresAt),
        });
      } catch (error) {
        if (!(error instanceof IdentifierCollision)) throw error;
      }
    }
    throw apiError('temporarily_unavailable');
  }

  async deliverUpload(uploadId: string, uploadToken: string, bytes: Uint8Array): Promise<void> {
    if (!canonicalBase64url(uploadId, 16) || !canonicalBase64url(uploadToken, 32)) {
      throw apiError('invalid_upload_capability');
    }
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_COMPONENT_ARTIFACT_BYTES) {
      throw apiError(bytes.byteLength > MAX_COMPONENT_ARTIFACT_BYTES ? 'limit_exceeded' : 'invalid_artifact');
    }
    const homeId = await this.#reserveDelivery(uploadId, uploadToken);
    await this.#storage.writeStaging(uploadId, bytes);
    await this.#markDelivered(uploadId, homeId);
  }

  async inspectUpload(
    principal: ComponentPublisherPrincipal,
    homeId: string,
    uploadId: string,
  ): Promise<ComponentUploadStatusRepresentation> {
    const upload = await this.#authorizedUpload(principal, homeId, uploadId);
    if (upload.status === 'delivery_reserved') {
      const bytes = await this.#storage.readStaging(uploadId);
      if (bytes !== null) {
        await this.#markDelivered(uploadId, homeId);
        const refreshed = await this.#authorizedUpload(principal, homeId, uploadId);
        return uploadStatusRepresentation(refreshed, refreshed.status === 'finalized' ? 'finalized' : 'delivered');
      }
    }
    const status: ComponentUploadStatus = upload.status === 'finalized'
      ? 'finalized'
      : upload.status === 'delivered'
        ? 'delivered'
        : 'awaiting_upload';
    return uploadStatusRepresentation(upload, status);
  }

  async finalizeRelease(
    principal: ComponentPublisherPrincipal,
    homeId: string,
    uploadId: string,
  ): Promise<ComponentReleaseRepresentation> {
    const upload = await this.#authorizedUpload(principal, homeId, uploadId);
    if (upload.status === 'awaiting_upload') throw apiError('invalid_artifact');
    if (upload.status === 'finalized') {
      return this.inspectRelease(principal, homeId, upload.input.sha256);
    }
    const bytes = await this.#storage.readStaging(uploadId);
    if (bytes === null) throw apiError('invalid_artifact');
    const evidence = inspectComponentArtifact(bytes);
    if (!evidence.syntaxValid
      || evidence.sha256 !== upload.input.sha256
      || evidence.size !== upload.input.size) {
      throw apiError('invalid_artifact');
    }
    await this.#storage.writeArtifact(evidence.sha256, bytes);
    const publicUrl = this.#artifactUrl(evidence.sha256);
    return this.#commitFinalization(principal, upload, publicUrl);
  }

  async readPublishedArtifact(sha256: string): Promise<Uint8Array> {
    if (!canonicalBase64url(sha256, 32)) throw apiError('invalid_artifact');
    const publicUrl = this.#artifactUrl(sha256);
    const publication = await this.#firestore.collection('componentArtifacts')
      .doc(`${sha256}.js`).get();
    if (!publication.exists) throw apiError('invalid_artifact');
    validateArtifactPublication(publication, sha256, publicUrl);
    const bytes = await this.#storage.readArtifact(sha256);
    if (bytes === null
      || createHash('sha256').update(bytes).digest('base64url') !== sha256) {
      throw apiError('temporarily_unavailable');
    }
    return bytes;
  }

  async inspectRelease(
    principal: ComponentPublisherPrincipal,
    homeId: string,
    sha256: string,
  ): Promise<ComponentReleaseRepresentation> {
    if (!HOME_ID_PATTERN.test(homeId) || !canonicalBase64url(sha256, 32)) {
      throw apiError('invalid_artifact');
    }
    const homeRef = this.#homeRef(homeId);
    const releaseRef = homeRef.collection('componentReleases').doc(sha256);
    const publicationRef = this.#firestore.collection('componentArtifacts').doc(`${sha256}.js`);
    return this.#firestore.runTransaction(async (transaction) => {
      const [home, releaseSnapshot, publicationSnapshot] = await Promise.all([
        transaction.get(homeRef),
        transaction.get(releaseRef),
        transaction.get(publicationRef),
      ]);
      authorizeHome(home, principal, homeId);
      if (!releaseSnapshot.exists) throw apiError('invalid_artifact');
      const release = validateRelease(releaseSnapshot, homeId);
      this.#assertReleaseUrl(release);
      if (!publicationSnapshot.exists) throw apiError('temporarily_unavailable');
      validateArtifactPublication(publicationSnapshot, sha256, release.publicUrl);
      return releaseRepresentation(release);
    });
  }

  async activateRelease(
    principal: ComponentPublisherPrincipal,
    homeId: string,
    input: ComponentActivationInput,
  ): Promise<ComponentPointerRepresentation> {
    if (!HOME_ID_PATTERN.test(homeId)
      || !canonicalBase64url(input.sha256, 32)
      || !Number.isSafeInteger(input.expectedGeneration)
      || input.expectedGeneration < 0
      || !Number.isSafeInteger(input.generation)
      || input.generation <= input.expectedGeneration) {
      throw apiError('invalid_request');
    }
    const homeRef = this.#homeRef(homeId);
    const releaseRef = homeRef.collection('componentReleases').doc(input.sha256);
    const pointerRef = this.#firestore.collection('components').doc(homeId);
    const quarantineRef = this.#firestore.collection('componentQuarantine').doc(input.sha256);
    const publicationRef = this.#firestore.collection('componentArtifacts')
      .doc(`${input.sha256}.js`);
    return this.#firestore.runTransaction(async (transaction) => {
      const [home, releaseSnapshot, pointerSnapshot, quarantineSnapshot, publicationSnapshot] = await Promise.all([
        transaction.get(homeRef),
        transaction.get(releaseRef),
        transaction.get(pointerRef),
        transaction.get(quarantineRef),
        transaction.get(publicationRef),
      ]);
      authorizeHome(home, principal, homeId);
      if (!releaseSnapshot.exists) throw apiError('invalid_artifact');
      const release = validateRelease(releaseSnapshot, homeId);
      this.#assertReleaseUrl(release);
      if (!publicationSnapshot.exists) throw apiError('temporarily_unavailable');
      validateArtifactPublication(publicationSnapshot, input.sha256, release.publicUrl);
      if (quarantineSnapshot.exists) {
        const data = quarantineSnapshot.data();
        if (data === undefined
          || !exactKeys(data, ['schema', 'sha256', 'quarantined_at'])
          || data.schema !== QUARANTINE_SCHEMA
          || data.sha256 !== input.sha256) {
          throw apiError('temporarily_unavailable');
        }
        timestamp(data.quarantined_at);
        throw apiError('digest_quarantined');
      }
      const currentGeneration = pointerSnapshot.exists
        ? this.#pointerGeneration(pointerSnapshot, homeId)
        : 0;
      if (currentGeneration !== input.expectedGeneration) throw apiError('generation_conflict');
      const pointer: ComponentPointerRepresentation = Object.freeze({
        schema: POINTER_SCHEMA,
        home_id: homeId,
        generation: input.generation,
        ...release.input,
        url: release.publicUrl,
      });
      transaction.set(pointerRef, pointer);
      return pointer;
    });
  }

  async quarantineDigest(sha256: string): Promise<void> {
    if (!canonicalBase64url(sha256, 32)) throw apiError('invalid_request');
    await this.#firestore.collection('componentQuarantine').doc(sha256).set({
      schema: QUARANTINE_SCHEMA,
      sha256,
      quarantined_at: Timestamp.fromMillis(this.#clock.now()),
    });
  }

  async #createUploadTransaction(
    principal: ComponentPublisherPrincipal,
    homeId: string,
    uploadId: string,
    input: ComponentUploadInput,
    publisher: { readonly kind: ComponentPublisherPrincipal['kind']; readonly id: string },
    bound: string,
    verifier: string,
    createdAt: Timestamp,
    expiresAt: Timestamp,
  ): Promise<void> {
    const homeRef = this.#homeRef(homeId);
    const uploadRef = homeRef.collection('componentUploads').doc(uploadId);
    const indexRef = this.#firestore.collection('componentUploadIndex').doc(uploadId);
    await this.#firestore.runTransaction(async (transaction) => {
      const [home, uploadSnapshot, indexSnapshot] = await Promise.all([
        transaction.get(homeRef),
        transaction.get(uploadRef),
        transaction.get(indexRef),
      ]);
      authorizeHome(home, principal, homeId);
      if (uploadSnapshot.exists || indexSnapshot.exists) {
        if (!uploadSnapshot.exists || !indexSnapshot.exists) throw new IdentifierCollision();
        const existing = validateUpload(uploadSnapshot, homeId);
        validateUploadIndex(indexSnapshot, existing);
        if (existing.status === 'awaiting_upload'
          && sameInput(existing.input, input)
          && existing.publisherKind === publisher.kind
          && existing.publisherId === publisher.id
          && existing.bindingId === bound
          && existing.capabilityVerifier === verifier
          && existing.capabilityKeyVersion === this.#config.componentKeyVersion
          && existing.createdAt.isEqual(createdAt)
          && existing.expiresAt.isEqual(expiresAt)) {
          return;
        }
        throw new IdentifierCollision();
      }
      const record = {
        schema: UPLOAD_SCHEMA,
        upload_id: uploadId,
        home_id: homeId,
        release: input.release,
        abi: input.abi,
        sha256: input.sha256,
        size: input.size,
        requires: input.requires,
        publisher_kind: publisher.kind,
        publisher_id: publisher.id,
        binding_id: bound,
        capability_verifier: verifier,
        capability_key_version: this.#config.componentKeyVersion,
        status: 'awaiting_upload',
        created_at: createdAt,
        expires_at: expiresAt,
        consumed_at: null,
        delivered_at: null,
        finalized_at: null,
      };
      transaction.create(uploadRef, record);
      transaction.create(indexRef, {
        schema: UPLOAD_INDEX_SCHEMA,
        upload_id: uploadId,
        home_id: homeId,
        status: 'awaiting_upload',
        created_at: createdAt,
      });
    });
  }

  async #reserveDelivery(uploadId: string, uploadToken: string): Promise<string> {
    const indexRef = this.#firestore.collection('componentUploadIndex').doc(uploadId);
    const now = Timestamp.fromMillis(this.#clock.now());
    return this.#firestore.runTransaction(async (transaction) => {
      const indexSnapshot = await transaction.get(indexRef);
      if (!indexSnapshot.exists || indexSnapshot.get('upload_id') !== uploadId) {
        throw apiError('invalid_upload_capability');
      }
      const homeId = indexSnapshot.get('home_id');
      if (typeof homeId !== 'string' || !HOME_ID_PATTERN.test(homeId)) {
        throw apiError('invalid_upload_capability');
      }
      const uploadRef = this.#homeRef(homeId).collection('componentUploads').doc(uploadId);
      const uploadSnapshot = await transaction.get(uploadRef);
      if (!uploadSnapshot.exists) throw apiError('invalid_upload_capability');
      const upload = validateUpload(uploadSnapshot, homeId);
      validateUploadIndex(indexSnapshot, upload);
      if (upload.status !== 'awaiting_upload'
        || upload.createdAt.toMillis() > now.toMillis()
        || upload.expiresAt.toMillis() <= now.toMillis()
        || !this.#capabilityMatches(uploadId, uploadToken, upload)) {
        throw apiError('invalid_upload_capability');
      }
      transaction.update(uploadRef, {
        status: 'delivery_reserved',
        consumed_at: now,
      });
      transaction.update(indexRef, { status: 'delivery_reserved' });
      return homeId;
    });
  }

  async #markDelivered(uploadId: string, homeId: string): Promise<void> {
    const uploadRef = this.#homeRef(homeId).collection('componentUploads').doc(uploadId);
    const indexRef = this.#firestore.collection('componentUploadIndex').doc(uploadId);
    const now = Timestamp.fromMillis(this.#clock.now());
    await this.#firestore.runTransaction(async (transaction) => {
      const [uploadSnapshot, indexSnapshot] = await Promise.all([
        transaction.get(uploadRef),
        transaction.get(indexRef),
      ]);
      if (!uploadSnapshot.exists || !indexSnapshot.exists) throw apiError('temporarily_unavailable');
      const upload = validateUpload(uploadSnapshot, homeId);
      validateUploadIndex(indexSnapshot, upload);
      if (upload.status === 'delivered' || upload.status === 'finalized') return;
      if (upload.status !== 'delivery_reserved') throw apiError('temporarily_unavailable');
      transaction.update(uploadRef, { status: 'delivered', delivered_at: now });
      transaction.update(indexRef, { status: 'delivered' });
    });
  }

  async #authorizedUpload(
    principal: ComponentPublisherPrincipal,
    homeId: string,
    uploadId: string,
  ): Promise<ValidatedUpload> {
    if (!HOME_ID_PATTERN.test(homeId) || !canonicalBase64url(uploadId, 16)) {
      throw apiError('invalid_artifact');
    }
    const homeRef = this.#homeRef(homeId);
    const uploadRef = homeRef.collection('componentUploads').doc(uploadId);
    return this.#firestore.runTransaction(async (transaction) => {
      const [home, uploadSnapshot] = await Promise.all([
        transaction.get(homeRef),
        transaction.get(uploadRef),
      ]);
      const publisher = authorizeHome(home, principal, homeId);
      if (!uploadSnapshot.exists) throw apiError('invalid_artifact');
      const upload = validateUpload(uploadSnapshot, homeId);
      if (!publisherMatches(upload, publisher)) throw apiError('publisher_mismatch');
      return upload;
    });
  }

  async #commitFinalization(
    principal: ComponentPublisherPrincipal,
    upload: ValidatedUpload,
    publicUrl: string,
  ): Promise<ComponentReleaseRepresentation> {
    if (publicUrl !== this.#artifactUrl(upload.input.sha256)) {
      throw apiError('temporarily_unavailable');
    }
    const homeRef = this.#homeRef(upload.homeId);
    const uploadRef = homeRef.collection('componentUploads').doc(upload.uploadId);
    const indexRef = this.#firestore.collection('componentUploadIndex').doc(upload.uploadId);
    const releaseRef = homeRef.collection('componentReleases').doc(upload.input.sha256);
    const publicationRef = this.#firestore.collection('componentArtifacts')
      .doc(`${upload.input.sha256}.js`);
    const finalizedAt = Timestamp.fromMillis(this.#clock.now());
    return this.#firestore.runTransaction(async (transaction) => {
      const [home, uploadSnapshot, indexSnapshot, releaseSnapshot, publicationSnapshot] = await Promise.all([
        transaction.get(homeRef),
        transaction.get(uploadRef),
        transaction.get(indexRef),
        transaction.get(releaseRef),
        transaction.get(publicationRef),
      ]);
      const publisher = authorizeHome(home, principal, upload.homeId);
      if (!uploadSnapshot.exists || !indexSnapshot.exists) throw apiError('invalid_artifact');
      const current = validateUpload(uploadSnapshot, upload.homeId);
      validateUploadIndex(indexSnapshot, current);
      if (!publisherMatches(current, publisher)) throw apiError('publisher_mismatch');
      if (!sameInput(current.input, upload.input)
        || current.bindingId !== upload.bindingId
        || current.status === 'awaiting_upload') {
        throw apiError('invalid_artifact');
      }
      if (publicationSnapshot.exists) {
        validateArtifactPublication(publicationSnapshot, current.input.sha256, publicUrl);
      } else {
        transaction.create(publicationRef, {
          schema: ARTIFACT_PUBLICATION_SCHEMA,
          artifact: `${current.input.sha256}.js`,
          sha256: current.input.sha256,
          public_url: publicUrl,
          published_at: finalizedAt,
        });
      }
      if (releaseSnapshot.exists) {
        const existing = validateRelease(releaseSnapshot, upload.homeId);
        this.#assertReleaseUrl(existing);
        if (existing.bindingId !== current.bindingId || existing.publicUrl !== publicUrl) {
          throw apiError('invalid_artifact');
        }
        if (current.status !== 'finalized') {
          transaction.update(uploadRef, {
            status: 'finalized',
            delivered_at: current.deliveredAt ?? finalizedAt,
            finalized_at: finalizedAt,
          });
          transaction.update(indexRef, { status: 'finalized' });
        }
        return releaseRepresentation(existing);
      }
      const record = {
        schema: RELEASE_SCHEMA,
        home_id: upload.homeId,
        release: current.input.release,
        abi: current.input.abi,
        sha256: current.input.sha256,
        size: current.input.size,
        requires: current.input.requires,
        publisher_kind: current.publisherKind,
        publisher_id: current.publisherId,
        binding_id: current.bindingId,
        public_url: publicUrl,
        finalized_at: finalizedAt,
      };
      transaction.create(releaseRef, record);
      transaction.update(uploadRef, {
        status: 'finalized',
        delivered_at: current.deliveredAt ?? finalizedAt,
        finalized_at: finalizedAt,
      });
      transaction.update(indexRef, { status: 'finalized' });
      return releaseRepresentation(validateReleaseData(releaseRef, record));
    });
  }

  #pointerGeneration(snapshot: DocumentSnapshot, homeId: string): number {
    const data = snapshot.data();
    if (data === undefined
      || !exactKeys(data, [
        'schema', 'home_id', 'generation', 'release', 'abi', 'url', 'sha256', 'size', 'requires',
      ])
      || data.schema !== POINTER_SCHEMA
      || data.home_id !== homeId
      || !Number.isSafeInteger(data.generation)
      || data.generation <= 0
      || !boundedRelease(data.release)
      || data.abi !== COMPONENT_ABI
      || typeof data.url !== 'string'
      || !canonicalBase64url(data.sha256, 32)
      || !Number.isSafeInteger(data.size)
      || data.size <= 0
      || data.size > MAX_COMPONENT_ARTIFACT_BYTES) {
      throw apiError('temporarily_unavailable');
    }
    storedRequirements(data.requires);
    return data.generation as number;
  }

  #capabilityVerifier(uploadId: string, uploadToken: string, version: string): string {
    return createHmac('sha256', this.#capabilityKey(version))
      .update('miakapp.component-upload-capability/1\0', 'utf8')
      .update(uploadId, 'ascii')
      .update('\0', 'ascii')
      .update(uploadToken, 'ascii')
      .digest('base64url');
  }

  #capabilityMatches(uploadId: string, uploadToken: string, upload: ValidatedUpload): boolean {
    let calculated: Buffer;
    let expected: Buffer;
    try {
      calculated = Buffer.from(
        this.#capabilityVerifier(uploadId, uploadToken, upload.capabilityKeyVersion),
        'base64url',
      );
      expected = Buffer.from(upload.capabilityVerifier, 'base64url');
    } catch {
      return false;
    }
    return calculated.byteLength === expected.byteLength && timingSafeEqual(calculated, expected);
  }

  #capabilityKey(version: string): Uint8Array {
    const key = this.#config.componentHmacKeyForVersion(version);
    if (key === undefined || key.byteLength !== 32) throw apiError('temporarily_unavailable');
    return key;
  }

  #validatedBaseUrl(value: string, kind: 'upload' | 'artifact'): string {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new Error(`Component ${kind} base URL is invalid`);
    }
    if (url.protocol !== 'https:'
      || url.username
      || url.password
      || url.search
      || url.hash
      || url.pathname.endsWith('/')) {
      throw new Error(`Component ${kind} base URL is invalid`);
    }
    return url.href;
  }

  #assertReleaseUrl(release: ValidatedRelease): void {
    if (release.publicUrl !== this.#artifactUrl(release.input.sha256)) {
      throw apiError('temporarily_unavailable');
    }
  }

  #artifactUrl(sha256: string): string {
    return `${this.#artifactBaseUrl}/${sha256}.js`;
  }

  #homeRef(homeId: string): DocumentReference {
    return this.#firestore.collection('controlHomes').doc(homeId);
  }
}

function validateReleaseData(
  reference: DocumentReference,
  data: DocumentData,
): ValidatedRelease {
  return validateRelease({
    id: reference.id,
    exists: true,
    data: () => data,
  } as DocumentSnapshot, data.home_id as string);
}
