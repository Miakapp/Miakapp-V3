import { describe, expect, test } from 'bun:test';
import { once } from 'node:events';
import type { Server } from 'node:http';

import express from 'express';
import type { DecodedIdToken } from 'firebase-admin/auth';

import type {
  AdmissionCharge,
  AdmissionOpenInput,
  AuditActorKind,
  AuditOutcome,
} from '../../src/admission.js';
import { createControlPlaneApp, type ApiDependencies } from '../../src/api.js';
import { SyntheticAppCheckVerifier } from '../../src/app-check.js';
import { loadEmulatorConfig } from '../../src/config.js';
import { AccessTokenSigner } from '../../src/crypto.js';
import { apiError, type ApiErrorCode } from '../../src/errors.js';
import { normalizePairingCode, pairingCodeLookup } from '../../src/pairing-code.js';
import { EMULATOR_PUSH_PROJECT_ID } from '../../src/push.js';
import {
  PAIRING_SCOPES,
  type AdmissionBudget,
  type FirebasePrincipal,
  type HomeRepresentation,
  type PairingCodeRepresentation,
  type PairingRedemption,
} from '../../src/types.js';

const NOW_SECONDS = 1_788_220_800;
const CLOCK = Object.freeze({ now: () => NOW_SECONDS * 1_000 });
const CONFIG = loadEmulatorConfig({
  FUNCTIONS_EMULATOR: 'true',
  GCLOUD_PROJECT: EMULATOR_PUSH_PROJECT_ID,
});
const PEPPER = CONFIG.homeKeyPepperForVersion(CONFIG.verifierKeyVersion) as Uint8Array;
const HOME_ID = 'synthetic-home';
const OWNER_TOKEN = 'synthetic-firebase-token-never-return';
const STALE_TOKEN = 'synthetic-stale-firebase-token';
const CODE = 'MIAK-01234-56789-ABCDE-FGHJK-MNPQR';
const LOOKUP = pairingCodeLookup(normalizePairingCode(CODE), PEPPER);
const HOME_KEY = `mhk1_${Buffer.alloc(16, 1).toString('base64url')}_${Buffer.alloc(32, 2).toString('base64url')}`;
const KEY_ID = Buffer.alloc(16, 1).toString('base64url');

function decoded(authTime: number): DecodedIdToken {
  return {
    aud: CONFIG.projectId,
    auth_time: authTime,
    exp: NOW_SECONDS + 3_600,
    firebase: { identities: {}, sign_in_provider: 'google.com' },
    iat: NOW_SECONDS - 60,
    iss: `https://securetoken.google.com/${CONFIG.projectId}`,
    sub: 'synthetic-owner',
    uid: 'synthetic-owner',
  };
}

const AUTH = Object.freeze({
  verifyIdToken: async (token: string): Promise<DecodedIdToken> => {
    if (token === OWNER_TOKEN) return decoded(NOW_SECONDS - 60);
    if (token === STALE_TOKEN) return decoded(NOW_SECONDS - 601);
    throw Object.assign(new Error('rejected'), { code: 'auth/invalid-id-token' });
  },
});

interface Consumption {
  readonly charges: readonly AdmissionCharge[];
  readonly sourceBudgets: readonly AdmissionBudget[];
}

class RecordingTicket {
  readonly consumed: Consumption[] = [];
  readonly finished: Array<{ outcome: AuditOutcome; code: ApiErrorCode | null }> = [];
  actor: { kind: string; identifier: string } | null = null;
  home: string | null = null;
  subject: string | null = null;

  constructor(readonly operation: AdmissionOpenInput['operation'], readonly limited: ReadonlySet<string>) {}

  identifyActor(kind: Exclude<AuditActorKind, 'anonymous'>, identifier: string): void {
    this.actor = { kind, identifier };
  }

  identifyHome(homeId: string): void {
    this.home = homeId;
  }

  identifySubject(identifier: string): void {
    this.subject = identifier;
  }

  async consume(charges: readonly AdmissionCharge[], sourceBudgets: readonly AdmissionBudget[] = []): Promise<void> {
    this.consumed.push({ charges: [...charges], sourceBudgets: [...sourceBudgets] });
    const budgets = [...charges.map((charge) => charge.budget), ...sourceBudgets];
    if (budgets.some((budget) => this.limited.has(budget))) throw apiError('rate_limited', 60);
  }

