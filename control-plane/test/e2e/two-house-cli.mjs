// Two houses, two different interfaces, published and rolled back with the
// public `miakapp` CLI against the real control plane — no platform source
// edited, no platform build or deploy between houses.
//
// Runs inside `firebase emulators:exec` (see run-two-house-cli.sh). The CLI is
// the built package binary, unmodified: it reaches the emulated control plane
// at its configured issuer, https://control.example.test, through a local
// CONNECT proxy and a TLS terminator whose certificate comes from a throwaway
// CA created for this run (NODE_USE_ENV_PROXY + NODE_EXTRA_CA_CERTS). Every
// credential is synthetic and lives in a temporary directory deleted at exit;
// no key or code is ever printed.

import { execFileSync, spawn } from 'node:child_process';
import { createHash, createPrivateKey, sign } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const CLI = process.env.MIAKAPP_CLI_BIN;
if (CLI === undefined || CLI === '') throw new Error('MIAKAPP_CLI_BIN must name the built miakapp CLI');

const PROJECT_ID = 'demo-miakapp-v4';
const ISSUER = 'https://control.example.test';
const ORIGIN = 'https://app.example.test';
const API_BASE = `http://${process.env.FUNCTIONS_EMULATOR_HOST}/${PROJECT_ID}/europe-west1/controlPlaneApi`;
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const { loadEmulatorConfig } = await import('../../lib/config.js');
const config = loadEmulatorConfig({ FUNCTIONS_EMULATOR: 'true', GCLOUD_PROJECT: PROJECT_ID });

const work = mkdtempSync(join(tmpdir(), 'miakapp-two-house-'));
const steps = [];
function step(text) {
  steps.push(text);
  process.stdout.write(`✓ ${text}\n`);
}

// ---------------------------------------------------------------------------
// HTTPS for control.example.test, terminated locally and forwarded verbatim.

function tls() {
  const run = (...args) => execFileSync('openssl', args, { cwd: work, stdio: 'ignore' });
  run('req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=miakapp e2e test CA',
    '-keyout', 'ca.key', '-out', 'ca.pem', '-addext', 'basicConstraints=critical,CA:TRUE',
    '-addext', 'keyUsage=critical,keyCertSign');
  run('req', '-newkey', 'rsa:2048', '-nodes', '-subj', '/CN=control.example.test',
    '-keyout', 'server.key', '-out', 'server.csr');
  writeFileSync(join(work, 'server.ext'), 'subjectAltName=DNS:control.example.test\n');
  run('x509', '-req', '-in', 'server.csr', '-CA', 'ca.pem', '-CAkey', 'ca.key', '-CAcreateserial',
    '-days', '1', '-out', 'server.pem', '-extfile', 'server.ext');
  return {
    ca: join(work, 'ca.pem'),
    key: readFileSync(join(work, 'server.key')),
    cert: readFileSync(join(work, 'server.pem')),
  };
}

async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server.address().port;
}

const material = tls();
const terminator = createHttpsServer({ key: material.key, cert: material.cert }, (request, response) => {
  const chunks = [];
  request.on('data', (chunk) => chunks.push(chunk));
  request.on('end', async () => {
    const headers = { ...request.headers };
    for (const name of ['host', 'connection', 'content-length', 'transfer-encoding']) delete headers[name];
    const body = chunks.length === 0 ? undefined : Buffer.concat(chunks);
    try {
      const upstream = await fetch(`${API_BASE}${request.url}`, {
        method: request.method,
        headers,
        ...(body === undefined || request.method === 'GET' ? {} : { body }),
        redirect: 'manual',
      });
      const bytes = Buffer.from(await upstream.arrayBuffer());
      const forwarded = {};
      upstream.headers.forEach((value, name) => {
        if (!['content-length', 'content-encoding', 'transfer-encoding', 'connection'].includes(name)) {
          forwarded[name] = value;
        }
      });
      response.writeHead(upstream.status, { ...forwarded, 'content-length': bytes.byteLength });
      response.end(bytes);
    } catch {
      response.writeHead(502).end();
    }
  });
});
const terminatorPort = await listen(terminator);

const tunnel = createHttpServer((_request, response) => response.writeHead(405).end());
tunnel.on('connect', (request, client) => {
  if (request.url !== 'control.example.test:443') {
    client.end('HTTP/1.1 403 Forbidden\r\n\r\n');
    return;
  }
  const upstream = connect(terminatorPort, '127.0.0.1', () => {
    client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    upstream.pipe(client);
    client.pipe(upstream);
  });
  upstream.on('error', () => client.destroy());
  client.on('error', () => upstream.destroy());
});
const tunnelPort = await listen(tunnel);

// ---------------------------------------------------------------------------
// The public CLI, as an agent runs it.

const configDir = join(work, 'miakapp-config');
const secrets = [];

