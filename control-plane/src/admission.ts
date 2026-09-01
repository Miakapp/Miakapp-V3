import { createHmac } from 'node:crypto';

import {
  Firestore,
  Timestamp,
  type DocumentData,
  type DocumentReference,
  type DocumentSnapshot,
  type Transaction,
} from 'firebase-admin/firestore';

import { API_ERROR_CODES, ApiError, apiError, type ApiErrorCode } from './errors.js';
import { randomIdentifier } from './crypto.js';
import {
  ADMISSION_BUDGETS,
  ADMISSION_OPERATIONS,
  HOME_ID_PATTERN,
  IDENTIFIER_PATTERN,
  type AdmissionBudget,
  type AdmissionOperation,
  type AdmissionProfile,
  type Clock,
  type DeploymentConfig,
} from './types.js';

export const ADMISSION_BUCKET_COLLECTION = 'controlAdmissionBuckets';
export const AUDIT_COLLECTION = 'controlAudit';
export const ADMISSION_STATE_COLLECTION = 'controlAdmissionState';

const AUDIT_STATE_DOCUMENT = 'audit';
const MAX_SUBJECT_BYTES = 4_096;
const MAX_CHARGES = ADMISSION_BUDGETS.length;
const MAX_PROFILE_INTERVAL_MILLISECONDS = 31 * 24 * 60 * 60 * 1_000;
const BUCKET_KEYS = Object.freeze([
  'schema',
  'slot',
  'budget',
  'subject_fingerprint',
  'fingerprint_key_version',
  'window_start',
  'window_end',
  'used',
  'limit',
  'saturation_event_id',
  'updated_at',
  'expires_at',
]);
const AUDIT_STATE_KEYS = Object.freeze(['schema', 'next_slot', 'updated_at']);
const AUDIT_KEYS = Object.freeze([
  'schema',
  'event_id',
  'request_id',
  'operation',
  'status',
  'outcome_code',
  'home_id',
  'actor_kind',
  'actor_fingerprint',
  'subject_fingerprint',
  'network_fingerprint',
  'audit_key_version',
  'network_key_version',
  'consumed_budgets',
  'created_at',
  'updated_at',
  'expires_at',
]);

export type AuditActorKind =
  | 'anonymous'
  | 'firebase_user'
  | 'home_key'
  | 'access_token'
  | 'upload_capability';

export type AuditOutcome = 'ok' | 'denied' | 'outcome_unknown';

export interface AdmissionCharge {
  readonly budget: AdmissionBudget;
  readonly subject: string;
  readonly units?: number;
  readonly key?: 'audit' | 'network';
}

export interface AdmissionOpenInput {
  readonly requestId: string;
  readonly operation: AdmissionOperation;
  readonly source: string;
}

interface Fingerprint {
  readonly full: string;
  readonly short: string;
  readonly version: string;
}

interface NormalizedCharge {
  readonly budget: AdmissionBudget;
  readonly fingerprint: Fingerprint;
  readonly units: number;
  readonly slot: number;
  readonly documentId: string;
}

interface BucketEvaluation {
  readonly charge: NormalizedCharge;
  readonly reference: DocumentReference;
  readonly data: DocumentData;
  readonly denied: boolean;
  readonly retryAfterSeconds: number;
  readonly canMarkSaturation: boolean;
}

interface AllocatedAudit {
  readonly eventId: string;
  readonly slotId: string;
  readonly reference: DocumentReference;
}

interface OpenResult {
  readonly ticket: AdmissionTicket | null;
  readonly retryAfterSeconds: number | null;
}

function exactKeys(data: DocumentData, keys: readonly string[]): void {
  const actual = Object.keys(data).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((entry, index) => entry !== expected[index])) {
    throw apiError('temporarily_unavailable');
  }
}

function safeInteger(value: unknown, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw apiError('temporarily_unavailable');
  }
  return value as number;
}

function storedTimestamp(value: unknown): Timestamp {
  if (!(value instanceof Timestamp)) throw apiError('temporarily_unavailable');
  return value;
}

function canonicalFingerprint(value: unknown, bytes: 16 | 32): value is string {
  if (typeof value !== 'string') return false;
  const decoded = Buffer.from(value, 'base64url');
  return decoded.byteLength === bytes && decoded.toString('base64url') === value;
}