  async finish(outcome: AuditOutcome, code: ApiErrorCode | null = null): Promise<void> {
    this.finished.push({ outcome, code });
  }
}

class RecordingAdmission {
  readonly tickets: RecordingTicket[] = [];

  constructor(readonly limited: ReadonlySet<string> = new Set()) {}

  async open(input: AdmissionOpenInput): Promise<RecordingTicket> {
    const ticket = new RecordingTicket(input.operation, this.limited);
    this.tickets.push(ticket);
    return ticket;
  }
}

class FakeStore {
  readonly issued: Array<{ principal: FirebasePrincipal; homeId: string }> = [];
  readonly redeemed: Array<{ code: string; label: string }> = [];
  redeemFailure: ApiErrorCode | null = null;

  async listOwnedHomes(principal: FirebasePrincipal): Promise<HomeRepresentation[]> {
    expect(principal.userId).toBe('synthetic-owner');
    return [{
      home_id: HOME_ID,
      name: 'Synthetic Home',
      icon: 'house',
      relay_url: 'wss://relay.example.test/ws',
      created_at: '2026-08-31T12:00:00.000Z',
      updated_at: '2026-08-31T12:00:00.000Z',
    }];
  }

  async issuePairingCode(principal: FirebasePrincipal, homeId: string): Promise<PairingCodeRepresentation> {
    this.issued.push({ principal, homeId });
    return {
      schema: 'miakapp.pairing-code/1',
      code: CODE,
      home_id: homeId,
      access: 'full_home',
      scopes: PAIRING_SCOPES,
      expires_at: new Date(NOW_SECONDS * 1_000 + 600_000).toISOString(),
      redeem_endpoint: `${CONFIG.issuer}/v1/pairing/redeem`,
    };
  }

  async redeemPairingCode(code: string, label: string): Promise<PairingRedemption> {
    this.redeemed.push({ code, label });
    if (this.redeemFailure !== null) throw apiError(this.redeemFailure);
    return { home_key: HOME_KEY, home_id: HOME_ID, key_id: KEY_ID, issuer: CONFIG.issuer };
  }
}

function dependencies(store: FakeStore, admission: RecordingAdmission): ApiDependencies {
  return {
    admission,
    appCheck: new SyntheticAppCheckVerifier(CONFIG, CLOCK),
    auth: AUTH,
    clock: CLOCK,
    config: CONFIG,
    signer: new AccessTokenSigner(CONFIG),
    store,
    pushStore: {},
    pushTransport: {},
    componentStore: {},
  } as unknown as ApiDependencies;
}

interface Captured {
  readonly status: number;
  readonly headers: Headers;
  readonly text: string;
}

async function call(
  deps: ApiDependencies,
  method: string,
  path: string,
  options: { readonly body?: unknown; readonly headers?: Readonly<Record<string, string>> } = {},
): Promise<Captured> {
  const transport = express();
  transport.use(express.raw({
    limit: '2mb',
    type: () => true,
    verify: (incoming, _response, body) => {
      Object.defineProperty(incoming, 'rawBody', { configurable: true, value: Buffer.from(body) });
    },
  }));
  transport.use(createControlPlaneApp(deps));
  const server: Server = transport.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('Local API did not bind');
  try {
    const headers: Record<string, string> = { Connection: 'close', ...options.headers };
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
      method,
      headers,
      ...(options.body === undefined ? {} : {
        body: typeof options.body === 'string' ? options.body : JSON.stringify(options.body),
      }),
    });
    return { status: response.status, headers: response.headers, text: await response.text() };
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function expectPrivate(response: Captured): void {
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(response.headers.get('pragma')).toBe('no-cache');
  expect(response.headers.get('referrer-policy')).toBe('no-referrer');
}

function errorCode(response: Captured): string {
  return (JSON.parse(response.text) as { error: { code: string } }).error.code;
}

const OWNER = { Authorization: `Bearer ${OWNER_TOKEN}` };
const ISSUE_BODY = { access: 'full_home', confirmation: `grant-full-home-access:${HOME_ID}` };

