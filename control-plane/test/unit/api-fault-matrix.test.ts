import { describe, expect, test } from 'bun:test';
import { createPrivateKey, sign as signBytes, type JsonWebKey } from 'node:crypto';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import type { Server } from 'node:http';

import express from 'express';
import type { DecodedIdToken } from 'firebase-admin/auth';

import {
  type AdmissionCharge,
  type AdmissionOpenInput,
  type AuditActorKind,
  type AuditOutcome,
} from '../../src/admission.js';
import { createControlPlaneApp, type ApiDependencies } from '../../src/api.js';
import {
  FirebaseAdminAppCheckVerifier,
  SyntheticAppCheckVerifier,
} from '../../src/app-check.js';
import { FirebaseAdminAuthVerifier } from '../../src/auth.js';
import type { ComponentActivationInput } from '../../src/component-store.js';
import { loadEmulatorConfig } from '../../src/config.js';
import { AccessTokenSigner } from '../../src/crypto.js';
import { ApiError, type ApiErrorCode } from '../../src/errors.js';
import {
  EMULATOR_PUSH_PROJECT_ID,
  type ChallengePushDelivery,
  type SemanticNotificationPushDelivery,
} from '../../src/push.js';
import type { AccessTokenIssuer } from '../../src/store.js';
import {
  type AccessGrant,
  type AdmissionBudget,
  type AppCheckPrincipal,
  type ComponentPublisherPrincipal,
  type ExchangeRequest,
  type FirebasePrincipal,
  type PushAccessPrincipal,
} from '../../src/types.js';

const NOW_SECONDS = 1_788_220_800;
const CLOCK = Object.freeze({ now: () => NOW_SECONDS * 1_000 });
const ENVIRONMENT: NodeJS.ProcessEnv = {
  FUNCTIONS_EMULATOR: 'true',
  GCLOUD_PROJECT: EMULATOR_PUSH_PROJECT_ID,
};
const CONFIG = loadEmulatorConfig(ENVIRONMENT);
const REAL_SIGNER = new AccessTokenSigner(CONFIG);
const FIXTURE_URL = new URL(
  '../../../control-plane-contract/fixtures/v1/access-tokens.json',
  import.meta.url,
);

type RsaPrivateJwk = JsonWebKey & {
  readonly kty: 'RSA';
  readonly n: string;
  readonly e: string;
  readonly d: string;
  readonly kid: string;
};

interface SigningFixture {
  readonly test_only_private_keys: {
    readonly firebase: RsaPrivateJwk;
  };
}

interface FinishCall {
  readonly outcome: AuditOutcome;
  readonly outcomeCode: ApiErrorCode | null;
}

interface ErrorEnvelope {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly retryable: boolean;
    readonly request_id: string;
  };
}

interface CapturedResponse {
  readonly status: number;
  readonly headers: Headers;
  readonly text: string;
}

interface RouterRequest {
  readonly method: string;
  readonly path: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string | ArrayBuffer;
}

interface DependencyOverrides {
  readonly admission?: object;
  readonly appCheck?: object;
  readonly auth?: object;
  readonly signer?: object;
  readonly store?: object;
  readonly pushStore?: object;
  readonly pushTransport?: object;
  readonly componentStore?: object;
}

const signingFixture: SigningFixture = JSON.parse(readFileSync(FIXTURE_URL, 'utf8'));

function identifier(byte: number): string {
  return Buffer.alloc(16, byte).toString('base64url');
}

function secret(byte: number): string {
  return Buffer.alloc(32, byte).toString('base64url');
}

const HOME_ID = 'synthetic-home';
const OWNER_TOKEN = 'synthetic-firebase-token-never-return';
const OWNER_AUTHORIZATION = `Bearer ${OWNER_TOKEN}`;
const KEY_ID = identifier(1);
const HOME_KEY_SECRET = secret(2);
const HOME_KEY = `mhk1_${KEY_ID}_${HOME_KEY_SECRET}`;
const TOKEN_ID = identifier(3);
const CLIENT_ID = identifier(4);
const CHALLENGE_ID = identifier(5);
const CHALLENGE_SECRET = secret(6);
const GRANT_ID = identifier(7);
const DESTINATION_ID = identifier(8);
const UPLOAD_ID = identifier(9);
const UPLOAD_TOKEN = secret(10);
const COMPONENT_SHA256 = secret(11);
const FID = 'synthetic-firebase-installation-id';
const FAILURE_SENTINEL = 'private-dependency-failure-detail';
const ARTIFACT = Buffer.from('self.component = Object.freeze({});', 'utf8');

