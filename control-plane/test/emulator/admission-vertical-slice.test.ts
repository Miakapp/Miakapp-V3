import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { once } from 'node:events';

import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import {
  assertFails,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';

import {
  ADMISSION_BUCKET_COLLECTION,
  ADMISSION_STATE_COLLECTION,
  AUDIT_COLLECTION,
  AdmissionController,
  type AdmissionTicket,
} from '../../src/admission.js';
import { createControlPlaneApp, type ApiDependencies } from '../../src/api.js';
import { loadEmulatorConfig } from '../../src/config.js';
import { HOME_KEY_PATTERN, type AdmissionBudget, type Clock, type DeploymentConfig } from '../../src/types.js';
import { ApiError } from '../../src/errors.js';
import { reserveAdmissionSubjects } from './admission-fixture.js';
import {
  FIRESTORE_HOST,
  PROJECT_ID,
  ALLOWED_ORIGIN,
  apiRequest,
  clearFirestore,
  jsonResponse,
  parseHost,
  signUp,
  type EmulatorUser,
} from './helpers.js';

interface ErrorResponse {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly retryable: boolean;
    readonly request_id: string;
  };
}

interface HomeKeyResponse {
  readonly home_key: string;
}

const admin = initializeApp({ projectId: PROJECT_ID }, 'control-plane-admission-emulator-tests');
const firestore = getFirestore(admin);
const baseConfig = loadEmulatorConfig({
  FUNCTIONS_EMULATOR: 'true',
  GCLOUD_PROJECT: PROJECT_ID,
} as NodeJS.ProcessEnv);
let owner: EmulatorUser;
let rules: RulesTestEnvironment | undefined;

function identifier(index: number): string {
  const bytes = Buffer.alloc(16);
  bytes.writeUInt32BE(index, 12);
  return bytes.toString('base64url');
}

function profileConfig(
  overrides: Partial<Record<AdmissionBudget, Readonly<{ maximum: number; windowMilliseconds: number }>>>,
): DeploymentConfig {
  return Object.freeze({
    ...baseConfig,
    admissionProfile: Object.freeze({
      ...baseConfig.admissionProfile,
      limits: Object.freeze({ ...baseConfig.admissionProfile.limits, ...overrides }),
    }),
  });
}

function clockAt(initial: number): Clock & { advance(milliseconds: number): void } {
  let now = initial;
  return Object.freeze({
    now: () => now,
    advance: (milliseconds: number) => { now += milliseconds; },
  });
}

async function openTickets(
  controller: AdmissionController,
  count: number,
  source = '192.0.2.1',
): Promise<AdmissionTicket[]> {
  const tickets: AdmissionTicket[] = [];
  for (let index = 1; index <= count; index += 1) {
    tickets.push(await controller.open({
      requestId: identifier(index),
      operation: 'home.create',
      source,
    }));
  }
  return tickets;
}

async function finishSettled(
  tickets: readonly AdmissionTicket[],
  settled: readonly PromiseSettledResult<void>[],
): Promise<void> {
  await Promise.all(settled.map((result, index) => {
    const ticket = tickets[index] as AdmissionTicket;
    return result.status === 'fulfilled'
      ? ticket.finish('ok')
      : ticket.finish('denied', (result.reason as ApiError).code);
  }));
}

beforeAll(async () => {
  owner = await signUp('admission-owner@example.test');
});

beforeEach(async () => {
  await clearFirestore(firestore);
});

afterAll(async () => {
  await rules?.cleanup();
  await deleteApp(admin);
});