describe('owner home listing', () => {
  test('lists the homes the authenticated account administers', async () => {
    const store = new FakeStore();
    const response = await call(dependencies(store, new RecordingAdmission()), 'GET', '/v1/homes', {
      headers: OWNER,
    });
    expect(response.status).toBe(200);
    expectPrivate(response);
    expect(JSON.parse(response.text)).toEqual({
      schema: 'miakapp.home-list/1',
      homes: [expect.objectContaining({ home_id: HOME_ID })],
    });
  });

  test('requires a Firebase identity', async () => {
    const response = await call(dependencies(new FakeStore(), new RecordingAdmission()), 'GET', '/v1/homes');
    expect(response.status).toBe(401);
    expect(errorCode(response)).toBe('invalid_firebase_token');
  });
});

describe('pairing-code issuance', () => {
  test('issues a code for an explicitly confirmed full-home grant', async () => {
    const store = new FakeStore();
    const admission = new RecordingAdmission();
    const response = await call(dependencies(store, admission), 'POST', `/v1/homes/${HOME_ID}/pairing-codes`, {
      headers: OWNER,
      body: ISSUE_BODY,
    });
    expect(response.status).toBe(201);
    expectPrivate(response);
    const body = JSON.parse(response.text) as PairingCodeRepresentation;
    expect(body).toMatchObject({
      schema: 'miakapp.pairing-code/1',
      code: CODE,
      home_id: HOME_ID,
      access: 'full_home',
      scopes: ['relay:coordinator', 'relay:cli', 'push:send', 'components:publish'],
      redeem_endpoint: `${CONFIG.issuer}/v1/pairing/redeem`,
    });
    expect(store.issued).toEqual([{ principal: expect.objectContaining({ userId: 'synthetic-owner' }), homeId: HOME_ID }]);
    const [ticket] = admission.tickets;
    expect(ticket?.operation).toBe('pairing.code.issue');
    expect(ticket?.consumed).toEqual([{
      charges: [{ budget: 'pairing.issue.actor', subject: 'synthetic-owner' }],
      sourceBudgets: ['pairing.issue.source'],
    }]);
    expect(ticket?.actor).toEqual({ kind: 'firebase_user', identifier: 'synthetic-owner' });
    expect(ticket?.home).toBe(HOME_ID);
    expect(ticket?.finished).toEqual([{ outcome: 'ok', code: null }]);
  });

  test('refuses a stale sign-in before spending any budget', async () => {
    const store = new FakeStore();
    const admission = new RecordingAdmission();
    const response = await call(dependencies(store, admission), 'POST', `/v1/homes/${HOME_ID}/pairing-codes`, {
      headers: { Authorization: `Bearer ${STALE_TOKEN}` },
      body: ISSUE_BODY,
    });
    expect(response.status).toBe(401);
    expect(errorCode(response)).toBe('recent_authentication_required');
    expect(store.issued).toHaveLength(0);
    expect(admission.tickets[0]?.consumed).toHaveLength(0);
  });

  test('requires the confirmation to name this exact home and access level', async () => {
    for (const body of [
      {},
      { access: 'full_home' },
      { access: 'full_home', confirmation: 'grant-full-home-access:other-home' },
      { access: 'read_only', confirmation: `grant-full-home-access:${HOME_ID}` },
      { ...ISSUE_BODY, scopes: ['push:send'] },
    ]) {
      const store = new FakeStore();
      const response = await call(
        dependencies(store, new RecordingAdmission()),
        'POST',
        `/v1/homes/${HOME_ID}/pairing-codes`,
        { headers: OWNER, body },
      );
      expect(response.status).toBe(400);
      expect(errorCode(response)).toBe('invalid_request');
      expect(store.issued).toHaveLength(0);
    }
  });

  test('stops at the per-account issuance budget', async () => {
    const store = new FakeStore();
    const response = await call(
      dependencies(store, new RecordingAdmission(new Set(['pairing.issue.actor']))),
      'POST',
      `/v1/homes/${HOME_ID}/pairing-codes`,
      { headers: OWNER, body: ISSUE_BODY },
    );
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('60');
    expect(store.issued).toHaveLength(0);
  });
});

