import express, { type Request, type Response } from 'express';
import { isIP } from 'node:net';

import {
  AdmissionController,
  auditOutcomeFor,
  type AdmissionTicket,
} from './admission.js';
import {
  authenticateFirebase,
  requireRecentAuthentication,
  type FirebaseTokenVerifier,
} from './auth.js';
import {
  AppCheckVerificationError,
  type AppCheckVerifier,
} from './app-check.js';
import {
  AccessTokenVerificationError,
  verifyComponentAccessToken,
  verifyPushAccessToken,
} from './access-token.js';
import {
  MAX_COMPONENT_ARTIFACT_BYTES,
  validateComponentRequirements,
} from './component-artifact.js';
import { ComponentStore } from './component-store.js';
import { parseHomeKey, randomIdentifier } from './crypto.js';
import { ApiError, apiError } from './errors.js';
import {
  assertExactKeys,
  objectValue,
  parseRequestJson,
  stringArray,
  stringValue,
  type JsonValue,
} from './json.js';
import { ControlPlaneStore, type AccessTokenIssuer } from './store.js';
import { type PushTransport } from './push.js';
import { PushStore } from './push-store.js';
import {
  ACCESS_SCOPES,
  COORDINATOR_NAME_PATTERN,
  HOME_ID_PATTERN,
  IDENTIFIER_PATTERN,
  SHA256_PATTERN,
  COMPONENT_ABI,
  type AccessScope,
  type AdmissionOperation,
  type AppCheckPrincipal,
  type Clock,
  type ComponentPublisherPrincipal,
  type ComponentUploadInput,
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
  readonly admission: AdmissionController;
  readonly appCheck: AppCheckVerifier;
  readonly auth: FirebaseTokenVerifier;
  readonly clock: Clock;
  readonly config: DeploymentConfig;
  readonly signer: AccessTokenIssuer;
  readonly store: ControlPlaneStore;
  readonly pushStore: PushStore;
  readonly pushTransport: PushTransport;
  readonly componentStore: ComponentStore;
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
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Expose-Headers': 'Retry-After',
    'Access-Control-Max-Age': '600',
  });
}

function admissionOperation(request: Request): AdmissionOperation | null {
  const { method, path } = request;
  if (method === 'POST' && path === '/v1/homes') return 'home.create';
  if (method === 'PATCH' && /^\/v1\/homes\/[a-z][a-z0-9-]{1,61}[a-z0-9]$/.test(path)) return 'home.patch';
  if (method === 'POST' && /^\/v1\/homes\/[a-z][a-z0-9-]{1,61}[a-z0-9]\/home-keys$/.test(path)) {
    return 'home_key.create';
  }
  if (method === 'DELETE'
    && /^\/v1\/homes\/[a-z][a-z0-9-]{1,61}[a-z0-9]\/home-keys\/[A-Za-z0-9_-]{22}$/.test(path)) {
    return 'home_key.revoke';
  }
  if (method === 'POST' && path === '/v1/access-tokens:exchange') return 'access.exchange';
  if (method === 'POST' && path === '/v1/push-destinations:challenge') return 'push.destination.challenge';
  if (method === 'POST' && path === '/v1/push-destinations:complete') return 'push.destination.register';
  if (method === 'DELETE' && /^\/v1\/push-destinations\/[A-Za-z0-9_-]{22}$/.test(path)) {
    return 'push.destination.delete';
  }
  if (method === 'POST'
    && /^\/v1\/homes\/[a-z][a-z0-9-]{1,61}[a-z0-9]\/push-grants$/.test(path)) {
    return 'push.grant.create';
  }
  if (method === 'DELETE'
    && /^\/v1\/homes\/[a-z][a-z0-9-]{1,61}[a-z0-9]\/push-grants\/[A-Za-z0-9_-]{22}$/.test(path)) {
    return 'push.grant.revoke';
  }
  if (method === 'POST' && path === '/v1/push') return 'push.send';
  if (method === 'POST'
    && /^\/v1\/homes\/[a-z][a-z0-9-]{1,61}[a-z0-9]\/component-uploads$/.test(path)) {
    return 'component.upload.issue';
  }
  if (method === 'PUT' && /^\/v1\/component-uploads\/[A-Za-z0-9_-]{22}$/.test(path)) {
    return 'component.upload.deliver';
  }
  if (method === 'POST'
    && /^\/v1\/homes\/[a-z][a-z0-9-]{1,61}[a-z0-9]\/component-uploads\/[A-Za-z0-9_-]{22}:finalize$/.test(path)) {
    return 'component.finalize';
  }
  if (method === 'POST'
    && /^\/v1\/homes\/[a-z][a-z0-9-]{1,61}[a-z0-9]\/component-releases:activate$/.test(path)) {
    return 'component.activate';
  }
  return null;
}

