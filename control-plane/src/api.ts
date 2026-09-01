import express, { type Request, type Response } from 'express';

import {
  authenticateFirebase,
  requireRecentAuthentication,
  type FirebaseTokenVerifier,
} from './auth.js';
import {
  AppCheckVerificationError,
  verifySyntheticAppCheckToken,
} from './app-check.js';
import {
  AccessTokenVerificationError,
  verifyPushAccessToken,
} from './access-token.js';
import { AccessTokenSigner, randomIdentifier } from './crypto.js';
import { ApiError, apiError } from './errors.js';
import {
  assertExactKeys,
  objectValue,
  parseRequestJson,
  stringArray,
  stringValue,
  type JsonValue,
} from './json.js';
import { ControlPlaneStore } from './store.js';
import { type PushTransport } from './push.js';
import { PushStore } from './push-store.js';
import {
  ACCESS_SCOPES,
  COORDINATOR_NAME_PATTERN,
  HOME_ID_PATTERN,
  IDENTIFIER_PATTERN,
  type AccessScope,
  type AppCheckPrincipal,
  type Clock,
  type DeploymentConfig,
  type ExchangeRequest,
  type HomeInput,
  type HomePatch,
  type PushNotification,
} from './types.js';

const CONTROL_CHARACTER = /\p{Cc}/u;
const HTML_DELIMITER = /[<>]/u;
const REASONS = new Set(['initial', 'reauth', 'reconnect']);
const MAX_RESPONSE_BODY_BYTES = 64 * 1_024;
const MAX_PUSH_GRANT_LIST_RESPONSE_BYTES = 96 * 1_024;

interface RawRequest extends Request {
  readonly rawBody?: Buffer;
}

export interface ApiDependencies {
  readonly auth: FirebaseTokenVerifier;
  readonly clock: Clock;
  readonly config: DeploymentConfig;
  readonly signer: AccessTokenSigner;
  readonly store: ControlPlaneStore;
  readonly pushStore: PushStore;
  readonly pushTransport: PushTransport;
}

function setPrivateHeaders(response: Response): void {
  response.set({
    'Cache-Control': 'no-store',
    Pragma: 'no-cache',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
  });
}

function applyCors(request: Request, response: Response, config: DeploymentConfig): void {
  const origin = request.get('Origin');
  response.vary('Origin');
  if (origin === undefined) return;
  if (!config.allowedOrigins.has(origin)) throw apiError('invalid_request');
  response.set({
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'false',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, Miakapp-Push-Proof, X-Firebase-AppCheck',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Max-Age': '600',
  });
}

function rawBody(request: RawRequest): Uint8Array {
  if (request.rawBody !== undefined) return request.rawBody;
  if (Buffer.isBuffer(request.body)) return request.body;
  if (typeof request.body === 'string') return Buffer.from(request.body, 'utf8');
  if (request.body === undefined) return new Uint8Array();
  if (typeof request.body === 'object'
    && request.body !== null
    && Object.keys(request.body as object).length === 0
    && (request.get('Content-Length') === undefined || request.get('Content-Length') === '0')
    && request.get('Transfer-Encoding') === undefined) {
    return new Uint8Array();
  }
  throw apiError('temporarily_unavailable');
}

function requireEmptyBody(request: RawRequest): void {
  if (rawBody(request).byteLength !== 0) throw apiError('invalid_request');
}

function jsonBody(request: RawRequest): { [key: string]: JsonValue } {
  const contentType = request.get('Content-Type');
  if (contentType === undefined || !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(contentType)) {
    throw apiError('invalid_request');
  }
  const bytes = rawBody(request);
  if (bytes.byteLength === 0) throw apiError('invalid_request');
  return objectValue(parseRequestJson(bytes));
}

function boundedText(value: JsonValue | undefined, maximumBytes: number): string {
  const text = stringValue(value);
  const length = Buffer.byteLength(text, 'utf8');
  if (length === 0 || length > maximumBytes || CONTROL_CHARACTER.test(text)) {
    throw apiError('invalid_request');
  }
  return text;
}

function boundedSemanticText(value: JsonValue | undefined, maximumBytes: number): string {
  const text = boundedText(value, maximumBytes);
  if (HTML_DELIMITER.test(text)) throw apiError('invalid_request');
  return text;
}

