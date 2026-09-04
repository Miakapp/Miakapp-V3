import { readFileSync, writeFileSync } from 'node:fs';
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

function requiredEnvironment(name) {
  const value = process.env[name];
  if (value === undefined || value.length === 0) throw new Error(`${name} is required`);
  return value;
}

const certificateFile = requiredEnvironment('MIAKAPP_INTEGRATION_CERT_FILE');
const privateKeyFile = requiredEnvironment('MIAKAPP_INTEGRATION_KEY_FILE');
const metadataFile = requiredEnvironment('MIAKAPP_CONTROL_METADATA_FILE');
const projectId = 'demo-miakapp-v4';
const baseConfig = loadEmulatorConfig({
  FUNCTIONS_EMULATOR: 'true',
  GCLOUD_PROJECT: projectId,
});
const firebase = initializeApp({ projectId }, 'relay-integration-control-plane');
const firestore = getFirestore(firebase);
let application;

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
  signer: new AccessTokenSigner(config),
  store,
  pushStore: new PushStore(firestore, config, SYSTEM_CLOCK),
  pushTransport: Object.freeze({}),
  componentStore,
});
application = express();
application.disable('x-powered-by');
application.use(express.raw({
  inflate: false,
  limit: '2mb',
  type: () => true,
}));
application.use(controlPlane);

writeFileSync(metadataFile, `${JSON.stringify({
  schema: 'miakapp.relay-integration-control/1',
  controlUrl,
  exchangeEndpoint: config.exchangeEndpoint,
  jwksUrl: config.jwksUri,
})}\n`, { encoding: 'utf8', mode: 0o600 });

const shutdown = async () => {
  await new Promise((resolve) => server.close(resolve));
  await deleteApp(firebase);
};
process.once('SIGINT', () => void shutdown().finally(() => process.exit(0)));
process.once('SIGTERM', () => void shutdown().finally(() => process.exit(0)));