function requestSource(request: Request): string {
  const remote = request.socket.remoteAddress;
  if (remote === undefined) return 'unknown';
  const normalized = remote.startsWith('::ffff:') && isIP(remote.slice(7)) === 4
    ? remote.slice(7)
    : remote;
  return isIP(normalized) === 0 ? 'unknown' : normalized;
}

function activeAdmission(
  ticket: AdmissionTicket | null,
  operation: AdmissionOperation,
): AdmissionTicket {
  if (ticket === null || ticket.operation !== operation) throw apiError('temporarily_unavailable');
  return ticket;
}

function identifyOwner(ticket: AdmissionTicket, principal: { readonly userId: string }): void {
  ticket.identifyActor('firebase_user', principal.userId);
}

function identifyComponentPublisher(
  ticket: AdmissionTicket,
  principal: ComponentPublisherPrincipal,
): void {
  if (principal.kind === 'owner') ticket.identifyActor('firebase_user', principal.userId);
  else ticket.identifyActor('access_token', principal.clientId);
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

function digestValue(value: JsonValue | undefined): string {
  const digest = stringValue(value);
  if (!SHA256_PATTERN.test(digest)
    || Buffer.from(digest, 'base64url').byteLength !== 32
    || Buffer.from(digest, 'base64url').toString('base64url') !== digest) {
    throw apiError('invalid_request');
  }
  return digest;
}

function safeNonnegativeInteger(value: JsonValue | undefined): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw apiError('invalid_request');
  return value as number;
}

function componentUploadInput(body: { [key: string]: JsonValue }): ComponentUploadInput {
  assertExactKeys(body, ['release', 'abi', 'sha256', 'size', 'requires']);
  const size = safeNonnegativeInteger(body.size);
  if (body.abi !== COMPONENT_ABI || size === 0) throw apiError('invalid_request');
  if (size > MAX_COMPONENT_ARTIFACT_BYTES) throw apiError('limit_exceeded');
  return Object.freeze({
    release: boundedText(body.release, 64),
    abi: COMPONENT_ABI,
    sha256: digestValue(body.sha256),
    size,
    requires: validateComponentRequirements(body.requires),
  });
}