function homeId(value: JsonValue | undefined): string {
  const id = stringValue(value);
  if (!HOME_ID_PATTERN.test(id)) throw apiError('invalid_request');
  return id;
}

function pathHomeId(value: string): string {
  if (!HOME_ID_PATTERN.test(value)) throw apiError('invalid_request');
  return value;
}

function keyId(value: string): string {
  if (!IDENTIFIER_PATTERN.test(value)
    || Buffer.from(value, 'base64url').byteLength !== 16
    || Buffer.from(value, 'base64url').toString('base64url') !== value) {
    throw apiError('invalid_request');
  }
  return value;
}

function identifierValue(value: JsonValue | undefined): string {
  const id = stringValue(value);
  return keyId(id);
}

function fidValue(value: JsonValue | undefined): string {
  return boundedText(value, 4_096);
}

function emptyObjectBody(request: RawRequest): void {
  const body = jsonBody(request);
  assertExactKeys(body, []);
}

function destinationChallenge(body: { [key: string]: JsonValue }): string {
  assertExactKeys(body, ['provider', 'fid']);
  if (body.provider !== 'fcm') throw apiError('invalid_request');
  return fidValue(body.fid);
}

function destinationProof(value: string | undefined): {
  readonly challengeId: string;
  readonly challengeSecret: string;
} {
  if (value === undefined || Buffer.byteLength(value, 'ascii') !== 66) {
    throw apiError('invalid_destination_proof');
  }
  const match = /^([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})$/.exec(value);
  const challengeId = match?.[1];
  const challengeSecret = match?.[2];
  if (challengeId === undefined || challengeSecret === undefined) {
    throw apiError('invalid_destination_proof');
  }
  if (Buffer.from(challengeId, 'base64url').byteLength !== 16
    || Buffer.from(challengeId, 'base64url').toString('base64url') !== challengeId
    || Buffer.from(challengeSecret, 'base64url').byteLength !== 32
    || Buffer.from(challengeSecret, 'base64url').toString('base64url') !== challengeSecret) {
    throw apiError('invalid_destination_proof');
  }
  return Object.freeze({ challengeId, challengeSecret });
}

function grantCreation(body: { [key: string]: JsonValue }): string {
  assertExactKeys(body, ['destination_id']);
  return identifierValue(body.destination_id);
}

function pushNotification(body: { [key: string]: JsonValue }): {
  readonly grantId: string;
  readonly notification: PushNotification;
} {
  assertExactKeys(body, ['grant_id', 'title', 'body'], ['tag']);
  return Object.freeze({
    grantId: identifierValue(body.grant_id),
    notification: Object.freeze({
      title: boundedSemanticText(body.title, 120),
      body: boundedSemanticText(body.body, 1_024),
      tag: body.tag === undefined ? null : boundedSemanticText(body.tag, 64),
    }),
  });
}

function relayUrl(value: JsonValue | undefined): string {
  const raw = stringValue(value);
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw apiError('invalid_request');
  }
  if (parsed.protocol !== 'wss:'
    || parsed.username !== ''
    || parsed.password !== ''
    || parsed.search !== ''
    || parsed.hash !== ''
    || !parsed.pathname.endsWith('/ws')
    || parsed.href !== raw) {
    throw apiError('invalid_request');
  }
  return raw;
}

function homeInput(body: { [key: string]: JsonValue }): HomeInput {
  assertExactKeys(body, ['home_id', 'name', 'icon', 'relay_url']);
  return Object.freeze({
    homeId: homeId(body.home_id),
    name: boundedText(body.name, 128),
    icon: boundedText(body.icon, 64),
    relayUrl: relayUrl(body.relay_url),
  });
}

function homePatch(body: { [key: string]: JsonValue }): HomePatch {
  assertExactKeys(body, [], ['name', 'icon', 'relay_url']);
  if (Object.keys(body).length === 0) throw apiError('invalid_request');
  return Object.freeze({
    ...(body.name === undefined ? {} : { name: boundedText(body.name, 128) }),
    ...(body.icon === undefined ? {} : { icon: boundedText(body.icon, 64) }),
    ...(body.relay_url === undefined ? {} : { relayUrl: relayUrl(body.relay_url) }),
  });
}