const ACCESS_GRANT: AccessGrant = Object.freeze({
  issuedAt: NOW_SECONDS,
  tokenId: TOKEN_ID,
  homeId: HOME_ID,
  clientId: CLIENT_ID,
  label: 'Synthetic key',
  scope: 'push:send',
  audience: CONFIG.pushAudience,
  role: null,
  coordinatorName: null,
});

function accessAuthorization(scope: 'push:send' | 'components:publish'): string {
  const grant: AccessGrant = Object.freeze({
    ...ACCESS_GRANT,
    scope,
    audience: scope === 'push:send' ? CONFIG.pushAudience : CONFIG.componentsAudience,
  });
  return `Bearer ${REAL_SIGNER.sign(grant).token}`;
}

const PUSH_AUTHORIZATION = accessAuthorization('push:send');
const COMPONENT_AUTHORIZATION = accessAuthorization('components:publish');

function signAppCheckToken(): string {
  const key = signingFixture.test_only_private_keys.firebase;
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: key.kid, typ: 'JWT' }), 'utf8')
    .toString('base64url');
  const claims = Buffer.from(JSON.stringify({
    iss: CONFIG.appCheckIssuer,
    sub: CONFIG.appCheckAppId,
    aud: [CONFIG.appCheckAudience],
    iat: NOW_SECONDS,
    exp: NOW_SECONDS + 3_600,
  }), 'utf8').toString('base64url');
  const signingInput = `${header}.${claims}`;
  const signature = signBytes(
    'RSA-SHA256',
    Buffer.from(signingInput, 'ascii'),
    createPrivateKey({ key, format: 'jwk' }),
  );
  return `${signingInput}.${signature.toString('base64url')}`;
}

const APP_CHECK_TOKEN = signAppCheckToken();
const SYNTHETIC_SECRETS = Object.freeze([
  OWNER_TOKEN,
  HOME_KEY,
  HOME_KEY_SECRET,
  APP_CHECK_TOKEN,
  PUSH_AUTHORIZATION.slice('Bearer '.length),
  COMPONENT_AUTHORIZATION.slice('Bearer '.length),
  UPLOAD_TOKEN,
  CHALLENGE_SECRET,
  signingFixture.test_only_private_keys.firebase.d,
  FAILURE_SENTINEL,
]);

function decodedOwner(): DecodedIdToken {
  return {
    aud: CONFIG.projectId,
    auth_time: NOW_SECONDS - 60,
    exp: NOW_SECONDS + 3_600,
    firebase: { identities: {}, sign_in_provider: 'password' },
    iat: NOW_SECONDS - 60,
    iss: `https://securetoken.google.com/${CONFIG.projectId}`,
    sub: 'synthetic-owner',
    uid: 'synthetic-owner',
  };
}

const OWNER_AUTH = Object.freeze({
  verifyIdToken: async (token: string): Promise<DecodedIdToken> => {
    if (token !== OWNER_TOKEN) throw new Error('Unexpected Firebase token');
    return decodedOwner();
  },
});

class RecordingTicket {
  readonly consumeCalls: Array<readonly AdmissionCharge[]> = [];
  readonly finishCalls: FinishCall[] = [];
  readonly operation: AdmissionOpenInput['operation'];
  readonly #finishFailure: unknown | null;

  constructor(operation: AdmissionOpenInput['operation'], finishFailure: unknown | null) {
    this.operation = operation;
    this.#finishFailure = finishFailure;
  }

  identifyActor(_kind: Exclude<AuditActorKind, 'anonymous'>, _identifier: string): void {}

  identifyHome(_homeId: string): void {}

  identifySubject(_identifier: string): void {}

  async consume(
    charges: readonly AdmissionCharge[],
    _sourceBudgets: readonly AdmissionBudget[] = [],
  ): Promise<void> {
    this.consumeCalls.push([...charges]);
  }

  async finish(outcome: AuditOutcome, outcomeCode: ApiErrorCode | null = null): Promise<void> {
    this.finishCalls.push(Object.freeze({ outcome, outcomeCode }));
    if (this.#finishFailure !== null) throw this.#finishFailure;
  }
}

class RecordingAdmission {
  readonly openCalls: AdmissionOpenInput[] = [];
  readonly tickets: RecordingTicket[] = [];
  readonly #openFailure: unknown | null;
  readonly #finishFailure: unknown | null;