function boundedVersion(value: unknown): value is string {
  return typeof value === 'string'
    && Buffer.byteLength(value, 'utf8') >= 1
    && Buffer.byteLength(value, 'utf8') <= 64
    && !/\p{Cc}/u.test(value);
}

function boundedString(value: string, label: string): string {
  const length = Buffer.byteLength(value, 'utf8');
  if (length === 0 || length > MAX_SUBJECT_BYTES || /\p{Cc}/u.test(value)) {
    throw new TypeError(`${label} must be a bounded printable string`);
  }
  return value;
}

function checkedProfile(profile: AdmissionProfile): AdmissionProfile {
  if (!Number.isSafeInteger(profile.auditSlots)
    || profile.auditSlots < 64
    || profile.auditSlots > 65_536
    || !Number.isSafeInteger(profile.bucketSlots)
    || profile.bucketSlots < 256
    || profile.bucketSlots > 65_536
    || !Number.isSafeInteger(profile.maximumAuditEventBytes)
    || profile.maximumAuditEventBytes < 512
    || profile.maximumAuditEventBytes > 4_096
    || !Number.isSafeInteger(profile.auditRetentionMilliseconds)
    || profile.auditRetentionMilliseconds < 60_000
    || profile.auditRetentionMilliseconds > MAX_PROFILE_INTERVAL_MILLISECONDS
    || !Number.isSafeInteger(profile.bucketRetentionMilliseconds)
    || profile.bucketRetentionMilliseconds < 60_000
    || profile.bucketRetentionMilliseconds > MAX_PROFILE_INTERVAL_MILLISECONDS
    || !Number.isSafeInteger(profile.maximumRetryAfterSeconds)
    || profile.maximumRetryAfterSeconds < 1
    || profile.maximumRetryAfterSeconds > 300) {
    throw new TypeError('Admission profile bounds are invalid');
  }
  const keys = Object.keys(profile.limits).sort();
  const expected = [...ADMISSION_BUDGETS].sort();
  if (keys.length !== expected.length || keys.some((entry, index) => entry !== expected[index])) {
    throw new TypeError('Admission profile must define every budget exactly once');
  }
  for (const budget of ADMISSION_BUDGETS) {
    const limit = profile.limits[budget];
    if (!Number.isSafeInteger(limit.maximum)
      || limit.maximum < 1
      || limit.maximum > 1_000_000_000
      || !Number.isSafeInteger(limit.windowMilliseconds)
      || limit.windowMilliseconds < 1_000
      || limit.windowMilliseconds > MAX_PROFILE_INTERVAL_MILLISECONDS
      || profile.bucketRetentionMilliseconds < limit.windowMilliseconds) {
      throw new TypeError(`Admission limit ${budget} is invalid`);
    }
  }
  return profile;
}

function keyMaterial(
  version: string,
  resolver: (requestedVersion: string) => Uint8Array | undefined,
  label: string,
): Buffer {
  const resolved = resolver(version);
  if (version.length === 0 || version.length > 64 || resolved === undefined || resolved.byteLength !== 32) {
    throw new TypeError(`${label} key configuration is invalid`);
  }
  return Buffer.from(resolved);
}

function retryAfter(now: number, boundary: number, maximum: number): number {
  return Math.max(1, Math.min(maximum, Math.ceil((boundary - now) / 1_000)));
}

function auditByteLength(data: DocumentData): number {
  return Buffer.byteLength(JSON.stringify(data, (_key, value: unknown) => (
    value instanceof Timestamp ? value.toDate().toISOString() : value
  )), 'utf8');
}