describe('pairing-code redemption', () => {
  test('answers the fixed CLI contract and nothing more', async () => {
    const store = new FakeStore();
    const admission = new RecordingAdmission();
    const response = await call(dependencies(store, admission), 'POST', '/v1/pairing/redeem', {
      body: { code: CODE.toLowerCase(), label: 'Molted agent' },
    });
    expect(response.status).toBe(200);
    expectPrivate(response);
    expect(JSON.parse(response.text)).toEqual({
      home_key: HOME_KEY,
      home_id: HOME_ID,
      key_id: KEY_ID,
      issuer: CONFIG.issuer,
    });
    expect(store.redeemed).toEqual([{ code: CODE.toLowerCase(), label: 'Molted agent' }]);
    const [ticket] = admission.tickets;
    expect(ticket?.operation).toBe('pairing.redeem');
    // Source first, then the code itself, keyed only by its HMAC lookup.
    expect(ticket?.consumed).toEqual([
      { charges: [], sourceBudgets: ['pairing.redeem.source'] },
      { charges: [{ budget: 'pairing.redeem.code', subject: LOOKUP }], sourceBudgets: [] },
    ]);
    expect(ticket?.subject).toBe(LOOKUP);
    expect(ticket?.actor).toEqual({ kind: 'home_key', identifier: KEY_ID });
    expect(ticket?.home).toBe(HOME_ID);
  });

  test('charges a malformed guess like a wrong one and answers uniformly', async () => {
    const store = new FakeStore();
    const admission = new RecordingAdmission();
    const response = await call(dependencies(store, admission), 'POST', '/v1/pairing/redeem', {
      body: { code: 'not-a-code', label: 'Molted agent' },
    });
    expect(response.status).toBe(401);
    expectPrivate(response);
    expect(errorCode(response)).toBe('invalid_pairing_code');
    expect(store.redeemed).toHaveLength(0);
    expect(admission.tickets[0]?.consumed).toEqual([{ charges: [], sourceBudgets: ['pairing.redeem.source'] }]);
    expect(admission.tickets[0]?.finished).toEqual([{ outcome: 'denied', code: 'invalid_pairing_code' }]);

    store.redeemFailure = 'invalid_pairing_code';
    const wrong = await call(dependencies(store, new RecordingAdmission()), 'POST', '/v1/pairing/redeem', {
      body: { code: CODE, label: 'Molted agent' },
    });
    expect(wrong.status).toBe(401);
    expect(wrong.text.replace(/"request_id":"[^"]+"/, '')).toBe(response.text.replace(/"request_id":"[^"]+"/, ''));
  });

  test('refuses a guesser at the source budget before the code is judged', async () => {
    const store = new FakeStore();
    const response = await call(
      dependencies(store, new RecordingAdmission(new Set(['pairing.redeem.source']))),
      'POST',
      '/v1/pairing/redeem',
      { body: { code: CODE, label: 'Molted agent' } },
    );
    expect(response.status).toBe(429);
    expect(store.redeemed).toHaveLength(0);
  });

  test('accepts only the closed body and no second credential', async () => {
    const cases: Array<{ body: unknown; headers?: Record<string, string> }> = [
      { body: { code: CODE } },
      { body: { label: 'Molted agent' } },
      { body: { code: CODE, label: 'Molted agent', home_id: HOME_ID } },
      { body: { code: 1, label: 'Molted agent' } },
      { body: { code: CODE, label: '' } },
      { body: { code: CODE, label: 'x'.repeat(65) } },
      { body: { code: CODE, label: 'line\nbreak' } },
      { body: '{"code":"a","code":"b","label":"x"}' },
      { body: { code: CODE, label: 'Molted agent' }, headers: OWNER },
      { body: { code: CODE, label: 'Molted agent' }, headers: { 'X-Firebase-AppCheck': 'token' } },
    ];
    for (const entry of cases) {
      const store = new FakeStore();
      const response = await call(dependencies(store, new RecordingAdmission()), 'POST', '/v1/pairing/redeem', entry);
      expect(response.status).toBe(400);
      expect(errorCode(response)).toBe('invalid_request');
      expect(store.redeemed).toHaveLength(0);
    }
  });

  test('never echoes the code or the key in a failure', async () => {
    const store = new FakeStore();
    store.redeemFailure = 'temporarily_unavailable';
    const response = await call(dependencies(store, new RecordingAdmission()), 'POST', '/v1/pairing/redeem', {
      body: { code: CODE, label: 'Molted agent' },
    });
    expect(response.status).toBe(503);
    expect(response.text).not.toContain(normalizePairingCode(CODE));
    expect(response.text).not.toContain('MIAK');
    expect(response.text).not.toContain(HOME_KEY);
  });
});