describe('bounded control-plane admission and audit vertical slice', () => {
  test('atomically admits only the exact concurrent limit and records one saturation marker', async () => {
    const clock = clockAt(6_000_000);
    const controller = new AdmissionController(firestore, profileConfig({
      'home.create.actor': { maximum: 3, windowMilliseconds: 60_000 },
    }), clock);
    const tickets = await openTickets(controller, 8);
    const settled = await Promise.allSettled(tickets.map((ticket) => ticket.consume([{
      budget: 'home.create.actor',
      subject: 'synthetic-owner',
    }])));
    expect(settled.filter((result) => result.status === 'fulfilled')).toHaveLength(3);
    const rejected = settled.filter((result) => result.status === 'rejected');
    expect(rejected).toHaveLength(5);
    for (const result of rejected) {
      expect(result.reason).toMatchObject({ code: 'rate_limited', retryAfterSeconds: 60 });
    }
    await finishSettled(tickets, settled);

    const buckets = await firestore.collection(ADMISSION_BUCKET_COLLECTION).get();
    const actorBucket = buckets.docs.find((snapshot) => snapshot.get('budget') === 'home.create.actor');
    expect(actorBucket?.get('used')).toBe(3);
    expect(actorBucket?.get('saturation_event_id')).toMatch(/^[A-Za-z0-9_-]{22}$/);
    const audits = await firestore.collection(AUDIT_COLLECTION).get();
    expect(audits.docs.filter((snapshot) => snapshot.get('status') === 'ok')).toHaveLength(3);
    expect(audits.docs.filter((snapshot) => snapshot.get('status') === 'denied')).toHaveLength(5);
  }, 30_000);

  test('isolates subjects and resets the exact fixed window', async () => {
    const clock = clockAt(9_000_000);
    const controller = new AdmissionController(firestore, profileConfig({
      'home.create.actor': { maximum: 1, windowMilliseconds: 1_000 },
    }), clock);
    const [first, denied, independent] = await openTickets(controller, 3);
    await first?.consume([{ budget: 'home.create.actor', subject: 'owner-a' }]);
    await first?.finish('ok');
    await expect(denied?.consume([{ budget: 'home.create.actor', subject: 'owner-a' }]))
      .rejects.toMatchObject({ code: 'rate_limited', retryAfterSeconds: 1 });
    await denied?.finish('denied', 'rate_limited');
    await independent?.consume([{ budget: 'home.create.actor', subject: 'owner-b' }]);
    await independent?.finish('ok');

    clock.advance(1_000);
    const reset = (await openTickets(controller, 1, '192.0.2.2'))[0] as AdmissionTicket;
    await reset.consume([{ budget: 'home.create.actor', subject: 'owner-a' }]);
    await reset.finish('ok');

    const buckets = await firestore.collection(ADMISSION_BUCKET_COLLECTION).get();
    const actorBuckets = buckets.docs.filter((snapshot) => snapshot.get('budget') === 'home.create.actor');
    expect(actorBuckets).toHaveLength(2);
    expect(actorBuckets.map((snapshot) => snapshot.get('used')).sort()).toEqual([1, 1]);
  }, 30_000);

  test('coalesces audit saturation into one bounded marker', async () => {
    const clock = clockAt(12_000_000);
    const controller = new AdmissionController(firestore, profileConfig({
      'audit.events': { maximum: 2, windowMilliseconds: 60_000 },
    }), clock);
    const settled = await Promise.allSettled(Array.from({ length: 4 }, (_value, index) => (
      controller.open({
        requestId: identifier(index + 1),
        operation: 'home.create',
        source: '192.0.2.1',
      })
    )));
    const accepted = settled.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);
    const denied = settled.filter((result) => result.status === 'rejected');
    expect(accepted).toHaveLength(2);
    expect(denied).toHaveLength(2);
    for (const result of denied) {
      expect(result.reason).toMatchObject({ code: 'rate_limited', retryAfterSeconds: 60 });
    }
    await Promise.all(accepted.map((ticket) => ticket.finish('ok')));

    const audits = await firestore.collection(AUDIT_COLLECTION).get();
    expect(audits.size).toBe(3);
    expect(audits.docs.filter((snapshot) => snapshot.get('outcome_code') === 'rate_limited'))
      .toHaveLength(1);
    const auditBucket = (await firestore.collection(ADMISSION_BUCKET_COLLECTION).get())
      .docs.find((snapshot) => snapshot.get('budget') === 'audit.events');
    expect(auditBucket?.get('used')).toBe(2);
    expect(auditBucket?.get('saturation_event_id')).toBe(
      audits.docs.find((snapshot) => snapshot.get('outcome_code') === 'rate_limited')?.get('event_id'),
    );
  }, 30_000);

  test('charges byte budgets by exact units rather than request count', async () => {
    const clock = clockAt(15_000_000);
    const controller = new AdmissionController(firestore, profileConfig({
      'component.upload.issue_bytes.home': { maximum: 5, windowMilliseconds: 1_000 },
    }), clock);
    const tickets: AdmissionTicket[] = [];
    for (let index = 1; index <= 3; index += 1) {
      tickets.push(await controller.open({
        requestId: identifier(index),
        operation: 'component.upload.issue',
        source: '192.0.2.50',
      }));
    }
    await tickets[0]?.consume([{
      budget: 'component.upload.issue_bytes.home',
      subject: 'byte-home',
      units: 3,
    }]);
    await tickets[0]?.finish('ok');
    await tickets[1]?.consume([{
      budget: 'component.upload.issue_bytes.home',
      subject: 'byte-home',
      units: 2,
    }]);
    await tickets[1]?.finish('ok');
    const fullBucket = (await firestore.collection(ADMISSION_BUCKET_COLLECTION).get()).docs.find((snapshot) => (
      snapshot.get('budget') === 'component.upload.issue_bytes.home'
    ));
    expect(fullBucket?.get('used')).toBe(5);
    await expect(tickets[2]?.consume([{
      budget: 'component.upload.issue_bytes.home',
      subject: 'byte-home',
      units: 1,
    }])).rejects.toMatchObject({ code: 'rate_limited', retryAfterSeconds: 1 });
    await tickets[2]?.finish('denied', 'rate_limited');

    const bucket = (await firestore.collection(ADMISSION_BUCKET_COLLECTION).get()).docs.find((snapshot) => (
      snapshot.get('budget') === 'component.upload.issue_bytes.home'
    ));
    expect(bucket?.get('used')).toBe(5);
  }, 30_000);

  test('keeps early source-limit responses readable to an allowed browser origin', async () => {
    const clock = clockAt(18_000_000);
    const config = profileConfig({
      'source.operations': { maximum: 1, windowMilliseconds: 60_000 },
    });
    const controller = new AdmissionController(firestore, config, clock);
    const expressApp = createControlPlaneApp({
      admission: controller,
      clock,
      config,
    } as unknown as ApiDependencies);
    const server = expressApp.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('Local API did not bind');
    const url = `http://127.0.0.1:${address.port}/v1/access-tokens:exchange`;
    try {
      const request = {
        method: 'POST',
        headers: { Origin: ALLOWED_ORIGIN, Connection: 'close' },
      };
      const first = await fetch(url, request);
      expect(first.status).toBe(401);
      await first.text();
      const denied = await fetch(url, request);
      expect(denied.status).toBe(429);
      expect(denied.headers.get('Access-Control-Allow-Origin')).toBe(ALLOWED_ORIGIN);
      expect(denied.headers.get('Access-Control-Expose-Headers')).toBe('Retry-After');
      expect(denied.headers.get('Retry-After')).toBe('60');
      await denied.text();
    } finally {
      if (server.listening) {
        await new Promise<void>((resolve, reject) => {
          server.close((error) => {
            if (error === undefined || (error as NodeJS.ErrnoException).code === 'ERR_SERVER_NOT_RUNNING') {
              resolve();
            } else {
              reject(error);
            }
          });
        });
      }
    }
  }, 30_000);

  test('keeps syntactically valid but unverified credentials anonymous in audit', async () => {
    const keyId = identifier(100);
    const homeKey = `mhk1_${keyId}_${Buffer.alloc(32, 7).toString('base64url')}`;
    const malformed = await apiRequest('POST', '/v1/access-tokens:exchange', { homeKey });
    expect(malformed.status).toBe(400);
    const malformedError = await jsonResponse<ErrorResponse>(malformed);
    const malformedAudit = (await firestore.collection(AUDIT_COLLECTION).get()).docs.find((snapshot) => (
      snapshot.get('request_id') === malformedError.error.request_id
    ));
    expect(malformedAudit?.data()).toMatchObject({
      operation: 'access.exchange',
      status: 'denied',
      outcome_code: 'invalid_request',
      actor_kind: 'anonymous',
      actor_fingerprint: null,
      subject_fingerprint: expect.stringMatching(/^[A-Za-z0-9_-]{22}$/),
    });

    const uploadId = identifier(101);
    const uploadToken = Buffer.alloc(32, 8).toString('base64url');
    const invalidCapability = await apiRequest('PUT', `/v1/component-uploads/${uploadId}`, {
      accessToken: uploadToken,
      rawBytes: Buffer.from('self.component = {};', 'utf8'),
      contentType: 'application/javascript; charset=utf-8',
    });
    expect(invalidCapability.status).toBe(401);
    const capabilityError = await jsonResponse<ErrorResponse>(invalidCapability);
    const capabilityAudit = (await firestore.collection(AUDIT_COLLECTION).get()).docs.find((snapshot) => (
      snapshot.get('request_id') === capabilityError.error.request_id
    ));
    expect(capabilityAudit?.data()).toMatchObject({
      operation: 'component.upload.deliver',
      status: 'denied',
      outcome_code: 'invalid_upload_capability',
      actor_kind: 'anonymous',
      actor_fingerprint: null,
      subject_fingerprint: expect.stringMatching(/^[A-Za-z0-9_-]{22}$/),
    });
  }, 30_000);

  test('returns a correlated 429 before another Home Key reservation or signing effect', async () => {
    const home = await apiRequest('POST', '/v1/homes', {
      token: owner.idToken,
      body: {
        home_id: 'admission-home',
        name: 'Admission Home',
        icon: 'house',
        relay_url: 'wss://admission.example.test/ws',
      },
    });
    expect(home.status).toBe(201);
    const created = await apiRequest('POST', '/v1/homes/admission-home/home-keys', {
      token: owner.idToken,
      body: { label: 'Admission key', scopes: ['push:send'] },
    });
    expect(created.status).toBe(201);
    const homeKey = (await jsonResponse<HomeKeyResponse>(created)).home_key;
    const keyId = HOME_KEY_PATTERN.exec(homeKey)?.[1];
    if (keyId === undefined) throw new Error('Home Key response is malformed');

    const keyRef = firestore.collection('controlHomes').doc('admission-home')
      .collection('homeKeys').doc(keyId);
    let successfulExchanges = 0;
    let denied: Response | undefined;
    let beforeDenied: Awaited<ReturnType<typeof keyRef.get>> | undefined;
    for (let attempt = 0; attempt < 65; attempt += 1) {
      const beforeAttempt = await keyRef.get();
      const exchanged = await apiRequest('POST', '/v1/access-tokens:exchange', {
        homeKey,
        body: { purpose: 'push' },
      });
      if (exchanged.status === 429) {
        denied = exchanged;
        beforeDenied = beforeAttempt;
        break;
      }
      expect(exchanged.status).toBe(200);
      successfulExchanges += 1;
      await exchanged.arrayBuffer();
    }
    expect(successfulExchanges).toBeGreaterThanOrEqual(32);
    expect(successfulExchanges).toBeLessThanOrEqual(64);
    if (denied === undefined || beforeDenied === undefined) {
      throw new Error('The bounded exchange loop did not reach the fixed-window limit');
    }
    const lastIssuanceId = beforeDenied.get('last_issuance_id');
    const lastUsedAt = beforeDenied.get('last_used_at');

    expect(Number(denied.headers.get('retry-after'))).toBeGreaterThanOrEqual(1);
    expect(Number(denied.headers.get('retry-after'))).toBeLessThanOrEqual(300);
    const error = await jsonResponse<ErrorResponse>(denied);
    expect(error.error).toEqual({
      code: 'rate_limited',
      retryable: true,
      request_id: expect.stringMatching(/^[A-Za-z0-9_-]{22}$/),
      message: 'A rate limit was exceeded',
    });
    const after = await keyRef.get();
    expect(after.get('last_issuance_id')).toBe(lastIssuanceId);
    expect(after.get('last_used_at')).toEqual(lastUsedAt);

    const audit = (await firestore.collection(AUDIT_COLLECTION).get()).docs.find((snapshot) => (
      snapshot.get('request_id') === error.error.request_id
    ));
    expect(audit?.data()).toMatchObject({
      schema: 'miakapp.control-audit/1',
      operation: 'access.exchange',
      status: 'denied',
      outcome_code: 'rate_limited',
      actor_kind: 'anonymous',
      actor_fingerprint: null,
      subject_fingerprint: expect.stringMatching(/^[A-Za-z0-9_-]{22}$/),
      home_id: null,
    });
    expect(JSON.stringify(audit?.data())).not.toContain(homeKey);
    expect(JSON.stringify(audit?.data())).not.toContain(keyId);
  }, 30_000);

  test('enforces exact user-relay user and source ceilings before any signing effect', async () => {
    const clock = clockAt(21_000_000);
    const controller = new AdmissionController(firestore, baseConfig, clock);
    let signingEffects = 0;

    const reservedUser = (prefix: string): string => {
      for (let suffix = 1; suffix <= 1_000; suffix += 1) {
        const subject = `${prefix}-${suffix}`;
        if (reserveAdmissionSubjects([{
          budget: 'user_relay.exchange.user',
          subject,
        }])) return subject;
      }
      throw new Error(`Could not reserve a collision-free admission subject for ${prefix}`);
    };

    const attempt = async (index: number, userId: string, source: string): Promise<ApiError | null> => {
      const ticket = await controller.open({
        requestId: identifier(index),
        operation: 'user_relay.exchange',
        source,
      });
      try {
        await ticket.consume(
          [{ budget: 'user_relay.exchange.user', subject: userId }],
          ['user_relay.exchange.source'],
        );
        signingEffects += 1;
        await ticket.finish('ok');
        return null;
      } catch (error) {
        if (!(error instanceof ApiError)) throw error;
        await ticket.finish('denied', error.code);
        return error;
      }
    };

    const boundedUser = reservedUser('bounded-user');
    for (let index = 1; index <= 32; index += 1) {
      await expect(attempt(index, boundedUser, '198.51.100.10')).resolves.toBeNull();
    }
    const deniedUser = await attempt(33, boundedUser, '198.51.100.10');
    expect(deniedUser).toMatchObject({ code: 'rate_limited', retryAfterSeconds: 60 });
    expect(signingEffects).toBe(32);

    clock.advance(60_000);
    const sourceUsers = Array.from({ length: 5 }, (_value, index) => (
      reservedUser(`source-user-${index + 1}`)
    ));
    for (let index = 1; index <= 128; index += 1) {
      const sourceUser = sourceUsers[Math.floor((index - 1) / 32)] as string;
      await expect(attempt(100 + index, sourceUser, '203.0.113.10'))
        .resolves.toBeNull();
    }
    const deniedSource = await attempt(229, sourceUsers[4] as string, '203.0.113.10');
    expect(deniedSource).toMatchObject({ code: 'rate_limited', retryAfterSeconds: 60 });
    expect(signingEffects).toBe(160);

    const buckets = await firestore.collection(ADMISSION_BUCKET_COLLECTION).get();
    const userBuckets = buckets.docs.filter((snapshot) => (
      snapshot.get('budget') === 'user_relay.exchange.user'
    ));
    expect(userBuckets.some((snapshot) => snapshot.get('used') === 32)).toBe(true);
    const sourceBucket = buckets.docs.find((snapshot) => (
      snapshot.get('budget') === 'user_relay.exchange.source'
      && snapshot.get('used') === 128
    ));
    expect(sourceBucket).toBeDefined();
  }, 120_000);

  test('keeps every admission, audit, and ring-state document server-only', async () => {
    const host = parseHost(FIRESTORE_HOST);
    rules = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: {
        host: host.host,
        port: host.port,
        rules: readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8'),
      },
    });
    await Promise.all([
      firestore.collection(AUDIT_COLLECTION).doc('0000').set({ private: true }),
      firestore.collection(ADMISSION_BUCKET_COLLECTION).doc('0000').set({ private: true }),
      firestore.collection(ADMISSION_STATE_COLLECTION).doc('audit').set({ private: true }),
    ]);
    const client = rules.authenticatedContext(owner.userId).firestore();
    for (const path of [
      `${AUDIT_COLLECTION}/0000`,
      `${ADMISSION_BUCKET_COLLECTION}/0000`,
      `${ADMISSION_STATE_COLLECTION}/audit`,
    ]) {
      await assertFails(getDoc(doc(client, path)));
      await assertFails(setDoc(doc(client, path), { attacker: true }));
    }
  }, 30_000);
});