function assertAuditRecord(data: DocumentData): void {
  exactKeys(data, AUDIT_KEYS);
  if (data.schema !== 'miakapp.control-audit/1'
    || typeof data.event_id !== 'string'
    || !IDENTIFIER_PATTERN.test(data.event_id)
    || typeof data.request_id !== 'string'
    || !IDENTIFIER_PATTERN.test(data.request_id)
    || !ADMISSION_OPERATIONS.includes(data.operation as AdmissionOperation)
    || !['pending', 'ok', 'denied', 'outcome_unknown'].includes(data.status as string)
    || (data.outcome_code !== null && !API_ERROR_CODES.includes(data.outcome_code as ApiErrorCode))
    || (data.home_id !== null && (typeof data.home_id !== 'string' || !HOME_ID_PATTERN.test(data.home_id)))
    || !['anonymous', 'firebase_user', 'home_key', 'access_token', 'upload_capability']
      .includes(data.actor_kind as string)
    || (data.actor_fingerprint !== null && !canonicalFingerprint(data.actor_fingerprint, 16))
    || (data.subject_fingerprint !== null && !canonicalFingerprint(data.subject_fingerprint, 16))
    || !canonicalFingerprint(data.network_fingerprint, 16)
    || !boundedVersion(data.audit_key_version)
    || !boundedVersion(data.network_key_version)
    || !Array.isArray(data.consumed_budgets)
    || data.consumed_budgets.some((entry: unknown) => !ADMISSION_BUDGETS.includes(entry as AdmissionBudget))
    || new Set(data.consumed_budgets).size !== data.consumed_budgets.length) {
    throw apiError('temporarily_unavailable');
  }
  if ((data.status === 'pending' || data.status === 'ok') !== (data.outcome_code === null)
    || (data.actor_kind === 'anonymous') !== (data.actor_fingerprint === null)
    || (data.consumed_budgets as AdmissionBudget[]).some((entry, index, entries) => (
      index > 0 && (entries[index - 1] as string) >= entry
    ))) {
    throw apiError('temporarily_unavailable');
  }
  const createdAt = storedTimestamp(data.created_at).toMillis();
  const updatedAt = storedTimestamp(data.updated_at).toMillis();
  const expiresAt = storedTimestamp(data.expires_at).toMillis();
  if (createdAt > updatedAt || updatedAt >= expiresAt) throw apiError('temporarily_unavailable');
}

export class AdmissionController {
  readonly #auditKey: Buffer;
  readonly #clock: Clock;
  readonly #config: DeploymentConfig;
  readonly #firestore: Firestore;
  readonly #networkKey: Buffer;
  readonly #profile: AdmissionProfile;

  constructor(firestore: Firestore, config: DeploymentConfig, clock: Clock) {
    this.#firestore = firestore;
    this.#config = config;
    this.#clock = clock;
    this.#profile = checkedProfile(config.admissionProfile);
    this.#auditKey = keyMaterial(config.auditKeyVersion, config.auditHmacKeyForVersion, 'Audit');
    this.#networkKey = keyMaterial(config.networkKeyVersion, config.networkHmacKeyForVersion, 'Network');
  }

