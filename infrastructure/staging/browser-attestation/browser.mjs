import { randomBytes } from 'node:crypto';

import {
  INTERACTIVE_OBSERVATION_DEADLINE_MILLISECONDS,
  RUNNER_URL,
  sha256,
  validateBrowserResult,
} from './contract.mjs';

const MAXIMUM_OBSERVATION_BYTES = 8 * 1024;

export function validateBrowserPreflight(input = process.stdin) {
  if (input?.isTTY !== true
    || typeof input.on !== 'function'
    || typeof input.removeListener !== 'function') {
    throw new Error('Interactive browser attestation requires an attached operator TTY');
  }
  return Object.freeze({
    session: 'operator-connected-interactive',
    observation_channel: 'single-tty-json-line',
  });
}

export function createBrowserChallenge(randomBytesImplementation = randomBytes) {
  const bytes = randomBytesImplementation(32);
  if (!Buffer.isBuffer(bytes) || bytes.byteLength !== 32) {
    throw new Error('Interactive browser challenge generation failed');
  }
  return bytes.toString('hex');
}

export function interactiveRunnerUrl(challenge) {
  if (typeof challenge !== 'string' || !/^[0-9a-f]{64}$/u.test(challenge)) {
    throw new Error('Interactive browser challenge is invalid');
  }
  const url = new URL(RUNNER_URL);
  url.searchParams.set('challenge', challenge);
  return url.toString();
}

export function readBrowserAttestation(
  input,
  challenge,
  deadlineMilliseconds,
  options = {},
) {
  const now = options.now ?? Date.now();
  if (input === null || typeof input?.on !== 'function'
    || typeof input?.removeListener !== 'function'
    || !Number.isFinite(now)
    || !Number.isInteger(deadlineMilliseconds)
    || deadlineMilliseconds <= now
    || deadlineMilliseconds - now > INTERACTIVE_OBSERVATION_DEADLINE_MILLISECONDS) {
    throw new Error('Interactive browser observation boundary is invalid');
  }
  const abortSignal = options.signal;
  if (abortSignal !== undefined && !(abortSignal instanceof AbortSignal)) {
    throw new Error('Interactive browser observation abort signal is invalid');
  }

  return new Promise((resolve, reject) => {
    let buffered = Buffer.alloc(0);
    let settled = false;
    const timer = setTimeout(() => {
      finish(new Error('Interactive browser observation deadline expired'));
    }, deadlineMilliseconds - now);

    function cleanup() {
      clearTimeout(timer);
      input.removeListener('data', onData);
      input.removeListener('end', onEnd);
      input.removeListener('error', onError);
      abortSignal?.removeEventListener('abort', onAbort);
    }

    function finish(error, value) {
      if (settled) return;
      settled = true;
      cleanup();
      if (error === undefined) resolve(value);
      else reject(error);
    }

    function onData(chunk) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (buffered.byteLength + bytes.byteLength > MAXIMUM_OBSERVATION_BYTES) {
        finish(new Error('Interactive browser observation exceeded its reviewed bound'));
        return;
      }
      buffered = Buffer.concat([buffered, bytes]);
      const newline = buffered.indexOf(0x0a);
      if (newline === -1) return;
      const trailing = buffered.subarray(newline + 1).toString('utf8').trim();
      const line = buffered.subarray(0, newline).toString('utf8').replace(/\r$/u, '');
      if (line.length === 0 || trailing.length !== 0) {
        finish(new Error('Interactive browser observation must be exactly one JSON line'));
        return;
      }
      let value;
      try {
        value = JSON.parse(line);
        value = validateBrowserResult(value, challenge);
      } catch {
        finish(new Error('Interactive browser observation did not match the closed semantic shape'));
        return;
      }
      finish(undefined, value);
    }

    function onEnd() {
      finish(new Error('Interactive browser observation ended before a result was received'));
    }

    function onError() {
      finish(new Error('Interactive browser observation channel failed'));
    }

    function onAbort() {
      finish(new Error('Interactive browser observation was interrupted'));
    }

    input.on('data', onData);
    input.on('end', onEnd);
    input.on('error', onError);
    abortSignal?.addEventListener('abort', onAbort, { once: true });
    input.resume?.();
    if (abortSignal?.aborted === true) onAbort();
  });
}

export function sanitizedBrowserResult(result) {
  if (result?.state !== 'passed') {
    throw new Error('Only a successful browser attestation can be sanitized as evidence');
  }
  return Object.freeze({
    schema: result.schema,
    state: result.state,
    session: 'operator-connected-interactive',
    observation_channel: 'single-tty-json-line',
    attestation_attempts: result.attestation_attempts,
    token_format: result.token_format,
    token_ttl_seconds: result.token_ttl_seconds,
    duration_milliseconds: result.duration_milliseconds,
    challenge_sha256: sha256(Buffer.from(result.challenge, 'utf8')),
    raw_token_returned: false,
    raw_browser_error_returned: false,
  });
}