  constructor(openFailure: unknown | null = null, finishFailure: unknown | null = null) {
    this.#openFailure = openFailure;
    this.#finishFailure = finishFailure;
  }

  async open(input: AdmissionOpenInput): Promise<RecordingTicket> {
    this.openCalls.push(input);
    if (this.#openFailure !== null) throw this.#openFailure;
    const ticket = new RecordingTicket(input.operation, this.#finishFailure);
    this.tickets.push(ticket);
    return ticket;
  }
}

function dependencies(overrides: DependencyOverrides = {}): ApiDependencies {
  return {
    admission: overrides.admission ?? new RecordingAdmission(),
    appCheck: overrides.appCheck ?? new SyntheticAppCheckVerifier(CONFIG, CLOCK),
    auth: overrides.auth ?? OWNER_AUTH,
    clock: CLOCK,
    config: CONFIG,
    signer: overrides.signer ?? REAL_SIGNER,
    store: overrides.store ?? {},
    pushStore: overrides.pushStore ?? {},
    pushTransport: overrides.pushTransport ?? {},
    componentStore: overrides.componentStore ?? {},
  } as unknown as ApiDependencies;
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) resolve();
      else reject(error);
    });
  });
}

async function request(deps: ApiDependencies, input: RouterRequest): Promise<CapturedResponse> {
  const transport = express();
  transport.disable('x-powered-by');
  transport.use(express.raw({
    limit: '2mb',
    type: () => true,
    verify: (incoming, _response, body) => {
      Object.defineProperty(incoming, 'rawBody', {
        configurable: true,
        value: Buffer.from(body),
      });
    },
  }));
  transport.use(createControlPlaneApp(deps));

  const server = transport.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('Local API did not bind');
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}${input.path}`, {
      method: input.method,
      headers: { Connection: 'close', ...input.headers },
      ...(input.body === undefined ? {} : { body: input.body }),
    });
    return Object.freeze({
      status: response.status,
      headers: response.headers,
      text: await response.text(),
    });
  } finally {
    await closeServer(server);
  }
}

function jsonRequest(
  method: string,
  path: string,
  body: unknown,
  headers: Readonly<Record<string, string>>,
): RouterRequest {
  return Object.freeze({
    method,
    path,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

function homeCreateRequest(): RouterRequest {
  return jsonRequest('POST', '/v1/homes', {
    home_id: HOME_ID,
    name: 'Synthetic Home',
    icon: 'house',
    relay_url: 'wss://relay.example.test/ws',
  }, { Authorization: OWNER_AUTHORIZATION });
}

function homeKeyCreateRequest(): RouterRequest {
  return jsonRequest('POST', `/v1/homes/${HOME_ID}/home-keys`, {
    label: 'Synthetic key',
    scopes: ['push:send'],
  }, { Authorization: OWNER_AUTHORIZATION });
}

function pushRequest(): RouterRequest {
  return jsonRequest('POST', '/v1/push', {
    grant_id: GRANT_ID,
    title: 'Synthetic title',
    body: 'Synthetic body',
  }, { Authorization: PUSH_AUTHORIZATION });
}

function dependencyFailure(boundary: string): Error {
  return new Error(`${FAILURE_SENTINEL}:${boundary}:${HOME_KEY}`);
}

function parsed<T>(response: CapturedResponse): T {
  return JSON.parse(response.text) as T;
}

function requestIdFor(admission: RecordingAdmission): string {
  const requestId = admission.openCalls[0]?.requestId;
  if (requestId === undefined) throw new Error('Admission was not opened');
  expect(requestId).toMatch(/^[A-Za-z0-9_-]{22}$/);
  return requestId;
}

function expectNoSecretLeak(text: string): void {
  for (const value of SYNTHETIC_SECRETS) expect(text).not.toContain(value);
}

function expectErrorResponse(
  response: CapturedResponse,
  admission: RecordingAdmission,
  expected: Readonly<{
    status: number;
    code: string;
    message: string;
    retryable: boolean;
  }>,
): ErrorEnvelope {
  expect(response.status).toBe(expected.status);
  expect(response.headers.get('content-type')).toContain('application/json');
  expect(response.headers.get('retry-after')).toBeNull();
  expect(Buffer.byteLength(response.text, 'utf8')).toBeLessThanOrEqual(256);
  expectNoSecretLeak(response.text);
  const envelope = parsed<ErrorEnvelope>(response);
  expect(Object.keys(envelope)).toEqual(['error']);
  expect(Object.keys(envelope.error).sort()).toEqual([
    'code',
    'message',
    'request_id',
    'retryable',
  ]);
  expect(envelope.error).toEqual({
    code: expected.code,
    message: expected.message,
    retryable: expected.retryable,
    request_id: requestIdFor(admission),
  });
  return envelope;
}

function expectUnavailable(response: CapturedResponse, admission: RecordingAdmission): void {
  expectErrorResponse(response, admission, {
    status: 503,
    code: 'temporarily_unavailable',
    message: 'Service is temporarily unavailable',
    retryable: true,
  });
}

function expectUnknownAudit(admission: RecordingAdmission): void {
  expect(admission.tickets).toHaveLength(1);
  expect(admission.tickets[0]?.finishCalls).toEqual([{
    outcome: 'outcome_unknown',
    outcomeCode: 'temporarily_unavailable',
  }]);
}

describe('control-plane API dependency fault matrix', () => {
  test('bounds an admission-open outage before invoking the route effect', async () => {
    const admission = new RecordingAdmission(dependencyFailure('admission.open'));
    let createCalls = 0;
    const response = await request(dependencies({
      admission,
      store: {
        createHome: async () => {
          createCalls += 1;
          throw new Error('createHome must not run');
        },
      },
    }), homeCreateRequest());

    expectUnavailable(response, admission);
    expect(admission.openCalls).toHaveLength(1);
    expect(admission.tickets).toHaveLength(0);
    expect(createCalls).toBe(0);
  });

  test('reports a Firebase Auth key-fetch outage as unavailable rather than denied', async () => {
    const admission = new RecordingAdmission();
    let createCalls = 0;
    const keyFetchFailure = Object.assign(dependencyFailure('firebase-auth-jwks'), {
      code: 'auth/argument-error',
      message: `Error fetching public keys for Google certs: ${FAILURE_SENTINEL}`,
    });
    const response = await request(dependencies({
      admission,
      auth: new FirebaseAdminAuthVerifier({
        verifyIdToken: async () => Promise.reject(keyFetchFailure),
      }),
      store: {
        createHome: async () => {
          createCalls += 1;
        },
      },
    }), homeCreateRequest());

    expectUnavailable(response, admission);
    expectUnknownAudit(admission);
    expect(createCalls).toBe(0);
  });

  test('reports an App Check key-fetch outage as unavailable rather than denied', async () => {
    const admission = new RecordingAdmission();
    let challengeCalls = 0;
    const keyFetchFailure = Object.assign(dependencyFailure('app-check-jwks'), {
      code: 'app-check/invalid-argument',
      cause: { code: 'key-fetch-error' },
    });
    const response = await request(dependencies({
      admission,
      appCheck: new FirebaseAdminAppCheckVerifier({
        verifyToken: async () => Promise.reject(keyFetchFailure),
      }, CONFIG.appCheckAppId),
      pushStore: {
        issueDestinationChallenge: async () => {
          challengeCalls += 1;
        },
      },
    }), jsonRequest('POST', '/v1/push-destinations:challenge', {
      provider: 'fcm',
      fid: FID,
    }, {
      Authorization: OWNER_AUTHORIZATION,
      'X-Firebase-AppCheck': APP_CHECK_TOKEN,
    }));

    expectUnavailable(response, admission);
    expectUnknownAudit(admission);
    expect(challengeCalls).toBe(0);
  });

  test('records a failed home Firestore mutation as outcome unknown without retry', async () => {
    const admission = new RecordingAdmission();
    let createCalls = 0;
    const response = await request(dependencies({
      admission,
      store: {
        createHome: async () => {
          createCalls += 1;
          throw dependencyFailure('store.createHome');
        },
      },
    }), homeCreateRequest());

    expectUnavailable(response, admission);
    expectUnknownAudit(admission);
    expect(createCalls).toBe(1);
  });

  test('records a failed Home Key creation as outcome unknown without retry', async () => {
    const admission = new RecordingAdmission();
    let createCalls = 0;
    const response = await request(dependencies({
      admission,
      store: {
        createHomeKey: async () => {
          createCalls += 1;
          throw dependencyFailure('store.createHomeKey');
        },
      },
    }), homeKeyCreateRequest());

    expectUnavailable(response, admission);
    expectUnknownAudit(admission);
    expect(createCalls).toBe(1);
  });

  test('bounds an access-token signing outage after one exchange reservation', async () => {
    const admission = new RecordingAdmission();
    const order: string[] = [];
    let exchangeCalls = 0;
    let signCalls = 0;
    const failingSigner = {
      sign: async (_grant: AccessGrant) => {
        signCalls += 1;
        order.push('sign');
        throw dependencyFailure('signer.sign');
      },
    };
    const response = await request(dependencies({
      admission,
      signer: failingSigner,
      store: {
        exchangeHomeKey: async (
          _homeKey: string,
          _exchange: ExchangeRequest,
          issuer: AccessTokenIssuer,
          beforeSigning: (grant: AccessGrant) => Promise<void>,
        ) => {
          exchangeCalls += 1;
          order.push('exchange');
          await beforeSigning(ACCESS_GRANT);
          return { grant: ACCESS_GRANT, signed: await issuer.sign(ACCESS_GRANT) };
        },
      },
    }), jsonRequest('POST', '/v1/access-tokens:exchange', { purpose: 'push' }, {
      Authorization: `Bearer ${HOME_KEY}`,
    }));

    expectUnavailable(response, admission);
    expectUnknownAudit(admission);
    expect(exchangeCalls).toBe(1);
    expect(signCalls).toBe(1);
    expect(order).toEqual(['exchange', 'sign']);
  });

  test('does not retry challenge transport after challenge creation', async () => {
    const admission = new RecordingAdmission();
    const order: string[] = [];
    let challengeCalls = 0;
    let transportCalls = 0;
    const response = await request(dependencies({
      admission,
      pushStore: {
        issueDestinationChallenge: async (
          _principal: FirebasePrincipal,
          _appCheck: AppCheckPrincipal,
          fid: string,
        ) => {
          challengeCalls += 1;
          order.push('challenge');
          expect(fid).toBe(FID);
          return {
            challengeId: CHALLENGE_ID,
            challengeSecret: CHALLENGE_SECRET,
            expiresAt: new Date((NOW_SECONDS + 300) * 1_000).toISOString(),
            fid,
          };
        },
      },
      pushTransport: {
        sendChallenge: async (delivery: ChallengePushDelivery) => {
          transportCalls += 1;
          order.push('transport');
          expect(delivery.challengeSecret).toBe(CHALLENGE_SECRET);
          throw dependencyFailure('pushTransport.sendChallenge');
        },
      },
    }), jsonRequest('POST', '/v1/push-destinations:challenge', {
      provider: 'fcm',
      fid: FID,
    }, {
      Authorization: OWNER_AUTHORIZATION,
      'X-Firebase-AppCheck': APP_CHECK_TOKEN,
    }));

    expectUnavailable(response, admission);
    expectUnknownAudit(admission);
    expect(challengeCalls).toBe(1);
    expect(transportCalls).toBe(1);
    expect(order).toEqual(['challenge', 'transport']);
  });

  test('does not retry semantic transport after push authorization', async () => {
    const admission = new RecordingAdmission();
    const order: string[] = [];
    let authorizationCalls = 0;
    let transportCalls = 0;
    const response = await request(dependencies({
      admission,
      pushStore: {
        authorizePush: async (_principal: PushAccessPrincipal, grantId: string) => {
          authorizationCalls += 1;
          order.push('authorize');
          expect(grantId).toBe(GRANT_ID);
          return { destinationId: DESTINATION_ID, fid: FID };
        },
      },
      pushTransport: {
        sendSemanticNotification: async (delivery: SemanticNotificationPushDelivery) => {
          transportCalls += 1;
          order.push('transport');
          expect(delivery.homeId).toBe(HOME_ID);
          expect(delivery.grantId).toBe(GRANT_ID);
          throw dependencyFailure('pushTransport.sendSemanticNotification');
        },
      },
    }), pushRequest());

    expectUnavailable(response, admission);
    expectUnknownAudit(admission);
    expect(authorizationCalls).toBe(1);
    expect(transportCalls).toBe(1);
    expect(order).toEqual(['authorize', 'transport']);
  });

  test('bounds one failed component upload delivery', async () => {
    const admission = new RecordingAdmission();
    let deliveryCalls = 0;
    const response = await request(dependencies({
      admission,
      componentStore: {
        deliverUpload: async (
          uploadId: string,
          uploadToken: string,
          bytes: Uint8Array,
          beforeReservation: (homeId: string) => Promise<void>,
        ) => {
          deliveryCalls += 1;
          expect(uploadId).toBe(UPLOAD_ID);
          expect(uploadToken).toBe(UPLOAD_TOKEN);
          expect(bytes).toEqual(ARTIFACT);
          await beforeReservation(HOME_ID);
          throw dependencyFailure('componentStore.deliverUpload');
        },
      },
    }), {
      method: 'PUT',
      path: `/v1/component-uploads/${UPLOAD_ID}`,
      headers: {
        Authorization: `Bearer ${UPLOAD_TOKEN}`,
        'Content-Length': String(ARTIFACT.byteLength),
        'Content-Type': 'application/javascript; charset=utf-8',
      },
      body: Uint8Array.from(ARTIFACT).buffer,
    });

    expectUnavailable(response, admission);
    expectUnknownAudit(admission);
    expect(deliveryCalls).toBe(1);
  });

  test('bounds one failed component finalization', async () => {
    const admission = new RecordingAdmission();
    let finalizeCalls = 0;
    const response = await request(dependencies({
      admission,
      componentStore: {
        finalizeRelease: async (
          _principal: ComponentPublisherPrincipal,
          homeId: string,
          uploadId: string,
        ) => {
          finalizeCalls += 1;
          expect(homeId).toBe(HOME_ID);
          expect(uploadId).toBe(UPLOAD_ID);
          throw dependencyFailure('componentStore.finalizeRelease');
        },
      },
    }), jsonRequest(
      'POST',
      `/v1/homes/${HOME_ID}/component-uploads/${UPLOAD_ID}:finalize`,
      {},
      { Authorization: COMPONENT_AUTHORIZATION },
    ));

    expectUnavailable(response, admission);
    expectUnknownAudit(admission);
    expect(finalizeCalls).toBe(1);
  });

  test('bounds one failed component activation', async () => {
    const admission = new RecordingAdmission();
    let activationCalls = 0;
    const response = await request(dependencies({
      admission,
      componentStore: {
        activateRelease: async (
          _principal: ComponentPublisherPrincipal,
          homeId: string,
          input: ComponentActivationInput,
        ) => {
          activationCalls += 1;
          expect(homeId).toBe(HOME_ID);
          expect(input).toEqual({
            sha256: COMPONENT_SHA256,
            expectedGeneration: 0,
            generation: 1,
          });
          throw dependencyFailure('componentStore.activateRelease');
        },
      },
    }), jsonRequest(
      'POST',
      `/v1/homes/${HOME_ID}/component-releases:activate`,
      { sha256: COMPONENT_SHA256, expected_generation: 0, generation: 1 },
      { Authorization: COMPONENT_AUTHORIZATION },
    ));

    expectUnavailable(response, admission);
    expectUnknownAudit(admission);
    expect(activationCalls).toBe(1);
  });

  test('records a definitive dependency ApiError as denied', async () => {
    const admission = new RecordingAdmission();
    let createCalls = 0;
    const response = await request(dependencies({
      admission,
      store: {
        createHomeKey: async () => {
          createCalls += 1;
          throw new ApiError('not_home_owner');
        },
      },
    }), homeKeyCreateRequest());

    expectErrorResponse(response, admission, {
      status: 403,
      code: 'not_home_owner',
      message: 'Home ownership is required',
      retryable: false,
    });
    expect(admission.tickets[0]?.finishCalls).toEqual([{
      outcome: 'denied',
      outcomeCode: 'not_home_owner',
    }]);
    expect(createCalls).toBe(1);
  });

  test('keeps the success response when audit finish fails after send', async () => {
    const admission = new RecordingAdmission(null, dependencyFailure('admission.finish'));
    let authorizationCalls = 0;
    let transportCalls = 0;
    const response = await request(dependencies({
      admission,
      pushStore: {
        authorizePush: async () => {
          authorizationCalls += 1;
          return { destinationId: DESTINATION_ID, fid: FID };
        },
      },
      pushTransport: {
        sendSemanticNotification: async () => {
          transportCalls += 1;
        },
      },
    }), pushRequest());

    expect(response.status).toBe(202);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(parsed<{ readonly schema: string; readonly request_id: string }>(response)).toEqual({
      schema: 'miakapp.push-accepted/1',
      request_id: requestIdFor(admission),
    });
    expect(response.text.match(/miakapp\.push-accepted\/1/g)).toHaveLength(1);
    expectNoSecretLeak(response.text);
    expect(admission.tickets[0]?.finishCalls).toEqual([
      { outcome: 'ok', outcomeCode: null },
      { outcome: 'outcome_unknown', outcomeCode: 'temporarily_unavailable' },
    ]);
    expect(authorizationCalls).toBe(1);
    expect(transportCalls).toBe(1);
  });
});