function keyCreation(body: { [key: string]: JsonValue }): {
  readonly label: string;
  readonly scopes: AccessScope[];
} {
  assertExactKeys(body, ['label', 'scopes']);
  const scopes = stringArray(body.scopes);
  if (scopes.length === 0
    || new Set(scopes).size !== scopes.length
    || scopes.some((scope) => !ACCESS_SCOPES.includes(scope as AccessScope))) {
    throw apiError('invalid_request');
  }
  scopes.sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
  return Object.freeze({ label: boundedText(body.label, 64), scopes: scopes as AccessScope[] });
}

function exchangeRequest(body: { [key: string]: JsonValue }): ExchangeRequest {
  const purpose = stringValue(body.purpose);
  if (purpose === 'relay') {
    const role = stringValue(body.role);
    const reason = stringValue(body.reason);
    if (!REASONS.has(reason)) throw apiError('invalid_request');
    if (role === 'coordinator') {
      assertExactKeys(body, ['purpose', 'role', 'coordinator_name', 'reason']);
      const coordinatorName = stringValue(body.coordinator_name);
      if (!COORDINATOR_NAME_PATTERN.test(coordinatorName)) throw apiError('invalid_request');
      return Object.freeze({
        purpose: 'relay',
        role: 'coordinator',
        coordinatorName,
        reason: reason as 'initial' | 'reauth' | 'reconnect',
      });
    }
    if (role === 'cli') {
      assertExactKeys(body, ['purpose', 'role', 'reason']);
      return Object.freeze({
        purpose: 'relay',
        role: 'cli',
        reason: reason as 'initial' | 'reauth' | 'reconnect',
      });
    }
    throw apiError('invalid_request');
  }
  if (purpose === 'push' || purpose === 'components') {
    assertExactKeys(body, ['purpose']);
    return Object.freeze({ purpose });
  }
  throw apiError('invalid_request');
}

function assertNoCookie(request: Request): void {
  if (request.headers.cookie !== undefined) throw apiError('invalid_request');
}

async function ownerPrincipal(request: Request, dependencies: ApiDependencies) {
  const now = dependencies.clock.now();
  return authenticateFirebase(dependencies.auth, request.headers.authorization, now);
}

function appCheckPrincipal(request: Request, dependencies: ApiDependencies): AppCheckPrincipal {
  try {
    return verifySyntheticAppCheckToken(
      request.headers['x-firebase-appcheck'],
      dependencies.config,
      dependencies.clock,
    );
  } catch (error) {
    if (error instanceof AppCheckVerificationError) throw apiError('invalid_app_check_token');
    throw error;
  }
}

async function destinationPrincipals(request: Request, dependencies: ApiDependencies) {
  const owner = await ownerPrincipal(request, dependencies);
  const appCheck = appCheckPrincipal(request, dependencies);
  return Object.freeze({ owner, appCheck });
}

function pushPrincipal(request: Request, dependencies: ApiDependencies) {
  try {
    return verifyPushAccessToken(
      request.headers.authorization,
      dependencies.config,
      dependencies.clock,
    );
  } catch (error) {
    if (error instanceof AccessTokenVerificationError) throw apiError('invalid_access_token');
    throw error;
  }
}

function sendJson(
  response: Response,
  status: number,
  value: unknown,
  maximumBytes = MAX_RESPONSE_BODY_BYTES,
): void {
  const body = JSON.stringify(value);
  if (Buffer.byteLength(body, 'utf8') > maximumBytes) throw apiError('temporarily_unavailable');
  response.status(status).type('application/json').send(body);
}

function sendError(response: Response, requestId: string, error: unknown): void {
  const api = error instanceof ApiError ? error : apiError('temporarily_unavailable');
  sendJson(response, api.status, {
    error: {
      code: api.code,
      message: api.message,
      retryable: api.retryable,
      request_id: requestId,
    },
  });
}