function componentActivation(body: { [key: string]: JsonValue }): {
  readonly sha256: string;
  readonly expectedGeneration: number;
  readonly generation: number;
} {
  assertExactKeys(body, ['sha256', 'expected_generation', 'generation']);
  return Object.freeze({
    sha256: digestValue(body.sha256),
    expectedGeneration: safeNonnegativeInteger(body.expected_generation),
    generation: safeNonnegativeInteger(body.generation),
  });
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

async function appCheckPrincipal(
  request: Request,
  dependencies: ApiDependencies,
): Promise<AppCheckPrincipal> {
  try {
    return await dependencies.appCheck.verifyToken(
      request.headers['x-firebase-appcheck'],
    );
  } catch (error) {
    if (error instanceof AppCheckVerificationError) throw apiError('invalid_app_check_token');
    throw error;
  }
}

async function destinationPrincipals(request: Request, dependencies: ApiDependencies) {
  const owner = await ownerPrincipal(request, dependencies);
  const appCheck = await appCheckPrincipal(request, dependencies);
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

function authorizationAlgorithm(request: Request): string {
  try {
    const authorization = request.headers.authorization;
    if (typeof authorization !== 'string' || Buffer.byteLength(authorization, 'utf8') > 8_199) {
      throw new Error('invalid authorization');
    }
    const token = /^Bearer ([\x21-\x7e]+)$/.exec(authorization)?.[1];
    const segments = token?.split('.');
    const encodedHeader = segments?.length === 3 ? segments[0] : undefined;
    if (encodedHeader === undefined
      || !/^[A-Za-z0-9_-]+$/.test(encodedHeader)
      || encodedHeader.length > 2_731) {
      throw new Error('invalid authorization');
    }
    const decoded = Buffer.from(encodedHeader, 'base64url');
    if (decoded.byteLength > 2_048 || decoded.toString('base64url') !== encodedHeader) {
      throw new Error('invalid authorization');
    }
    const header = objectValue(parseRequestJson(decoded));
    return stringValue(header.alg);
  } catch {
    throw apiError('invalid_access_token');
  }
}

async function componentPrincipal(
  request: Request,
  dependencies: ApiDependencies,
  homeId: string,
): Promise<ComponentPublisherPrincipal> {
  const algorithm = authorizationAlgorithm(request);
  if (algorithm === 'EdDSA') {
    try {
      const principal = verifyComponentAccessToken(
        request.headers.authorization,
        dependencies.config,
        dependencies.clock,
      );
      return Object.freeze({
        kind: 'access_token',
        homeId: principal.homeId,
        clientId: principal.clientId,
      });
    } catch (error) {
      if (error instanceof AccessTokenVerificationError) throw apiError('invalid_access_token');
      throw error;
    }
  }
  if (algorithm === 'RS256'
    || (algorithm === 'none' && dependencies.config.projectId === 'demo-miakapp-v4')) {
    const owner = await ownerPrincipal(request, dependencies);
    requireRecentAuthentication(owner, dependencies.clock.now());
    return Object.freeze({ kind: 'owner', homeId, userId: owner.userId });
  }
  throw apiError('invalid_access_token');
}

function componentUploadCapability(request: Request): string {
  const authorization = request.headers.authorization;
  if (typeof authorization !== 'string') throw apiError('invalid_upload_capability');
  const token = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(authorization)?.[1];
  if (token === undefined
    || Buffer.from(token, 'base64url').byteLength !== 32
    || Buffer.from(token, 'base64url').toString('base64url') !== token) {
    throw apiError('invalid_upload_capability');
  }
  return token;
}

function componentArtifactBody(request: RawRequest): Uint8Array {
  if (request.get('Content-Type') !== 'application/javascript; charset=utf-8'
    || request.get('Content-Encoding') !== undefined
    || request.get('Transfer-Encoding') !== undefined
    || request.get('Range') !== undefined
    || request.get('Content-Range') !== undefined) {
    throw apiError('invalid_request');
  }
  const rawLength = request.get('Content-Length');
  if (rawLength === undefined || !/^[1-9][0-9]*$/.test(rawLength)) throw apiError('invalid_request');
  const length = Number(rawLength);
  if (!Number.isSafeInteger(length) || length > MAX_COMPONENT_ARTIFACT_BYTES) {
    throw apiError('limit_exceeded');
  }
  const bytes = rawBody(request);
  if (bytes.byteLength !== length) throw apiError('invalid_request');
  return bytes;
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

function sendComponentArtifact(response: Response, sha256: string, bytes: Uint8Array): void {
  const body = Buffer.from(bytes);
  response.removeHeader('Pragma');
  response.set({
    'Cache-Control': 'public, max-age=31536000, immutable',
    'Content-Length': String(body.byteLength),
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'Content-Type': 'application/javascript; charset=utf-8',
    'Cross-Origin-Resource-Policy': 'cross-origin',
    ETag: `"${sha256}"`,
  });
  response.status(200).send(body);
}

function sendError(response: Response, requestId: string, error: unknown): void {
  const api = error instanceof ApiError ? error : apiError('temporarily_unavailable');
  if (api.retryAfterSeconds !== null) response.set('Retry-After', String(api.retryAfterSeconds));
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
  admission: AdmissionTicket | null,
): Promise<void> {
  if (request.originalUrl.includes('?')) throw apiError('invalid_request');
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
    sendJson(response, 200, { keys: dependencies.config.signingPublicJwks });
    return;
  }

  assertNoCookie(request);
  const componentArtifactMatch = /^\/v1\/components\/([A-Za-z0-9_-]{43})\.js$/.exec(request.path);
  if (componentArtifactMatch !== null && request.method === 'GET') {
    requireEmptyBody(request);
    if (request.headers.authorization !== undefined
      || request.headers['x-firebase-appcheck'] !== undefined
      || request.get('Miakapp-Push-Proof') !== undefined
      || request.get('Range') !== undefined
      || request.get('If-Range') !== undefined) {
      throw apiError('invalid_request');
    }
    const sha256 = digestValue(componentArtifactMatch[1] as string);
    const bytes = await dependencies.componentStore.readPublishedArtifact(sha256);
    sendComponentArtifact(response, sha256, bytes);
    return;
  }

  const componentDeliveryMatch = /^\/v1\/component-uploads\/([A-Za-z0-9_-]{22})$/.exec(request.path);
  if (componentDeliveryMatch !== null && request.method === 'PUT') {
    const ticket = activeAdmission(admission, 'component.upload.deliver');
    const uploadId = keyId(componentDeliveryMatch[1] as string);
    const uploadToken = componentUploadCapability(request);
    const bytes = componentArtifactBody(request);
    ticket.identifySubject(uploadId);
    await dependencies.componentStore.deliverUpload(uploadId, uploadToken, bytes, async (id) => {
      ticket.identifyActor('upload_capability', uploadToken);
      ticket.identifyHome(id);
      await ticket.consume([
        { budget: 'component.upload.delivery.upload', subject: uploadId },
        { budget: 'component.upload.delivery.home', subject: id },
        { budget: 'component.upload.delivery_bytes.home', subject: id, units: bytes.byteLength },
      ]);
    });
    response.sendStatus(204);
    return;
  }

  if (request.path === '/v1/push-destinations:challenge' && request.method === 'POST') {
    const ticket = activeAdmission(admission, 'push.destination.challenge');
    const { owner, appCheck } = await destinationPrincipals(request, dependencies);
    identifyOwner(ticket, owner);
    ticket.identifySubject(appCheck.appId);
    await ticket.consume([
      { budget: 'push.challenge.actor', subject: owner.userId },
      { budget: 'push.challenge.app', subject: appCheck.appId },
    ], ['push.challenge.source']);
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
    const ticket = activeAdmission(admission, 'push.destination.register');
    const { owner, appCheck } = await destinationPrincipals(request, dependencies);
    identifyOwner(ticket, owner);
    emptyObjectBody(request);
    const proof = destinationProof(request.get('Miakapp-Push-Proof'));
    ticket.identifySubject(proof.challengeId);
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
    const ticket = activeAdmission(admission, 'push.destination.delete');
    const { owner } = await destinationPrincipals(request, dependencies);
    identifyOwner(ticket, owner);
    requireEmptyBody(request);
    const destinationId = keyId(destinationDeleteMatch[1] as string);
    ticket.identifySubject(destinationId);
    await dependencies.pushStore.deleteDestination(
      owner,
      destinationId,
    );
    response.sendStatus(204);
    return;
  }

  if (request.path === '/v1/push' && request.method === 'POST') {
    const ticket = activeAdmission(admission, 'push.send');
    const principal = pushPrincipal(request, dependencies);
    ticket.identifyActor('access_token', principal.clientId);
    ticket.identifyHome(principal.homeId);
    const input = pushNotification(jsonBody(request));
    ticket.identifySubject(input.grantId);
    await ticket.consume([
      { budget: 'push.send.key', subject: principal.clientId },
      { budget: 'push.send.home', subject: principal.homeId },
      { budget: 'push.send.grant', subject: input.grantId },
    ]);
    const destination = await dependencies.pushStore.authorizePush(principal, input.grantId);
    await ticket.consume([
      { budget: 'push.send.destination', subject: destination.destinationId },
    ]);
    await dependencies.pushTransport.sendSemanticNotification({
      fid: destination.fid,
      homeId: principal.homeId,
      grantId: input.grantId,
      title: input.notification.title,
      body: input.notification.body,
      tag: input.notification.tag,
    });
    sendJson(response, 202, { schema: 'miakapp.push-accepted/1', request_id: requestId });
    return;
  }

  if (request.path === '/v1/homes' && request.method === 'POST') {
    const ticket = activeAdmission(admission, 'home.create');
    const principal = await ownerPrincipal(request, dependencies);
    requireRecentAuthentication(principal, dependencies.clock.now());
    identifyOwner(ticket, principal);
    const input = homeInput(jsonBody(request));
    ticket.identifyHome(input.homeId);
    ticket.identifySubject(input.homeId);
    await ticket.consume([
      { budget: 'home.create.actor', subject: principal.userId },
    ], ['home.create.source']);
    const home = await dependencies.store.createHome(principal, input);
    sendJson(response, 201, { schema: 'miakapp.home/1', home });
    return;
  }

  const homeMatch = /^\/v1\/homes\/([a-z][a-z0-9-]{1,61}[a-z0-9])$/.exec(request.path);
  if (homeMatch !== null && request.method === 'PATCH') {
    const ticket = activeAdmission(admission, 'home.patch');
    const principal = await ownerPrincipal(request, dependencies);
    identifyOwner(ticket, principal);
    const id = pathHomeId(homeMatch[1] as string);
    ticket.identifyHome(id);
    ticket.identifySubject(id);
    const patch = homePatch(jsonBody(request));
    if (patch.relayUrl !== undefined) requireRecentAuthentication(principal, dependencies.clock.now());
    const home = await dependencies.store.patchHome(principal, id, patch);
    sendJson(response, 200, { schema: 'miakapp.home/1', home });
    return;
  }

  const componentUploadsMatch = /^\/v1\/homes\/([a-z][a-z0-9-]{1,61}[a-z0-9])\/component-uploads$/
    .exec(request.path);
  if (componentUploadsMatch !== null && request.method === 'POST') {
    const ticket = activeAdmission(admission, 'component.upload.issue');
    const id = pathHomeId(componentUploadsMatch[1] as string);
    const principal = await componentPrincipal(request, dependencies, id);
    identifyComponentPublisher(ticket, principal);
    ticket.identifyHome(id);
    ticket.identifySubject(id);
    const input = componentUploadInput(jsonBody(request));
    await ticket.consume([
      { budget: 'component.upload.issue.home', subject: id },
      { budget: 'component.upload.issue_bytes.home', subject: id, units: input.size },
    ]);
    const upload = await dependencies.componentStore.issueUpload(
      principal,
      id,
      input,
    );
    sendJson(response, 201, upload);
    return;
  }

  const componentUploadReadMatch = /^\/v1\/homes\/([a-z][a-z0-9-]{1,61}[a-z0-9])\/component-uploads\/([A-Za-z0-9_-]{22})$/
    .exec(request.path);
  if (componentUploadReadMatch !== null && request.method === 'GET') {
    const id = pathHomeId(componentUploadReadMatch[1] as string);
    const principal = await componentPrincipal(request, dependencies, id);
    requireEmptyBody(request);
    const upload = await dependencies.componentStore.inspectUpload(
      principal,
      id,
      keyId(componentUploadReadMatch[2] as string),
    );
    sendJson(response, 200, upload);
    return;
  }

  const componentFinalizeMatch = /^\/v1\/homes\/([a-z][a-z0-9-]{1,61}[a-z0-9])\/component-uploads\/([A-Za-z0-9_-]{22}):finalize$/
    .exec(request.path);
  if (componentFinalizeMatch !== null && request.method === 'POST') {
    const ticket = activeAdmission(admission, 'component.finalize');
    const id = pathHomeId(componentFinalizeMatch[1] as string);
    const principal = await componentPrincipal(request, dependencies, id);
    identifyComponentPublisher(ticket, principal);
    ticket.identifyHome(id);
    emptyObjectBody(request);
    const uploadId = keyId(componentFinalizeMatch[2] as string);
    ticket.identifySubject(uploadId);
    await ticket.consume([{ budget: 'component.finalize.home', subject: id }]);
    const release = await dependencies.componentStore.finalizeRelease(
      principal,
      id,
      uploadId,
    );
    sendJson(response, 200, release);
    return;
  }

  const componentActivateMatch = /^\/v1\/homes\/([a-z][a-z0-9-]{1,61}[a-z0-9])\/component-releases:activate$/
    .exec(request.path);
  if (componentActivateMatch !== null && request.method === 'POST') {
    const ticket = activeAdmission(admission, 'component.activate');
    const id = pathHomeId(componentActivateMatch[1] as string);
    const principal = await componentPrincipal(request, dependencies, id);
    identifyComponentPublisher(ticket, principal);
    ticket.identifyHome(id);
    const activation = componentActivation(jsonBody(request));
    ticket.identifySubject(activation.sha256);
    await ticket.consume([{ budget: 'component.activate.home', subject: id }]);
    const pointer = await dependencies.componentStore.activateRelease(
      principal,
      id,
      activation,
    );
    sendJson(response, 200, pointer);
    return;
  }

  const componentReleaseReadMatch = /^\/v1\/homes\/([a-z][a-z0-9-]{1,61}[a-z0-9])\/component-releases\/([A-Za-z0-9_-]{43})$/
    .exec(request.path);
  if (componentReleaseReadMatch !== null && request.method === 'GET') {
    const id = pathHomeId(componentReleaseReadMatch[1] as string);
    const principal = await componentPrincipal(request, dependencies, id);
    requireEmptyBody(request);
    const release = await dependencies.componentStore.inspectRelease(
      principal,
      id,
      digestValue(componentReleaseReadMatch[2] as string),
    );
    sendJson(response, 200, release);
    return;
  }

  const keysMatch = /^\/v1\/homes\/([a-z][a-z0-9-]{1,61}[a-z0-9])\/home-keys$/.exec(request.path);
  if (keysMatch !== null && (request.method === 'GET' || request.method === 'POST')) {
    const ticket = request.method === 'POST'
      ? activeAdmission(admission, 'home_key.create')
      : null;
    const principal = await ownerPrincipal(request, dependencies);
    requireRecentAuthentication(principal, dependencies.clock.now());
    const id = pathHomeId(keysMatch[1] as string);
    if (ticket !== null) {
      identifyOwner(ticket, principal);
      ticket.identifyHome(id);
      ticket.identifySubject(id);
    }
    if (request.method === 'GET') {
      requireEmptyBody(request);
      const keys = await dependencies.store.listHomeKeys(principal, id);
      sendJson(response, 200, { schema: 'miakapp.home-key-list/1', keys });
    } else {
      const input = keyCreation(jsonBody(request));
      const created = await dependencies.store.createHomeKey(principal, id, input.label, input.scopes);
      ticket?.identifySubject(created.metadata.key_id);
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
    const ticket = request.method === 'POST'
      ? activeAdmission(admission, 'push.grant.create')
      : null;
    const principal = await ownerPrincipal(request, dependencies);
    const id = pathHomeId(grantsMatch[1] as string);
    if (ticket !== null) {
      identifyOwner(ticket, principal);
      ticket.identifyHome(id);
    }
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
      const destinationId = grantCreation(jsonBody(request));
      ticket?.identifySubject(destinationId);
      const grant = await dependencies.pushStore.createGrant(
        principal,
        id,
        destinationId,
      );
      sendJson(response, 201, { schema: 'miakapp.push-grant/1', grant });
    }
    return;
  }

  const grantDeleteMatch = /^\/v1\/homes\/([a-z][a-z0-9-]{1,61}[a-z0-9])\/push-grants\/([A-Za-z0-9_-]{22})$/
    .exec(request.path);
  if (grantDeleteMatch !== null && request.method === 'DELETE') {
    const ticket = activeAdmission(admission, 'push.grant.revoke');
    const principal = await ownerPrincipal(request, dependencies);
    identifyOwner(ticket, principal);
    requireEmptyBody(request);
    const id = pathHomeId(grantDeleteMatch[1] as string);
    const grantId = keyId(grantDeleteMatch[2] as string);
    ticket.identifyHome(id);
    ticket.identifySubject(grantId);
    await dependencies.pushStore.revokeGrant(
      principal,
      id,
      grantId,
    );
    response.sendStatus(204);
    return;
  }

  const revokeMatch = /^\/v1\/homes\/([a-z][a-z0-9-]{1,61}[a-z0-9])\/home-keys\/([A-Za-z0-9_-]{22})$/
    .exec(request.path);
  if (revokeMatch !== null && request.method === 'DELETE') {
    const ticket = activeAdmission(admission, 'home_key.revoke');
    const principal = await ownerPrincipal(request, dependencies);
    requireRecentAuthentication(principal, dependencies.clock.now());
    identifyOwner(ticket, principal);
    requireEmptyBody(request);
    const id = pathHomeId(revokeMatch[1] as string);
    const revokedKeyId = keyId(revokeMatch[2] as string);
    ticket.identifyHome(id);
    ticket.identifySubject(revokedKeyId);
    await dependencies.store.revokeHomeKey(
      principal,
      id,
      revokedKeyId,
    );
    response.sendStatus(204);
    return;
  }

  if (request.path === '/v1/access-tokens:exchange' && request.method === 'POST') {
    const ticket = activeAdmission(admission, 'access.exchange');
    const authorization = request.headers.authorization;
    if (typeof authorization !== 'string') throw apiError('invalid_home_key');
    const match = /^Bearer ([\x21-\x7e]+)$/.exec(authorization);
    const homeKey = match?.[1];
    if (homeKey === undefined) throw apiError('invalid_home_key');
    const { keyId: exchangedKeyId } = parseHomeKey(homeKey);
    ticket.identifySubject(exchangedKeyId);
    await ticket.consume([
      { budget: 'access.exchange.key', subject: exchangedKeyId },
    ], ['access.exchange.source']);
    const exchange = exchangeRequest(jsonBody(request));
    const { grant, signed } = await dependencies.store.exchangeHomeKey(
      homeKey,
      exchange,
      dependencies.signer,
      async (grant) => {
        ticket.identifyActor('home_key', grant.clientId);
        ticket.identifyHome(grant.homeId);
        await ticket.consume([{ budget: 'access.exchange.home', subject: grant.homeId }]);
      },
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
    const operation = admissionOperation(request);
    let admission: AdmissionTicket | null = null;
    setPrivateHeaders(response);
    try {
      applyCors(request, response, dependencies.config);
      if (operation !== null) {
        admission = await dependencies.admission.open({
          requestId,
          operation,
          source: requestSource(request),
        });
      }
      await routeRequest(request, response, dependencies, requestId, admission);
      if (admission !== null) await admission.finish('ok');
    } catch (error) {
      let responseError = error;
      if (admission !== null) {
        const audit = auditOutcomeFor(error);
        try {
          await admission.finish(audit.outcome, audit.code);
        } catch (auditError) {
          if (!response.headersSent) responseError = auditError;
        }
      }
      if (!response.headersSent) sendError(response, requestId, responseError);
    }
  });
  return app;
}