function cli(args, { input, cwd } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd: cwd ?? work,
      env: {
        PATH: process.env.PATH,
        HOME: work,
        MIAKAPP_CONFIG_DIR: configDir,
        HTTPS_PROXY: `http://127.0.0.1:${tunnelPort}`,
        NO_PROXY: '',
        NODE_USE_ENV_PROXY: '1',
        NODE_EXTRA_CA_CERTS: material.ca,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (code) => {
      for (const secret of secrets) {
        assert.ok(!stdout.includes(secret) && !stderr.includes(secret), `CLI output leaked a secret (${args[0]})`);
      }
      assert.ok(!/mhk1_[A-Za-z0-9_-]{10}/u.test(stdout + stderr), `CLI output contains a Home Key (${args[0]})`);
      resolve({ code, stdout, stderr });
    });
    child.stdin.end(input ?? '');
  });
}

async function cliJson(args, options) {
  const result = await cli([...args, '--json'], options);
  assert.equal(result.code, 0, `miakapp ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  return JSON.parse(result.stdout);
}

// ---------------------------------------------------------------------------
// Owners and a resident, as the browser would act for them.

async function signUp(email) {
  const response = await fetch(
    `http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=synthetic-api-key`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'synthetic-password-123', returnSecureToken: true }),
    },
  );
  const body = await response.json();
  assert.equal(response.ok, true, 'auth emulator sign-up failed');
  return body.idToken;
}

function appCheckToken() {
  const fixture = JSON.parse(readFileSync(
    new URL('../../../control-plane-contract/fixtures/v1/access-tokens.json', import.meta.url),
    'utf8',
  ));
  const key = fixture.test_only_private_keys.firebase;
  const now = Math.floor(Date.now() / 1_000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: key.kid, typ: 'JWT' })).toString('base64url');
  const claims = Buffer.from(JSON.stringify({
    iss: config.appCheckIssuer, aud: [config.appCheckAudience], sub: config.appCheckAppId, iat: now, exp: now + 3_600,
  })).toString('base64url');
  const input = `${header}.${claims}`;
  const signature = sign('RSA-SHA256', Buffer.from(input), createPrivateKey({ key, format: 'jwk' }));
  return `${input}.${signature.toString('base64url')}`;
}

async function api(method, path, { token, body, appCheck } = {}) {
  const headers = { Origin: ORIGIN };
  if (token !== undefined) headers.Authorization = `Bearer ${token}`;
  if (appCheck !== undefined) headers['X-Firebase-AppCheck'] = appCheck;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return { status: response.status, body: text === '' ? null : JSON.parse(text) };
}

async function createHomeAndCode(token, homeId, name) {
  const created = await api('POST', '/v1/homes', {
    token,
    body: { home_id: homeId, name, icon: 'house', relay_url: `wss://${homeId}-relay.example.test/ws` },
  });
  assert.equal(created.status, 201, `home ${homeId} was not created`);
  const issued = await api('POST', `/v1/homes/${homeId}/pairing-codes`, {
    token,
    body: { access: 'full_home', confirmation: `grant-full-home-access:${homeId}` },
  });
  assert.equal(issued.status, 201, `pairing code for ${homeId} was not issued`);
  secrets.push(issued.body.code);
  return issued.body.code;
}

// Two different interfaces: one classic-script IIFE each, nothing shared.
const HOUSE_A_V1 = `(function () {
  var home = window.miakapp;
  var style = document.createElement('style');
  style.textContent = 'body{margin:0;font-family:Georgia,serif;background:#f6efe4}main{display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:16px}';
  document.head.append(style);
  var main = document.createElement('main');
  main.dataset.house = 'a-v1';
  document.body.append(main);
  home.state.subscribe(function () { main.textContent = home.home.name; });
})();
`;
const HOUSE_A_V2 = HOUSE_A_V1.replace("'a-v1'", "'a-v2'").replace('#f6efe4', '#e4f0f6');
const HOUSE_B = `(function () {
  var nav = document.createElement('nav');
  ['Rooms', 'Energy', 'Security'].forEach(function (label) {
    var link = document.createElement('a'); link.href = '#' + label.toLowerCase(); link.textContent = label; nav.append(link);
  });
  var section = document.createElement('section');
  section.dataset.house = 'b';
  document.body.append(nav, section);
  window.addEventListener('hashchange', function () { section.textContent = location.hash; });
})();
`;

function writeProject(dir, source) {
  mkdirSync(join(dir, 'dist'), { recursive: true });
  writeFileSync(join(dir, 'dist', 'app.js'), source);
  return createHash('sha256').update(source).digest('base64url');
}