async function routeRequest(
  request: RawRequest,
  response: Response,
  dependencies: ApiDependencies,
  requestId: string,
): Promise<void> {
  if (request.originalUrl.includes('?')) throw apiError('invalid_request');
  applyCors(request, response, dependencies.config);
  if (request.method === 'OPTIONS') {
    requireEmptyBody(request);
    response.sendStatus(204);
    return;
  }

  if (request.path === '/.well-known/miakapp-control-plane' && request.method === 'GET') {
    requireEmptyBody(request);
    response.set('Cache-Control', 'public, max-age=300, must-revalidate');
    sendJson(response, 200, {
      schema: 'miakapp.control-plane-discovery/1',
      issuer: dependencies.config.issuer,
      jwks_uri: dependencies.config.jwksUri,
      exchange_endpoint: dependencies.config.exchangeEndpoint,
      push_audience: dependencies.config.pushAudience,
      components_audience: dependencies.config.componentsAudience,
    });
    return;
  }
  if (request.path === '/.well-known/jwks.json' && request.method === 'GET') {
    requireEmptyBody(request);
    response.set('Cache-Control', 'public, max-age=60, must-revalidate');
    sendJson(response, 200, { keys: [dependencies.config.signingPublicJwk] });
    return;
  }

  assertNoCookie(request);
  if (request.path === '/v1/push-destinations:challenge' && request.method === 'POST') {
    const { owner, appCheck } = await destinationPrincipals(request, dependencies);
    const challenge = await dependencies.pushStore.issueDestinationChallenge(
      owner,
      appCheck,
      destinationChallenge(jsonBody(request)),
    );
    await dependencies.pushTransport.sendChallenge({
      fid: challenge.fid,
      challengeId: challenge.challengeId,
      challengeSecret: challenge.challengeSecret,
    });
    sendJson(response, 202, {
      schema: 'miakapp.push-challenge/1',
      challenge_id: challenge.challengeId,
      expires_at: challenge.expiresAt,
    });
    return;
  }

  if (request.path === '/v1/push-destinations:complete' && request.method === 'POST') {
    const { owner, appCheck } = await destinationPrincipals(request, dependencies);
    emptyObjectBody(request);
    const proof = destinationProof(request.get('Miakapp-Push-Proof'));
    const destination = await dependencies.pushStore.completeDestinationChallenge(
      owner,
      appCheck,
      proof.challengeId,
      proof.challengeSecret,
    );
    sendJson(response, 201, { schema: 'miakapp.push-destination-created/1', destination });
    return;
  }

  if (request.path === '/v1/push-destinations' && request.method === 'GET') {
    const { owner } = await destinationPrincipals(request, dependencies);
    requireEmptyBody(request);
    const destinations = await dependencies.pushStore.listDestinations(owner);
    sendJson(response, 200, { schema: 'miakapp.push-destination-list/1', destinations });
    return;
  }

  const destinationDeleteMatch = /^\/v1\/push-destinations\/([A-Za-z0-9_-]{22})$/.exec(request.path);
  if (destinationDeleteMatch !== null && request.method === 'DELETE') {
    const { owner } = await destinationPrincipals(request, dependencies);
    requireEmptyBody(request);
    await dependencies.pushStore.deleteDestination(
      owner,
      keyId(destinationDeleteMatch[1] as string),
    );
    response.sendStatus(204);
    return;
  }

  if (request.path === '/v1/push' && request.method === 'POST') {
    const principal = pushPrincipal(request, dependencies);
    const input = pushNotification(jsonBody(request));
    const destination = await dependencies.pushStore.authorizePush(principal, input.grantId);
    await dependencies.pushTransport.sendSemanticNotification({
      fid: destination.fid,
      grantId: input.grantId,
      title: input.notification.title,
      body: input.notification.body,
      tag: input.notification.tag,
    });
    sendJson(response, 202, { schema: 'miakapp.push-accepted/1', request_id: requestId });
    return;
  }

  if (request.path === '/v1/homes' && request.method === 'POST') {
    const principal = await ownerPrincipal(request, dependencies);
    requireRecentAuthentication(principal, dependencies.clock.now());
    const home = await dependencies.store.createHome(principal, homeInput(jsonBody(request)));
    sendJson(response, 201, { schema: 'miakapp.home/1', home });
    return;
  }

  const homeMatch = /^\/v1\/homes\/([a-z][a-z0-9-]{1,61}[a-z0-9])$/.exec(request.path);
  if (homeMatch !== null && request.method === 'PATCH') {
    const principal = await ownerPrincipal(request, dependencies);
    const patch = homePatch(jsonBody(request));
    if (patch.relayUrl !== undefined) requireRecentAuthentication(principal, dependencies.clock.now());
    const home = await dependencies.store.patchHome(principal, pathHomeId(homeMatch[1] as string), patch);
    sendJson(response, 200, { schema: 'miakapp.home/1', home });
    return;
  }

  const keysMatch = /^\/v1\/homes\/([a-z][a-z0-9-]{1,61}[a-z0-9])\/home-keys$/.exec(request.path);
  if (keysMatch !== null && (request.method === 'GET' || request.method === 'POST')) {
    const principal = await ownerPrincipal(request, dependencies);
    requireRecentAuthentication(principal, dependencies.clock.now());
    const id = pathHomeId(keysMatch[1] as string);
    if (request.method === 'GET') {
      requireEmptyBody(request);
      const keys = await dependencies.store.listHomeKeys(principal, id);
      sendJson(response, 200, { schema: 'miakapp.home-key-list/1', keys });
    } else {
      const input = keyCreation(jsonBody(request));
      const created = await dependencies.store.createHomeKey(principal, id, input.label, input.scopes);
      sendJson(response, 201, {
        schema: 'miakapp.home-key-created/1',
        key: created.metadata,
        home_key: created.homeKey,
      });
    }
    return;
  }

  const grantsMatch = /^\/v1\/homes\/([a-z][a-z0-9-]{1,61}[a-z0-9])\/push-grants$/.exec(request.path);
  if (grantsMatch !== null && (request.method === 'GET' || request.method === 'POST')) {
    const principal = await ownerPrincipal(request, dependencies);
    const id = pathHomeId(grantsMatch[1] as string);
    if (request.method === 'GET') {
      requireEmptyBody(request);
      const grants = await dependencies.pushStore.listGrants(principal, id);
      sendJson(
        response,
        200,
        { schema: 'miakapp.push-grant-list/1', grants },
        MAX_PUSH_GRANT_LIST_RESPONSE_BYTES,
      );
    } else {
      const grant = await dependencies.pushStore.createGrant(
        principal,
        id,
        grantCreation(jsonBody(request)),
      );
      sendJson(response, 201, { schema: 'miakapp.push-grant/1', grant });
    }
    return;
  }

  const grantDeleteMatch = /^\/v1\/homes\/([a-z][a-z0-9-]{1,61}[a-z0-9])\/push-grants\/([A-Za-z0-9_-]{22})$/
    .exec(request.path);
  if (grantDeleteMatch !== null && request.method === 'DELETE') {
    const principal = await ownerPrincipal(request, dependencies);
    requireEmptyBody(request);
    await dependencies.pushStore.revokeGrant(
      principal,
      pathHomeId(grantDeleteMatch[1] as string),
      keyId(grantDeleteMatch[2] as string),
    );
    response.sendStatus(204);
    return;
  }

  const revokeMatch = /^\/v1\/homes\/([a-z][a-z0-9-]{1,61}[a-z0-9])\/home-keys\/([A-Za-z0-9_-]{22})$/
    .exec(request.path);
  if (revokeMatch !== null && request.method === 'DELETE') {
    const principal = await ownerPrincipal(request, dependencies);
    requireRecentAuthentication(principal, dependencies.clock.now());
    requireEmptyBody(request);
    await dependencies.store.revokeHomeKey(
      principal,
      pathHomeId(revokeMatch[1] as string),
      keyId(revokeMatch[2] as string),
    );
    response.sendStatus(204);
    return;
  }

  if (request.path === '/v1/access-tokens:exchange' && request.method === 'POST') {
    const authorization = request.headers.authorization;
    if (typeof authorization !== 'string') throw apiError('invalid_home_key');
    const match = /^Bearer ([\x21-\x7e]+)$/.exec(authorization);
    const homeKey = match?.[1];
    if (homeKey === undefined) throw apiError('invalid_home_key');
    const exchange = exchangeRequest(jsonBody(request));
    const { grant, signed } = await dependencies.store.exchangeHomeKey(
      homeKey,
      exchange,
      dependencies.signer,
    );
    sendJson(response, 200, {
      schema: 'miakapp.access-token/1',
      access_token: signed.token,
      token_type: 'Bearer',
      expires_at_ms: signed.expiresAtMs,
      ...(exchange.purpose === 'relay' ? { relay_url: grant.audience } : {}),
      key: { id: grant.clientId, label: grant.label },
    });
    return;
  }

  throw apiError('invalid_request');
}

export function createControlPlaneApp(dependencies: ApiDependencies): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(async (request: RawRequest, response: Response) => {
    const requestId = randomIdentifier();
    setPrivateHeaders(response);
    try {
      await routeRequest(request, response, dependencies, requestId);
    } catch (error) {
      if (!response.headersSent) sendError(response, requestId, error);
    }
  });
  return app;
}