  async open(input: AdmissionOpenInput): Promise<AdmissionTicket> {
    if (!IDENTIFIER_PATTERN.test(input.requestId)
      || !ADMISSION_OPERATIONS.includes(input.operation)) {
      throw new TypeError('Admission request metadata is invalid');
    }
    const source = boundedString(input.source, 'Admission source');
    const eventId = randomIdentifier();
    const network = this.#fingerprint('network', 'source', source);
    const charges = this.#normalizeCharges([
      { budget: 'audit.events', subject: 'global' },
      { budget: 'source.operations', subject: source, key: 'network' },
    ]);
    const nowMilliseconds = this.#clock.now();
    const result = await this.#firestore.runTransaction(async (transaction): Promise<OpenResult> => {
      const evaluations = await this.#evaluate(transaction, charges, nowMilliseconds);
      const auditEvaluation = evaluations.find((entry) => entry.charge.budget === 'audit.events');
      if (auditEvaluation === undefined) throw apiError('temporarily_unavailable');
      const denial = evaluations.find((entry) => entry.denied);
      if (denial !== undefined) {
        const shouldAllocateAudit = !auditEvaluation.denied || auditEvaluation.canMarkSaturation;
        const allocated = shouldAllocateAudit
          ? await this.#allocateAudit(transaction, eventId, nowMilliseconds)
          : null;
        const retry = Math.max(...evaluations.filter((entry) => entry.denied)
          .map((entry) => entry.retryAfterSeconds));
        for (const evaluation of evaluations.filter((entry) => entry.denied && entry.canMarkSaturation)) {
          transaction.set(evaluation.reference, {
            ...evaluation.data,
            saturation_event_id: allocated?.eventId ?? eventId,
            updated_at: Timestamp.fromMillis(nowMilliseconds),
          });
        }
        if (allocated !== null) {
          const consumed = auditEvaluation.denied ? [] : ['audit.events'] satisfies AdmissionBudget[];
          if (!auditEvaluation.denied) this.#writeAllowedBucket(transaction, auditEvaluation, nowMilliseconds);
          this.#writeAudit(transaction, allocated, {
            requestId: input.requestId,
            operation: input.operation,
            status: 'denied',
            outcomeCode: 'rate_limited',
            networkFingerprint: network.short,
            consumedBudgets: consumed,
          }, nowMilliseconds);
        }
        return { ticket: null, retryAfterSeconds: retry };
      }
      const allocated = await this.#allocateAudit(transaction, eventId, nowMilliseconds);
      for (const evaluation of evaluations) this.#writeAllowedBucket(transaction, evaluation, nowMilliseconds);
      this.#writeAudit(transaction, allocated, {
        requestId: input.requestId,
        operation: input.operation,
        status: 'pending',
        outcomeCode: null,
        networkFingerprint: network.short,
        consumedBudgets: evaluations.map((entry) => entry.charge.budget).sort(),
      }, nowMilliseconds);
      return {
        ticket: new AdmissionTicket(this, allocated.slotId, eventId, input.operation, source),
        retryAfterSeconds: null,
      };
    });
    if (result.ticket === null) throw apiError('rate_limited', result.retryAfterSeconds);
    return result.ticket;
  }

  async consume(ticket: AdmissionTicket, charges: readonly AdmissionCharge[]): Promise<void> {
    ticket.assertActive(this);
    const normalized = this.#normalizeCharges(charges);
    const eventId = ticket.eventId;
    const nowMilliseconds = this.#clock.now();
    const denialRetry = await this.#firestore.runTransaction(async (transaction) => {
      const auditRef = this.#firestore.collection(AUDIT_COLLECTION).doc(ticket.slotId);
      const [auditSnapshot, evaluations] = await Promise.all([
        transaction.get(auditRef),
        this.#evaluate(transaction, normalized, nowMilliseconds),
      ]);
      const audit = auditSnapshot.data();
      if (!auditSnapshot.exists || audit === undefined) throw apiError('temporarily_unavailable');
      assertAuditRecord(audit);
      if (audit.event_id !== eventId || audit.status !== 'pending') throw apiError('temporarily_unavailable');
      const denial = evaluations.find((entry) => entry.denied);
      if (denial !== undefined) {
        for (const evaluation of evaluations.filter((entry) => entry.denied && entry.canMarkSaturation)) {
          transaction.set(evaluation.reference, {
            ...evaluation.data,
            saturation_event_id: eventId,
            updated_at: Timestamp.fromMillis(nowMilliseconds),
          });
        }
        return Math.max(...evaluations.filter((entry) => entry.denied)
          .map((entry) => entry.retryAfterSeconds));
      }
      for (const evaluation of evaluations) this.#writeAllowedBucket(transaction, evaluation, nowMilliseconds);
      const consumed = [...new Set([
        ...(audit.consumed_budgets as AdmissionBudget[]),
        ...evaluations.map((entry) => entry.charge.budget),
      ])].sort();
      const next = { ...audit, consumed_budgets: consumed, updated_at: Timestamp.fromMillis(nowMilliseconds) };
      if (auditByteLength(next) > this.#profile.maximumAuditEventBytes) {
        throw apiError('temporarily_unavailable');
      }
      transaction.set(auditRef, next);
      return null;
    });
    if (denialRetry !== null) throw apiError('rate_limited', denialRetry);
  }

  async finish(
    ticket: AdmissionTicket,
    outcome: AuditOutcome,
    outcomeCode: ApiErrorCode | null,
    context: Readonly<{
      actorKind: AuditActorKind;
      actorIdentifier: string | null;
      homeId: string | null;
      subjectIdentifier: string | null;
    }>,
  ): Promise<void> {
    ticket.assertActive(this);
    if ((outcome === 'ok' && outcomeCode !== null)
      || (outcome !== 'ok' && outcomeCode === null)) {
      throw new TypeError('Audit outcome metadata is inconsistent');
    }
    const actor = context.actorIdentifier === null
      ? null
      : this.#fingerprint('audit', `actor:${context.actorKind}`, context.actorIdentifier).short;
    const subject = context.subjectIdentifier === null
      ? null
      : this.#fingerprint('audit', 'subject', context.subjectIdentifier).short;
    const nowMilliseconds = this.#clock.now();
    const reference = this.#firestore.collection(AUDIT_COLLECTION).doc(ticket.slotId);
    await this.#firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      const data = snapshot.data();
      if (!snapshot.exists || data === undefined) throw apiError('temporarily_unavailable');
      assertAuditRecord(data);
      if (data.event_id !== ticket.eventId) throw apiError('temporarily_unavailable');
      if (data.status !== 'pending') {
        if (data.status === outcome && data.outcome_code === outcomeCode) return;
        throw apiError('temporarily_unavailable');
      }
      const next = {
        ...data,
        status: outcome,
        outcome_code: outcomeCode,
        home_id: context.homeId,
        actor_kind: context.actorKind,
        actor_fingerprint: actor,
        subject_fingerprint: subject,
        updated_at: Timestamp.fromMillis(nowMilliseconds),
      };
      if (auditByteLength(next) > this.#profile.maximumAuditEventBytes) {
        throw apiError('temporarily_unavailable');
      }
      transaction.set(reference, next);
    });
    ticket.markFinished();
  }

  #fingerprint(keyKind: 'audit' | 'network', domain: string, value: string): Fingerprint {
    const key = keyKind === 'audit' ? this.#auditKey : this.#networkKey;
    const version = keyKind === 'audit' ? this.#config.auditKeyVersion : this.#config.networkKeyVersion;
    const digest = createHmac('sha256', key)
      .update('miakapp-admission-v1\0', 'utf8')
      .update(domain, 'utf8')
      .update('\0', 'utf8')
      .update(value, 'utf8')
      .digest();
    return Object.freeze({
      full: digest.toString('base64url'),
      short: digest.subarray(0, 16).toString('base64url'),
      version,
    });
  }

  #normalizeCharges(charges: readonly AdmissionCharge[]): NormalizedCharge[] {
    if (charges.length === 0 || charges.length > MAX_CHARGES) {
      throw new TypeError('Admission charges are not bounded');
    }
    const consolidated = new Map<string, Omit<NormalizedCharge, 'slot' | 'documentId'>>();
    for (const charge of charges) {
      if (!ADMISSION_BUDGETS.includes(charge.budget)) throw new TypeError('Admission budget is invalid');
      const units = charge.units ?? 1;
      const limit = this.#profile.limits[charge.budget];
      if (!Number.isSafeInteger(units) || units < 1 || units > limit.maximum) {
        throw new TypeError('Admission charge units are invalid');
      }
      const subject = boundedString(charge.subject, 'Admission subject');
      const fingerprint = this.#fingerprint(charge.key ?? 'audit', `budget:${charge.budget}`, subject);
      const key = `${charge.budget}\0${fingerprint.version}\0${fingerprint.full}`;
      const previous = consolidated.get(key);
      const total = (previous?.units ?? 0) + units;
      if (!Number.isSafeInteger(total) || total > limit.maximum) {
        throw new TypeError('Consolidated admission charge exceeds its limit');
      }
      consolidated.set(key, { budget: charge.budget, fingerprint, units: total });
    }
    return [...consolidated.values()].map((charge) => {
      const hash = Buffer.from(charge.fingerprint.full, 'base64url');
      const slotsPerBudget = Math.floor(this.#profile.bucketSlots / ADMISSION_BUDGETS.length);
      const budgetPartition = ADMISSION_BUDGETS.indexOf(charge.budget) * slotsPerBudget;
      const slot = budgetPartition + (hash.readUInt32BE(0) % slotsPerBudget);
      return Object.freeze({
        ...charge,
        slot,
        documentId: slot.toString(16).padStart(4, '0'),
      });
    });
  }

  async #evaluate(
    transaction: Transaction,
    charges: readonly NormalizedCharge[],
    nowMilliseconds: number,
  ): Promise<BucketEvaluation[]> {
    const byDocument = new Map<string, NormalizedCharge>();
    for (const charge of charges) {
      const previous = byDocument.get(charge.documentId);
      if (previous !== undefined
        && (previous.budget !== charge.budget
          || previous.fingerprint.full !== charge.fingerprint.full
          || previous.fingerprint.version !== charge.fingerprint.version)) {
        return charges.map((entry) => ({
          charge: entry,
          reference: this.#firestore.collection(ADMISSION_BUCKET_COLLECTION).doc(entry.documentId),
          data: {},
          denied: true,
          retryAfterSeconds: this.#profile.maximumRetryAfterSeconds,
          canMarkSaturation: false,
        }));
      }
      byDocument.set(charge.documentId, charge);
    }
    const entries = [...byDocument.values()];
    const references = entries.map((charge) => (
      this.#firestore.collection(ADMISSION_BUCKET_COLLECTION).doc(charge.documentId)
    ));
    const snapshots = await Promise.all(references.map((reference) => transaction.get(reference)));
    return entries.map((charge, index) => this.#evaluateBucket(
      charge,
      references[index] as DocumentReference,
      snapshots[index] as DocumentSnapshot,
      nowMilliseconds,
    ));
  }

  #evaluateBucket(
    charge: NormalizedCharge,
    reference: DocumentReference,
    snapshot: DocumentSnapshot,
    nowMilliseconds: number,
  ): BucketEvaluation {
    const limit = this.#profile.limits[charge.budget];
    const windowStart = Math.floor(nowMilliseconds / limit.windowMilliseconds) * limit.windowMilliseconds;
    const windowEnd = windowStart + limit.windowMilliseconds;
    const fresh = {
      schema: 'miakapp.admission-bucket/1',
      slot: charge.slot,
      budget: charge.budget,
      subject_fingerprint: charge.fingerprint.full,
      fingerprint_key_version: charge.fingerprint.version,
      window_start: Timestamp.fromMillis(windowStart),
      window_end: Timestamp.fromMillis(windowEnd),
      used: 0,
      limit: limit.maximum,
      saturation_event_id: null,
      updated_at: Timestamp.fromMillis(nowMilliseconds),
      expires_at: Timestamp.fromMillis(windowEnd + this.#profile.bucketRetentionMilliseconds),
    };
    if (!snapshot.exists) {
      return {
        charge,
        reference,
        data: fresh,
        denied: false,
        retryAfterSeconds: 1,
        canMarkSaturation: false,
      };
    }
    const data = snapshot.data();
    if (data === undefined) throw apiError('temporarily_unavailable');
    exactKeys(data, BUCKET_KEYS);
    if (data.schema !== 'miakapp.admission-bucket/1'
      || data.slot !== charge.slot
      || typeof data.budget !== 'string'
      || !ADMISSION_BUDGETS.includes(data.budget as AdmissionBudget)
      || typeof data.subject_fingerprint !== 'string'
      || typeof data.fingerprint_key_version !== 'string'
      || (data.saturation_event_id !== null
        && (typeof data.saturation_event_id !== 'string'
          || !IDENTIFIER_PATTERN.test(data.saturation_event_id)))) {
      throw apiError('temporarily_unavailable');
    }
    const storedWindowStart = storedTimestamp(data.window_start).toMillis();
    const storedWindowEnd = storedTimestamp(data.window_end).toMillis();
    const storedUpdatedAt = storedTimestamp(data.updated_at).toMillis();
    const storedExpiresAt = storedTimestamp(data.expires_at).toMillis();
    const used = safeInteger(data.used, 0, 1_000_000_000);
    const storedLimit = safeInteger(data.limit, 1, 1_000_000_000);
    if (!canonicalFingerprint(data.subject_fingerprint, 32)
      || !boundedVersion(data.fingerprint_key_version)
      || storedWindowEnd <= storedWindowStart
      || storedWindowEnd - storedWindowStart > MAX_PROFILE_INTERVAL_MILLISECONDS
      || used > storedLimit
      || storedUpdatedAt < storedWindowStart
      || storedUpdatedAt >= storedWindowEnd
      || storedExpiresAt <= storedWindowEnd
      || storedExpiresAt - storedWindowEnd > MAX_PROFILE_INTERVAL_MILLISECONDS) {
      throw apiError('temporarily_unavailable');
    }
    if (storedWindowEnd <= nowMilliseconds) {
      return {
        charge,
        reference,
        data: fresh,
        denied: false,
        retryAfterSeconds: 1,
        canMarkSaturation: false,
      };
    }
    const storedProfile = this.#profile.limits[data.budget as AdmissionBudget];
    if (storedWindowStart % storedProfile.windowMilliseconds !== 0
      || storedWindowEnd - storedWindowStart !== storedProfile.windowMilliseconds
      || storedLimit !== storedProfile.maximum
      || storedExpiresAt !== storedWindowEnd + this.#profile.bucketRetentionMilliseconds) {
      throw apiError('temporarily_unavailable');
    }
    if (data.budget !== charge.budget
      || data.subject_fingerprint !== charge.fingerprint.full
      || data.fingerprint_key_version !== charge.fingerprint.version) {
      return {
        charge,
        reference,
        data,
        denied: true,
        retryAfterSeconds: retryAfter(nowMilliseconds, storedWindowEnd, this.#profile.maximumRetryAfterSeconds),
        canMarkSaturation: false,
      };
    }
    if (storedWindowStart !== windowStart || storedWindowEnd !== windowEnd || storedLimit !== limit.maximum) {
      throw apiError('temporarily_unavailable');
    }
    const denied = used + charge.units > limit.maximum;
    return {
      charge,
      reference,
      data,
      denied,
      retryAfterSeconds: retryAfter(nowMilliseconds, windowEnd, this.#profile.maximumRetryAfterSeconds),
      canMarkSaturation: denied && data.saturation_event_id === null,
    };
  }

  #writeAllowedBucket(
    transaction: Transaction,
    evaluation: BucketEvaluation,
    nowMilliseconds: number,
  ): void {
    transaction.set(evaluation.reference, {
      ...evaluation.data,
      used: (evaluation.data.used as number) + evaluation.charge.units,
      updated_at: Timestamp.fromMillis(nowMilliseconds),
    });
  }

  async #allocateAudit(
    transaction: Transaction,
    eventId: string,
    nowMilliseconds: number,
  ): Promise<AllocatedAudit> {
    const stateRef = this.#firestore.collection(ADMISSION_STATE_COLLECTION).doc(AUDIT_STATE_DOCUMENT);
    const stateSnapshot = await transaction.get(stateRef);
    let nextSlot = 0;
    if (stateSnapshot.exists) {
      const state = stateSnapshot.data();
      if (state === undefined) throw apiError('temporarily_unavailable');
      exactKeys(state, AUDIT_STATE_KEYS);
      if (state.schema !== 'miakapp.admission-state/1') throw apiError('temporarily_unavailable');
      nextSlot = safeInteger(state.next_slot, 0, this.#profile.auditSlots - 1);
      storedTimestamp(state.updated_at);
    }
    const slotId = nextSlot.toString(16).padStart(4, '0');
    const reference = this.#firestore.collection(AUDIT_COLLECTION).doc(slotId);
    const previous = await transaction.get(reference);
    if (previous.exists) {
      const data = previous.data();
      if (data === undefined) throw apiError('temporarily_unavailable');
      assertAuditRecord(data);
      if (data.status === 'pending' && storedTimestamp(data.expires_at).toMillis() > nowMilliseconds) {
        throw apiError('rate_limited', this.#profile.maximumRetryAfterSeconds);
      }
    }
    transaction.set(stateRef, {
      schema: 'miakapp.admission-state/1',
      next_slot: (nextSlot + 1) % this.#profile.auditSlots,
      updated_at: Timestamp.fromMillis(nowMilliseconds),
    });
    return { eventId, slotId, reference };
  }

  #writeAudit(
    transaction: Transaction,
    allocated: AllocatedAudit,
    input: Readonly<{
      requestId: string;
      operation: AdmissionOperation;
      status: 'pending' | 'denied';
      outcomeCode: ApiErrorCode | null;
      networkFingerprint: string;
      consumedBudgets: readonly AdmissionBudget[];
    }>,
    nowMilliseconds: number,
  ): void {
    const now = Timestamp.fromMillis(nowMilliseconds);
    const data = {
      schema: 'miakapp.control-audit/1',
      event_id: allocated.eventId,
      request_id: input.requestId,
      operation: input.operation,
      status: input.status,
      outcome_code: input.outcomeCode,
      home_id: null,
      actor_kind: 'anonymous',
      actor_fingerprint: null,
      subject_fingerprint: null,
      network_fingerprint: input.networkFingerprint,
      audit_key_version: this.#config.auditKeyVersion,
      network_key_version: this.#config.networkKeyVersion,
      consumed_budgets: [...input.consumedBudgets],
      created_at: now,
      updated_at: now,
      expires_at: Timestamp.fromMillis(nowMilliseconds + this.#profile.auditRetentionMilliseconds),
    };
    if (auditByteLength(data) > this.#profile.maximumAuditEventBytes) {
      throw apiError('temporarily_unavailable');
    }
    transaction.set(allocated.reference, data);
  }
}

export class AdmissionTicket {
  readonly eventId: string;
  readonly operation: AdmissionOperation;
  readonly slotId: string;
  #actorIdentifier: string | null = null;
  #actorKind: AuditActorKind = 'anonymous';
  #controller: AdmissionController;
  #finished = false;
  #homeId: string | null = null;
  #subjectIdentifier: string | null = null;
  readonly #source: string;

  constructor(
    controller: AdmissionController,
    slotId: string,
    eventId: string,
    operation: AdmissionOperation,
    source: string,
  ) {
    this.#controller = controller;
    this.slotId = slotId;
    this.eventId = eventId;
    this.operation = operation;
    this.#source = source;
  }

  identifyActor(kind: Exclude<AuditActorKind, 'anonymous'>, identifier: string): void {
    this.#assertNotFinished();
    this.#actorKind = kind;
    this.#actorIdentifier = boundedString(identifier, 'Audit actor');
  }

  identifyHome(homeId: string): void {
    this.#assertNotFinished();
    if (!HOME_ID_PATTERN.test(homeId)) throw new TypeError('Audit home ID is invalid');
    this.#homeId = homeId;
  }

  identifySubject(identifier: string): void {
    this.#assertNotFinished();
    this.#subjectIdentifier = boundedString(identifier, 'Audit subject');
  }

  consume(
    charges: readonly AdmissionCharge[],
    sourceBudgets: readonly AdmissionBudget[] = [],
  ): Promise<void> {
    this.#assertNotFinished();
    return this.#controller.consume(this, [
      ...charges,
      ...sourceBudgets.map((budget) => ({
        budget,
        subject: this.#source,
        key: 'network' as const,
      })),
    ]);
  }

  consumeSource(budget: AdmissionBudget, units = 1): Promise<void> {
    return this.consume([{ budget, subject: this.#source, units, key: 'network' }]);
  }

  async finish(outcome: AuditOutcome, outcomeCode: ApiErrorCode | null = null): Promise<void> {
    this.#assertNotFinished();
    await this.#controller.finish(this, outcome, outcomeCode, {
      actorKind: this.#actorKind,
      actorIdentifier: this.#actorIdentifier,
      homeId: this.#homeId,
      subjectIdentifier: this.#subjectIdentifier,
    });
  }

  assertActive(controller: AdmissionController): void {
    if (controller !== this.#controller || this.#finished) throw new TypeError('Admission ticket is not active');
  }

  markFinished(): void {
    this.#finished = true;
  }

  #assertNotFinished(): void {
    if (this.#finished) throw new TypeError('Admission ticket is already finished');
  }
}

export function auditOutcomeFor(error: unknown): Readonly<{
  outcome: Exclude<AuditOutcome, 'ok'>;
  code: ApiErrorCode;
}> {
  if (error instanceof ApiError && error.code !== 'temporarily_unavailable') {
    return { outcome: 'denied', code: error.code };
  }
  return { outcome: 'outcome_unknown', code: 'temporarily_unavailable' };
}