try {
  const ownerA = await signUp('owner-a@example.test');
  const ownerB = await signUp('owner-b@example.test');
  const resident = await signUp('resident@example.test');
  const appCheck = appCheckToken();

  const codeA = await createHomeAndCode(ownerA, 'house-a', 'House A');
  const codeB = await createHomeAndCode(ownerB, 'house-b', 'House B');
  step('two owners created two homes and issued one-time pairing codes (test accounts)');

  for (const [code, name] of [[codeA, 'house-a'], [codeB, 'house-b']]) {
    const paired = await cliJson(['pair', '--issuer', ISSUER, '--name', name], { input: `${code}\n` });
    assert.equal(paired.home_id, name);
  }
  const contexts = await cliJson(['context', 'list']);
  assert.deepEqual(contexts.contexts.map((entry) => entry.name).sort(), ['house-a', 'house-b']);
  assert.equal(statSync(join(configDir, 'credentials.json')).mode & 0o777, 0o600);
  step('miakapp pair (code on stdin) stored two contexts in a private ~/.miakapp');

  const dirA = join(work, 'house-a');
  const dirB = join(work, 'house-b');
  mkdirSync(dirA);
  mkdirSync(dirB);
  for (const [dir, context] of [[dirA, 'house-a'], [dirB, 'house-b']]) {
    const init = await cliJson(['init', '--context', context, '--release', '2026.10.03-1'], { cwd: dir });
    assert.equal(init.kind, 'app');
  }
  const shaA1 = writeProject(dirA, HOUSE_A_V1);
  const shaB = writeProject(dirB, HOUSE_B);
  for (const dir of [dirA, dirB]) {
    const checked = await cliJson(['check'], { cwd: dir });
    assert.equal(checked.abi, 'miakapp.app/1');
  }
  step('miakapp init (app by default) and miakapp check for both houses');

  const publishedA = await cliJson(['publish', '--context', 'house-a'], { cwd: dirA });
  const publishedB = await cliJson(['publish', '--context', 'house-b'], { cwd: dirB });
  for (const [published, home, sha] of [[publishedA, 'house-a', shaA1], [publishedB, 'house-b', shaB]]) {
    assert.equal(published.abi, 'miakapp.app/1');
    assert.equal(published.sha256, sha);
    assert.equal(published.generation, 1);
    assert.equal(published.home_url, `${ORIGIN}/app?home=${home}`);
    assert.equal(published.url, `${ISSUER}/v1/components/${sha}.js`);
    assert.notEqual(published.home_url, published.url);
  }
  step('miakapp publish: both houses live at generation 1 with their own home_url');

  async function residentView(home) {
    const read = await api('GET', `/v1/homes/${home}/interface`, { token: resident, appCheck });
    assert.equal(read.status, 200, `resident read of ${home} failed`);
    return read.body;
  }
  let viewA = await residentView('house-a');
  let viewB = await residentView('house-b');
  assert.equal(viewA.pointer.sha256, shaA1);
  assert.equal(viewB.pointer.sha256, shaB);
  assert.equal(viewA.home_url, publishedA.home_url);
  const served = await fetch(`${API_BASE}/v1/components/${shaB}.js`, { headers: { Origin: ORIGIN } });
  assert.equal(Buffer.from(await served.arrayBuffer()).toString('utf8'), HOUSE_B);
  step('a signed-in resident (not an owner) reads each live interface; served bytes match');

  writeFileSync(join(dirA, 'dist', 'app.js'), HOUSE_A_V2);
  const shaA2 = createHash('sha256').update(HOUSE_A_V2).digest('base64url');
  const updatedA = await cliJson(['publish', '--context', 'house-a', '--release', '2026.10.03-2'], { cwd: dirA });
  assert.equal(updatedA.generation, 2);
  assert.equal(updatedA.sha256, shaA2);
  const statusB = await cliJson(['status', '--context', 'house-b'], { cwd: dirB });
  assert.equal(statusB.generation, 1);
  assert.equal(statusB.sha256, shaB);
  viewB = await residentView('house-b');
  assert.equal(viewB.pointer.sha256, shaB);
  step('house A republished (generation 2); house B unchanged');

  const rolledBack = await cliJson(['rollback', '--context', 'house-a', '--sha256', shaA1], { cwd: dirA });
  assert.equal(rolledBack.generation, 3);
  assert.equal(rolledBack.sha256, shaA1);
  const statusA = await cliJson(['status', '--context', 'house-a'], { cwd: dirA });
  assert.equal(statusA.sha256, shaA1);
  assert.equal(statusA.home_url, `${ORIGIN}/app?home=house-a`);
  viewA = await residentView('house-a');
  assert.equal(viewA.pointer.sha256, shaA1);
  assert.equal((await cliJson(['status', '--context', 'house-b'], { cwd: dirB })).sha256, shaB);
  step('miakapp rollback restored house A v1 (generation 3); house B still unchanged');

  const crossed = await cli(['publish', '--context', 'house-b'], { cwd: dirA });
  assert.notEqual(crossed.code, 0);
  assert.equal((await residentView('house-a')).pointer.sha256, shaA1);
  step("house B's credential cannot publish into house A's project");

  process.stdout.write(`\nTWO-HOUSE CLI PROOF PASSED (${steps.length} steps)\n`);
} finally {
  terminator.close();
  tunnel.close();
  rmSync(work, { recursive: true, force: true });
}
