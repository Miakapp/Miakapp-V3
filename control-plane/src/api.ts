import express, { type Request, type Response } from 'express';

import {
  authenticateFirebase,
  requireRecentAuthentication,
  type FirebaseTokenVerifier,
} from './auth.js';
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
import {
  ACCESS_SCOPES,
  COORDINATOR_NAME_PATTERN,
  HOME_ID_PATTERN,
  IDENTIFIER_PATTERN,
  type AccessScope,
  type Clock,
  type DeploymentConfig,
  type ExchangeRequest,
  type HomeInput,
  type HomePatch,
} from './types.js';

const CONTROL_CHARACTER = /\p{Cc}/u;
const REASONS = new Set(['initial', 'reauth', 'reconnect']);

interface RawRequest extends Request {
  readonly rawBody?: Buffer;
}

export interface ApiDependencies {
  readonly auth: FirebaseTokenVerifier;
  readonly clock: Clock;
  readonly config: DeploymentConfig;
  readonly signer: AccessTokenSigner;
  readonly store: ControlPlaneStore;
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
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
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

function sendJson(response: Response, status: number, value: unknown): void {
  response.status(status).type('application/json').send(JSON.stringify(value));
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
      await routeRequest(request, response, dependencies);
    } catch (error) {
      if (!response.headersSent) sendError(response, requestId, error);
    }
  });
  return app;
}
