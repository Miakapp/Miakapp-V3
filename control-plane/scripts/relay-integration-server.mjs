import { timingSafeEqual } from 'node:crypto';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:https';
import process from 'node:process';

import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import express from 'express';

import { AdmissionController } from '../lib/admission.js';
import { createControlPlaneApp } from '../lib/api.js';
import { SyntheticAppCheckVerifier } from '../lib/app-check.js';
import { ComponentStore } from '../lib/component-store.js';
import { loadEmulatorConfig } from '../lib/config.js';
import { AccessTokenSigner } from '../lib/crypto.js';
import { PushStore } from '../lib/push-store.js';
import { ControlPlaneStore } from '../lib/store.js';
import { SYSTEM_CLOCK } from '../lib/types.js';

process.umask(0o077);

function requiredEnvironment(name) {
  const value = process.env[name];
  if (value === undefined || value.length === 0) throw new Error(`${name} is required`);
  return value;
}

function privateSecret(file) {
  const value = readFileSync(file, 'ascii').trim();
  if (!/^[0-9a-f]{64}$/.test(value)) throw new Error('Integration control secret is invalid');
  return Buffer.from(value, 'ascii');
}

function sameSecret(header, expected) {
  if (typeof header !== 'string') return false;
  const match = /^Bearer ([0-9a-f]{64})$/.exec(header);
  if (match?.[1] === undefined) return false;
  const actual = Buffer.from(match[1], 'ascii');
  return actual.byteLength === expected.byteLength && timingSafeEqual(actual, expected);
}

function exactObject(value, keys) {
  return value !== null
    && !Array.isArray(value)
    && typeof value === 'object'
    && Object.keys(value).length === keys.length
    && keys.every((key) => Object.hasOwn(value, key));
}

const certificateFile = requiredEnvironment('MIAKAPP_INTEGRATION_CERT_FILE');
const privateKeyFile = requiredEnvironment('MIAKAPP_INTEGRATION_KEY_FILE');
const metadataFile = requiredEnvironment('MIAKAPP_CONTROL_METADATA_FILE');
const evidenceFile = requiredEnvironment('MIAKAPP_CONTROL_EVIDENCE_FILE');
const controlSecret = privateSecret(requiredEnvironment('MIAKAPP_CONTROL_SECRET_FILE'));
const projectId = 'demo-miakapp-v4';
const baseConfig = loadEmulatorConfig({
  FUNCTIONS_EMULATOR: 'true',
  GCLOUD_PROJECT: projectId,
});
const fixture = JSON.parse(readFileSync(
  new URL('../../control-plane-contract/fixtures/v1/access-tokens.json', import.meta.url),
  'utf8',
));
if (fixture?.provenance?.kind !== 'hand_authored_synthetic'
  || fixture.provenance.contains_production_data !== false
  || fixture?.test_only_private_keys?.warning
    !== 'SYNTHETIC TEST KEYS. NEVER LOAD IN PRODUCTION.') {
  throw new Error('Relay integration fixture is not explicitly synthetic');
}

const publication = Object.freeze({
  initial: Object.freeze(fixture.key_sets.initial.keys.map((key) => Object.freeze({ ...key }))),
  prepublished: Object.freeze(
    fixture.key_sets.prepublished.keys.map((key) => Object.freeze({ ...key })),
  ),
  activated: Object.freeze(fixture.key_sets.rotated.keys.map((key) => Object.freeze({ ...key }))),
});
const currentPrivateJwk = Object.freeze({ ...fixture.test_only_private_keys.current });
const futurePrivateJwk = Object.freeze({ ...fixture.test_only_private_keys.future });
const currentPublicJwk = publication.initial.find((key) => key.kid === currentPrivateJwk.kid);
const futurePublicJwk = publication.activated.find((key) => key.kid === futurePrivateJwk.kid);
if (publication.initial.length !== 1
  || publication.prepublished.length !== 2
  || publication.activated.length !== 2
  || currentPublicJwk === undefined
  || futurePublicJwk === undefined
  || currentPublicJwk.x !== currentPrivateJwk.x
  || futurePublicJwk.x !== futurePrivateJwk.x) {
  throw new Error('Relay integration rotation topology is invalid');
}

const firebase = initializeApp({ projectId }, 'relay-integration-control-plane');
const firestore = getFirestore(firebase);
let application;
let phase = 'initial';
let failJwks = false;
let heldJwks;
let releaseHeldJwks;
const jwksCounters = {
  requests: 0,
  conditionalRequests: 0,
  inFlight: 0,
  maximumInFlight: 0,
  response200: 0,
  response304: 0,
  response503: 0,
  responseOther: 0,
};

function state() {
  return {
    schema: 'miakapp.relay-integration-jwks/1',
    phase,
    held: heldJwks !== undefined,
    failing: failJwks,
    jwks: {
      requests: jwksCounters.requests,
      conditional_requests: jwksCounters.conditionalRequests,
      in_flight: jwksCounters.inFlight,
      maximum_in_flight: jwksCounters.maximumInFlight,
      responses: {
        ok: jwksCounters.response200,
        not_modified: jwksCounters.response304,
        unavailable: jwksCounters.response503,
        other: jwksCounters.responseOther,
      },
    },
  };
}

function writeEvidence() {
  const temporary = `${evidenceFile}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(state())}\n`, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  });
  renameSync(temporary, evidenceFile);
}

function controlError(response, status = 409) {
  response.status(status).json({ error: 'invalid_integration_control' });
}

const server = createServer({
  cert: readFileSync(certificateFile),
  key: readFileSync(privateKeyFile),
}, (request, response) => {
  if (application === undefined) {
    response.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('not ready');
    return;
  }
  application(request, response);
});

