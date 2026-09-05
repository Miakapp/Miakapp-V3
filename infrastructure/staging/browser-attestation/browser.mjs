import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { accessSync, constants } from 'node:fs';
import { createServer } from 'node:http';

import {
  INTERACTIVE_OBSERVATION_DEADLINE_MILLISECONDS,
  RUNNER_URL,
  sha256,
  validateBrowserResult,
} from './contract.mjs';

const LOOPBACK_HOST = '127.0.0.1';
const LOOPBACK_PATH_PREFIX = '/__miakapp/app-check/';
const MAXIMUM_OBSERVATION_BYTES = 8 * 1024;
const SYSTEM_BROWSER_LAUNCHER = '/usr/bin/open';

const LOOPBACK_BRIDGE = Buffer.from(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="referrer" content="no-referrer">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Miakapp staging attestation</title>
  </head>
  <body>
    <main data-state="pending">Returning bounded staging evidence…</main>
    <script>
      (() => {
        const status = document.querySelector('[data-state]');
        const encoded = window.location.hash.slice(1);
        window.history.replaceState(null, '', window.location.pathname);
        let payload = '';
        try {
          payload = decodeURIComponent(encoded);
        } catch {}
        if (payload.length === 0 || new TextEncoder().encode(payload).byteLength > 8192) {
          status.dataset.state = 'failed';
          status.textContent = 'Staging evidence return failed';
          return;
        }
        fetch(window.location.pathname, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
          cache: 'no-store',
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
        }).then((response) => {
          if (!response.ok) throw new Error('closed-loopback-rejection');
          status.dataset.state = 'passed';
          status.textContent = 'Staging attestation received; this tab can be closed';
        }).catch(() => {
          status.dataset.state = 'failed';
          status.textContent = 'Staging evidence return failed';
        });
      })();
    </script>
  </body>
