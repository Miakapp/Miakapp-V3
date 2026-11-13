import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';

import { loadProductionRuntimeConfig } from './production-runtime-loader.js';
import { createSelfHostedControlPlane } from './self-hosted-runtime.js';

/**
 * Container entrypoint of the self-hosted control plane.
 *
 *   MIAKAPP_RUNTIME_CONFIG_JSON          the production runtime document
 *   MIAKAPP_SERVICE_ACCOUNT_KEY_FILE     service-account JSON key (Firestore, Auth, App Check)
 *   MIAKAPP_KEY_DIRECTORY                signing keys and HMAC secrets, see self-hosted-runtime.ts
 *   MIAKAPP_COMPONENT_STORAGE_DIRECTORY  persistent volume for component uploads and artifacts
 *   PORT                                 default 8080
 */

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    console.error(JSON.stringify({ event: 'miakapp_control_plane_missing_variable', name }));
    process.exit(1);
  }
  return value;
}

const loaded = loadProductionRuntimeConfig('staging');
const controlPlane = await createSelfHostedControlPlane(loaded.document, {
  serviceAccount: JSON.parse(readFileSync(required('MIAKAPP_SERVICE_ACCOUNT_KEY_FILE'), 'utf8')),
  keyDirectory: required('MIAKAPP_KEY_DIRECTORY'),
  storageDirectory: required('MIAKAPP_COMPONENT_STORAGE_DIRECTORY'),
});

const port = Number(process.env.PORT ?? 8080);
const server = createServer(controlPlane.application);
server.listen(port, () => {
  console.log(JSON.stringify({ event: 'miakapp_control_plane_listening', port, issuer: loaded.config.security.issuer }));
});
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
