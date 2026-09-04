import { readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';

const [controlMetadataFile, relayMetadataFile, homeKeyFile] = process.argv.slice(2);
if (controlMetadataFile === undefined
  || relayMetadataFile === undefined
  || homeKeyFile === undefined) {
  throw new Error('Usage: node setup-relay-integration.mjs <control-metadata> <relay-metadata> <home-key-file>');
}

function metadata(file, schema) {
  const value = JSON.parse(readFileSync(file, 'utf8'));
  if (value === null || Array.isArray(value) || typeof value !== 'object' || value.schema !== schema) {
    throw new Error('Relay integration metadata is invalid');
  }
  return value;
}

const control = metadata(controlMetadataFile, 'miakapp.relay-integration-control/1');
const relay = metadata(relayMetadataFile, 'miakapp.relay-integration-relay/1');
if (typeof control.controlUrl !== 'string'
  || typeof relay.relayUrl !== 'string'
  || !relay.relayUrl.startsWith('wss://127.0.0.1:')
  || !relay.relayUrl.endsWith('/ws')) {
  throw new Error('Relay integration endpoints are invalid');
}

const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
if (authHost === undefined || !/^127\.0\.0\.1:[0-9]+$/.test(authHost)) {
  throw new Error('Firebase Auth Emulator is required');
}
const signUp = await fetch(
  `http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=synthetic-api-key`,
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'relay-integration-owner@example.test',
      password: 'synthetic-password-123',
      returnSecureToken: true,
    }),
  },
);
const signedUp = await signUp.json();
if (!signUp.ok || typeof signedUp.idToken !== 'string') {
  throw new Error(`Synthetic Auth signup failed with HTTP ${signUp.status}`);
}

async function controlRequest(path, body) {
  const response = await fetch(`${control.controlUrl}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${signedUp.idToken}`,
      'Content-Type': 'application/json',
      Origin: 'https://app.example.test',
    },
    body: JSON.stringify(body),
    cache: 'no-store',
    credentials: 'omit',
    redirect: 'error',
    referrerPolicy: 'no-referrer',
  });
  if (!response.ok) {
    const failure = await response.json().catch(() => undefined);
    const code = typeof failure?.error?.code === 'string' ? ` (${failure.error.code})` : '';
    throw new Error(`Control-plane setup failed with HTTP ${response.status}${code}`);
  }
  return response.json();
}

const createdHome = await controlRequest('/v1/homes', {
  home_id: 'synthetic-relay-home',
  name: 'Synthetic Relay Home',
  icon: 'house',
  relay_url: relay.relayUrl,
});
if (createdHome.schema !== 'miakapp.home/1'
  || createdHome.home?.relay_url !== relay.relayUrl) {
  throw new Error('Control plane returned an invalid home');
}

const createdKey = await controlRequest('/v1/homes/synthetic-relay-home/home-keys', {
  label: 'Synthetic relay coordinator',
  scopes: ['relay:coordinator'],
});
if (createdKey.schema !== 'miakapp.home-key-created/1'
  || typeof createdKey.home_key !== 'string'
  || !/^mhk1_[A-Za-z0-9_-]{22}_[A-Za-z0-9_-]{43}$/.test(createdKey.home_key)) {
  throw new Error('Control plane returned an invalid Home Key');
}
writeFileSync(homeKeyFile, createdKey.home_key, { encoding: 'ascii', mode: 0o600 });
process.stdout.write(`${JSON.stringify({
  schema: 'miakapp.relay-integration-setup/1',
  home: 'created',
  homeKey: 'created',
})}\n`);