</html>
`, 'utf8');

function observationBoundary(challenge, deadlineMilliseconds, now, signal) {
  if (typeof challenge !== 'string' || !/^[0-9a-f]{64}$/u.test(challenge)
    || !Number.isFinite(now)
    || !Number.isInteger(deadlineMilliseconds)
    || deadlineMilliseconds <= now
    || deadlineMilliseconds - now > INTERACTIVE_OBSERVATION_DEADLINE_MILLISECONDS) {
    throw new Error('System browser observation boundary is invalid');
  }
  if (signal !== undefined && !(signal instanceof AbortSignal)) {
    throw new Error('System browser observation abort signal is invalid');
  }
}

function loopbackHeaders(contentType, contentLength) {
  return {
    'Cache-Control': 'no-store, max-age=0',
    'Content-Length': String(contentLength),
    'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    'Content-Type': contentType,
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
  };
}

function send(response, status, body = Buffer.alloc(0), contentType = 'text/plain; charset=utf-8') {
  response.writeHead(status, loopbackHeaders(contentType, body.byteLength));
  response.end(body);
}

function parseLoopbackCallback(value) {
  let callback;
  try {
    callback = new URL(value);
  } catch {
    throw new Error('System browser loopback callback is invalid');
  }
  const port = Number(callback.port);
  if (callback.protocol !== 'http:'
    || callback.hostname !== LOOPBACK_HOST
    || callback.username !== ''
    || callback.password !== ''
    || !Number.isInteger(port) || port < 1024 || port > 65_535
    || !new RegExp(`^${LOOPBACK_PATH_PREFIX}[0-9a-f]{64}$`, 'u').test(callback.pathname)
    || callback.search !== ''
    || callback.hash !== '') {
    throw new Error('System browser loopback callback is outside the reviewed boundary');
  }
  return callback;
}

export function validateBrowserPreflight(options = {}) {
  const platform = options.platform ?? process.platform;
  const accessImplementation = options.accessImplementation ?? accessSync;
  if (platform !== 'darwin') {
    throw new Error('System browser attestation requires a local macOS operator session');
  }
  try {
    accessImplementation(SYSTEM_BROWSER_LAUNCHER, constants.X_OK);
  } catch {
    throw new Error('The reviewed macOS system browser launcher is unavailable');
  }
  return Object.freeze({
    session: 'macos-default-system-browser',
    observation_channel: 'ephemeral-loopback-fragment-post',
  });
}

export function createBrowserChallenge(randomBytesImplementation = randomBytes) {
  const bytes = randomBytesImplementation(32);
  if (!Buffer.isBuffer(bytes) || bytes.byteLength !== 32) {
    throw new Error('System browser challenge generation failed');
  }
  return bytes.toString('hex');
}

export function interactiveRunnerUrl(challenge, callbackValue) {
  if (typeof challenge !== 'string' || !/^[0-9a-f]{64}$/u.test(challenge)) {
    throw new Error('System browser challenge is invalid');
  }
  const callback = parseLoopbackCallback(callbackValue);
  const url = new URL(RUNNER_URL);
  url.searchParams.set('challenge', challenge);
  url.searchParams.set('callback', callback.toString());
  return url.toString();
}

export function launchSystemBrowser(
  runnerUrl,
  spawnImplementation = spawnSync,
) {
  const parsed = new URL(runnerUrl);
  const parameters = [...parsed.searchParams.keys()].sort();
  const challenge = parsed.searchParams.get('challenge');
  const callback = parsed.searchParams.get('callback');
  if (JSON.stringify(parameters) !== JSON.stringify(['callback', 'challenge'])
    || interactiveRunnerUrl(challenge, callback) !== parsed.toString()) {
    throw new Error('System browser runner URL is outside the reviewed boundary');
  }
  const result = spawnImplementation(SYSTEM_BROWSER_LAUNCHER, [parsed.toString()], {
    shell: false,
    stdio: 'ignore',
    timeout: 10_000,
    windowsHide: true,
  });
  if (result === null || typeof result !== 'object'
    || result.error !== undefined
    || result.signal !== null
    || result.status !== 0) {
    throw new Error('System browser launch failed');
  }
}

export async function observeSystemBrowserAttestation(
  challenge,
  deadlineMilliseconds,
  options = {},
) {
  const now = options.now ?? Date.now();
  const signal = options.signal;
  observationBoundary(challenge, deadlineMilliseconds, now, signal);
  const randomBytesImplementation = options.randomBytesImplementation ?? randomBytes;
  const callbackNonce = createBrowserChallenge(randomBytesImplementation);
  const serverImplementation = options.createServerImplementation ?? createServer;
  const launchImplementation = options.launchImplementation ?? launchSystemBrowser;

  let expectedHost;
  let expectedOrigin;
  let expectedPath;
  let bridgeServed = false;
  let submitted = false;
  let settled = false;
  let timer;
  let resolveObservation;
  let rejectObservation;
  const observation = new Promise((resolve, reject) => {
    resolveObservation = resolve;
    rejectObservation = reject;
  });
  void observation.catch(() => {});

  const server = serverImplementation((request, response) => {
    if (request.socket.remoteAddress !== LOOPBACK_HOST
      || request.headers.host !== expectedHost) {
      send(response, 403);
      return;
    }
    let requestUrl;
    try {
      requestUrl = new URL(request.url ?? '', expectedOrigin);
    } catch {
      send(response, 400);
      return;
    }
    if (requestUrl.pathname !== expectedPath || requestUrl.search !== '') {
      send(response, 404);
      return;
    }
    if (request.method === 'GET') {
      if (bridgeServed || submitted) {
        send(response, 409);
        return;
      }
      bridgeServed = true;
      send(response, 200, LOOPBACK_BRIDGE, 'text/html; charset=utf-8');
      return;
    }
    if (request.method !== 'POST'
      || !bridgeServed
      || submitted
      || request.headers.origin !== expectedOrigin
      || request.headers['content-type'] !== 'application/json') {
      send(response, 405);
      return;
    }
    submitted = true;
    const declaredLength = Number(request.headers['content-length']);
    if (request.headers['content-length'] !== undefined
      && (!Number.isInteger(declaredLength)
        || declaredLength <= 0
        || declaredLength > MAXIMUM_OBSERVATION_BYTES)) {
      send(response, 413);
      finish(new Error('System browser observation exceeded its reviewed bound'));
      return;
    }
    const chunks = [];
    let bytes = 0;
    request.on('data', (chunk) => {
      const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += value.byteLength;
      if (bytes > MAXIMUM_OBSERVATION_BYTES) {
        request.destroy();
        finish(new Error('System browser observation exceeded its reviewed bound'));
      } else {
        chunks.push(value);
      }
    });
    request.once('aborted', () => {
      finish(new Error('System browser observation channel failed'));
    });
    request.once('error', () => {
      finish(new Error('System browser observation channel failed'));
    });
    request.once('end', () => {
      if (settled) return;
      let value;
      try {
        const body = Buffer.concat(chunks, bytes).toString('utf8');
        value = validateBrowserResult(JSON.parse(body), challenge);
      } catch {
        send(response, 400);
        finish(new Error('System browser observation did not match the closed semantic shape'));
        return;
      }
      response.writeHead(204, loopbackHeaders('text/plain; charset=utf-8', 0));
      response.end(() => finish(undefined, value));
    });
  });

  function complete(error, value) {
    if (error === undefined) resolveObservation(value);
    else rejectObservation(error);
  }

  function finish(error, value) {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
    server.removeListener('error', onServerError);
    if (server.listening) {
      server.close(() => complete(error, value));
      server.closeAllConnections?.();
    } else {
      complete(error, value);
    }
  }

  function onAbort() {
    finish(new Error('System browser observation was interrupted'));
  }

  function onServerError() {
    finish(new Error('System browser loopback channel failed'));
  }

  server.requestTimeout = Math.max(1, deadlineMilliseconds - now);
  server.headersTimeout = Math.max(1, deadlineMilliseconds - now);
  server.keepAliveTimeout = 1000;
  server.maxRequestsPerSocket = 2;
  timer = setTimeout(() => {
    finish(new Error('System browser observation deadline expired'));
  }, deadlineMilliseconds - now);
  signal?.addEventListener('abort', onAbort, { once: true });
  if (signal?.aborted === true) onAbort();
  if (settled) return observation;

  const listening = new Promise((resolve, reject) => {
    const onListenError = () => {
      server.removeListener('listening', onListening);
      const error = new Error('System browser loopback channel could not start');
      finish(error);
      reject(error);
    };
    const onListening = () => {
      server.removeListener('error', onListenError);
      if (settled) {
        server.close();
        return;
      }
      server.on('error', onServerError);
      resolve();
    };
    server.once('error', onListenError);
    server.once('listening', onListening);
    server.listen(0, LOOPBACK_HOST);
  });
  await Promise.race([listening, observation]);

  const address = server.address();
  if (address === null || typeof address === 'string'
    || address.address !== LOOPBACK_HOST
    || !Number.isInteger(address.port) || address.port < 1024 || address.port > 65_535) {
    finish(new Error('System browser loopback channel bound outside the reviewed boundary'));
    return observation;
  }
  expectedHost = `${LOOPBACK_HOST}:${address.port}`;
  expectedOrigin = `http://${expectedHost}`;
  expectedPath = `${LOOPBACK_PATH_PREFIX}${callbackNonce}`;
  const callbackUrl = `${expectedOrigin}${expectedPath}`;
  const runnerUrl = interactiveRunnerUrl(challenge, callbackUrl);

  if (!settled) {
    try {
      await launchImplementation(runnerUrl);
    } catch {
      finish(new Error('System browser launch failed'));
    }
  }
  return observation;
}

export function sanitizedBrowserResult(result) {
  if (result?.state !== 'passed') {
    throw new Error('Only a successful browser attestation can be sanitized as evidence');
  }
  return Object.freeze({
    schema: result.schema,
    state: result.state,
    session: 'macos-default-system-browser',
    observation_channel: 'ephemeral-loopback-fragment-post',
    attestation_attempts: result.attestation_attempts,
    token_format: result.token_format,
    token_ttl_seconds: result.token_ttl_seconds,
    duration_milliseconds: result.duration_milliseconds,
    challenge_sha256: sha256(Buffer.from(result.challenge, 'utf8')),
    raw_token_returned: false,
    raw_browser_error_returned: false,
  });
}