await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});
const address = server.address();
if (address === null || typeof address === 'string') throw new Error('Control-plane listener is invalid');
const controlUrl = `https://127.0.0.1:${address.port}`;
const config = Object.freeze({
  ...baseConfig,
  issuer: controlUrl,
  jwksUri: `${controlUrl}/.well-known/jwks.json`,
  exchangeEndpoint: `${controlUrl}/v1/access-tokens:exchange`,
  pushAudience: `${controlUrl}/v1/push`,
  componentsAudience: `${controlUrl}/v1/components`,
  componentUploadBaseUrl: `${controlUrl}/v1/component-uploads`,
  componentArtifactBaseUrl: `${controlUrl}/v1/components`,
  get signingPublicJwk() {
    return phase === 'activated' ? futurePublicJwk : currentPublicJwk;
  },
  get signingPublicJwks() {
    return publication[phase];
  },
  get signingPrivateJwk() {
    return phase === 'activated' ? futurePrivateJwk : currentPrivateJwk;
  },
});
const currentSigner = new AccessTokenSigner({
  issuer: controlUrl,
  signingPublicJwk: currentPublicJwk,
  signingPrivateJwk: currentPrivateJwk,
});
const futureSigner = new AccessTokenSigner({
  issuer: controlUrl,
  signingPublicJwk: futurePublicJwk,
  signingPrivateJwk: futurePrivateJwk,
});
const signer = Object.freeze({
  sign(grant) {
    return phase === 'activated' ? futureSigner.sign(grant) : currentSigner.sign(grant);
  },
});

const admission = new AdmissionController(firestore, config, SYSTEM_CLOCK);
const store = new ControlPlaneStore(firestore, config, SYSTEM_CLOCK);
const componentStore = new ComponentStore(
  firestore,
  Object.freeze({}),
  config,
  SYSTEM_CLOCK,
);
const controlPlane = createControlPlaneApp({
  admission,
  appCheck: new SyntheticAppCheckVerifier(config, SYSTEM_CLOCK),
  auth: getAuth(firebase),
  clock: SYSTEM_CLOCK,
  config,
  signer,
  store,
  pushStore: new PushStore(firestore, config, SYSTEM_CLOCK),
  pushTransport: Object.freeze({}),
  componentStore,
});

application = express();
application.disable('x-powered-by');
application.post(
  '/__integration/control',
  express.json({ inflate: false, limit: '1kb', strict: true, type: 'application/json' }),
  (request, response) => {
    if (!sameSecret(request.headers.authorization, controlSecret)) {
      controlError(response, 401);
      return;
    }
    if (!exactObject(request.body, ['action']) || typeof request.body.action !== 'string') {
      controlError(response, 400);
      return;
    }
    switch (request.body.action) {
      case 'status':
        break;
      case 'prepublish':
        if (phase !== 'initial') return controlError(response);
        phase = 'prepublished';
        break;
      case 'activate':
        if (phase !== 'prepublished') return controlError(response);
        phase = 'activated';
        break;
      case 'hold_jwks':
        if (heldJwks !== undefined) return controlError(response);
        heldJwks = new Promise((resolve) => { releaseHeldJwks = resolve; });
        break;
      case 'release_jwks': {
        if (heldJwks === undefined || releaseHeldJwks === undefined) return controlError(response);
        const release = releaseHeldJwks;
        heldJwks = undefined;
        releaseHeldJwks = undefined;
        release();
        break;
      }
      case 'fail_jwks':
        if (failJwks || heldJwks !== undefined) return controlError(response);
        failJwks = true;
        break;
      case 'recover_jwks':
        if (!failJwks) return controlError(response);
        failJwks = false;
        break;
      default:
        return controlError(response, 400);
    }
    writeEvidence();
    response.json(state());
  },
);
application.use(async (request, response, next) => {
  if (request.method !== 'GET' || request.url !== '/.well-known/jwks.json') {
    next();
    return;
  }
  jwksCounters.requests += 1;
  if (request.headers['if-none-match'] !== undefined) jwksCounters.conditionalRequests += 1;
  jwksCounters.inFlight += 1;
  jwksCounters.maximumInFlight = Math.max(
    jwksCounters.maximumInFlight,
    jwksCounters.inFlight,
  );
  let finalized = false;
  const finish = () => {
    if (finalized) return;
    finalized = true;
    jwksCounters.inFlight -= 1;
    if (response.statusCode === 200) jwksCounters.response200 += 1;
    else if (response.statusCode === 304) jwksCounters.response304 += 1;
    else if (response.statusCode === 503) jwksCounters.response503 += 1;
    else jwksCounters.responseOther += 1;
    writeEvidence();
  };
  response.once('finish', finish);
  response.once('close', finish);
  writeEvidence();
  const hold = heldJwks;
  if (hold !== undefined) await hold;
  if (failJwks) {
    response.set({
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
    });
    response.status(503).json({ error: 'synthetic_jwks_unavailable' });
    return;
  }
  next();
});
application.use(express.raw({
  inflate: false,
  limit: '2mb',
  type: () => true,
}));
application.use(controlPlane);

writeEvidence();
writeFileSync(metadataFile, `${JSON.stringify({
  schema: 'miakapp.relay-integration-control/1',
  controlUrl,
  exchangeEndpoint: config.exchangeEndpoint,
  jwksUrl: config.jwksUri,
})}\n`, { encoding: 'utf8', mode: 0o600 });

const shutdown = async () => {
  releaseHeldJwks?.();
  heldJwks = undefined;
  releaseHeldJwks = undefined;
  await new Promise((resolve) => server.close(resolve));
  await deleteApp(firebase);
};
process.once('SIGINT', () => void shutdown().finally(() => process.exit(0)));
process.once('SIGTERM', () => void shutdown().finally(() => process.exit(0)));
