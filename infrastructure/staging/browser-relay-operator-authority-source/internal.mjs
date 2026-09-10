import { isDeepStrictEqual } from 'node:util';

import {
  OPERATOR_AUTHORITY_SOURCE_COMMAND_TIMEOUT_MILLISECONDS,
  OPERATOR_AUTHORITY_SOURCE_MAXIMUM_AUTHORITY_BYTES,
  OPERATOR_AUTHORITY_SOURCE_MAXIMUM_COMMAND_OUTPUT_BYTES,
  OPERATOR_AUTHORITY_SOURCE_MAXIMUM_RESPONSE_BYTES,
  OPERATOR_AUTHORITY_SOURCE_MAXIMUM_WINDOW_MILLISECONDS,
  OPERATOR_AUTHORITY_SOURCE_REQUEST_TIMEOUT_MILLISECONDS,
  OPERATOR_AUTHORITY_SOURCE_USERINFO_URL,
  cloneOperatorAuthorityCallbackResult,
  rejectOperatorAuthoritySource,
  sha256,
  validateBrowserRelayOperatorAuthoritySourceProfile,
} from './contract.mjs';
import { OPERATOR_USER_SHA256 } from '../workload/contract.mjs';

const IMPLEMENTATION_KEYS = Object.freeze(['clock', 'command', 'fetch']);
const COMMAND_RESULT_KEYS = Object.freeze(['ok', 'stderr', 'stdout']);
const EMAIL = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,63}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;

function plainObject(value) {
  if (value === null || Array.isArray(value) || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, keys) {
  return plainObject(value)
    && isDeepStrictEqual(Object.keys(value).sort(), [...keys].sort());
}

function overwrite(value) {
  if (!Buffer.isBuffer(value)) return;
  try {
    value.fill(0);
  } catch {
    // Buffer overwrite is explicitly best-effort memory hygiene.
  }
}

function currentTime(implementations, previous = undefined) {
  let value;
  try {
    value = implementations.clock();
  } catch {
    rejectOperatorAuthoritySource('invalid_configuration');
  }
  if (!Number.isSafeInteger(value) || value < 0
    || (previous !== undefined && value < previous)) {
    rejectOperatorAuthoritySource('invalid_configuration');
  }
  return value;
}

function validateImplementations(value) {
  if (!exactKeys(value, IMPLEMENTATION_KEYS)
    || IMPLEMENTATION_KEYS.some((key) => typeof value[key] !== 'function')) {
    rejectOperatorAuthoritySource('invalid_configuration');
  }
  const implementations = Object.freeze({
    clock: value.clock,
    command: value.command,
    fetch: value.fetch,
  });
  currentTime(implementations);
  return implementations;
}

function validateOptions(value) {
  if (!plainObject(value) || Object.keys(value).some((key) => key !== 'signal')) {
    rejectOperatorAuthoritySource('invalid_configuration');
  }
  if (value.signal !== undefined && !(value.signal instanceof AbortSignal)) {
    rejectOperatorAuthoritySource('invalid_configuration');
  }
  return value.signal;
}

function operationSignal(externalSignal, closeSignal) {
  const signals = [
    closeSignal,
    AbortSignal.timeout(OPERATOR_AUTHORITY_SOURCE_MAXIMUM_WINDOW_MILLISECONDS),
  ];
  if (externalSignal !== undefined) signals.push(externalSignal);
  return AbortSignal.any(signals);
}

function trimCommandOutput(value) {
  if (!Buffer.isBuffer(value) || value.byteLength > OPERATOR_AUTHORITY_SOURCE_MAXIMUM_COMMAND_OUTPUT_BYTES) {
    rejectOperatorAuthoritySource('command_failed');
  }
  let start = 0;
  let end = value.byteLength;
  while (start < end && [9, 10, 13, 32].includes(value[start])) start += 1;
  while (end > start && [9, 10, 13, 32].includes(value[end - 1])) end -= 1;
  return Buffer.from(value.subarray(start, end));
}

async function runCommand(implementations, args, signal) {
  if (signal.aborted) rejectOperatorAuthoritySource('aborted');
  let result;
  try {
    result = await implementations.command(Object.freeze([...args]), Object.freeze({
      signal,
      timeout_milliseconds: OPERATOR_AUTHORITY_SOURCE_COMMAND_TIMEOUT_MILLISECONDS,
      maximum_output_bytes: OPERATOR_AUTHORITY_SOURCE_MAXIMUM_COMMAND_OUTPUT_BYTES,
    }));
  } catch {
    rejectOperatorAuthoritySource(signal.aborted ? 'aborted' : 'command_failed');
  }
  if (!exactKeys(result, COMMAND_RESULT_KEYS)
    || typeof result.ok !== 'boolean'
    || !Buffer.isBuffer(result.stdout)
    || !Buffer.isBuffer(result.stderr)
    || result.stdout === result.stderr
    || result.stdout.byteLength > OPERATOR_AUTHORITY_SOURCE_MAXIMUM_COMMAND_OUTPUT_BYTES
    || result.stderr.byteLength > OPERATOR_AUTHORITY_SOURCE_MAXIMUM_COMMAND_OUTPUT_BYTES) {
    overwrite(result?.stdout);
    overwrite(result?.stderr);
    rejectOperatorAuthoritySource('command_failed');
  }
  try {
    if (!result.ok || signal.aborted) {
      rejectOperatorAuthoritySource(signal.aborted ? 'aborted' : 'command_failed');
    }
    return trimCommandOutput(result.stdout);
  } finally {
    overwrite(result.stdout);
    overwrite(result.stderr);
  }
}

function utf8(value, code) {
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(value);
  } catch {
    rejectOperatorAuthoritySource(code);
  } finally {
    overwrite(value);
  }
  return text;
}

function validateToken(value) {
  if (!Buffer.isBuffer(value) || value.byteLength < 20
    || value.byteLength > OPERATOR_AUTHORITY_SOURCE_MAXIMUM_AUTHORITY_BYTES
    || value.some((byte) => byte < 0x21 || byte > 0x7e)) {
    overwrite(value);
    rejectOperatorAuthoritySource('invalid_token');
  }
  return value;
}

function cancelResponse(response) {
  try {
    response?.body?.cancel()?.catch(() => undefined);
  } catch {
    // The fixed failure code remains the only public diagnostic.
  }
}

async function responseBytes(response, signal) {
  const contentLength = response?.headers?.get?.('content-length');
  if (contentLength !== null && contentLength !== undefined
    && (!/^(?:0|[1-9][0-9]*)$/u.test(contentLength)
      || Number(contentLength) > OPERATOR_AUTHORITY_SOURCE_MAXIMUM_RESPONSE_BYTES)) {
    cancelResponse(response);
    rejectOperatorAuthoritySource('invalid_principal');
  }
  let reader;
  try {
    reader = response?.body?.getReader();
  } catch {
    rejectOperatorAuthoritySource('invalid_principal');
  }
  if (reader === undefined) rejectOperatorAuthoritySource('invalid_principal');
  const chunks = [];
  let size = 0;
  let complete = false;
  let output;
  const cancel = () => {
    try {
      reader.cancel()?.catch?.(() => undefined);
    } catch {
      // Cancellation is best-effort; the fixed operation error remains authoritative.
    }
  };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    while (true) {
      if (signal.aborted) rejectOperatorAuthoritySource('aborted');
      const { done, value } = await reader.read();
      if (signal.aborted) rejectOperatorAuthoritySource('aborted');
      if (done) break;
      if (!(value instanceof Uint8Array)
        || size + value.byteLength > OPERATOR_AUTHORITY_SOURCE_MAXIMUM_RESPONSE_BYTES) {
        rejectOperatorAuthoritySource('invalid_principal');
      }
      const chunk = Buffer.from(value);
      chunks.push(chunk);
      size += chunk.byteLength;
    }
    if (size === 0) rejectOperatorAuthoritySource('invalid_principal');
    output = Buffer.concat(chunks, size);
    complete = true;
    return output;
  } catch (error) {
    if (error?.name === 'StagingBrowserRelayOperatorAuthoritySourceError') throw error;
    rejectOperatorAuthoritySource(signal.aborted ? 'aborted' : 'invalid_principal');
  } finally {
    for (const chunk of chunks) overwrite(chunk);
    signal.removeEventListener('abort', cancel);
    if (!complete) cancel();
    try {
      reader.releaseLock();
    } catch {
      // Reader cleanup must not replace the fixed public result or failure code.
    }
  }
}

async function verifyPrincipal(
  implementations,
  authority,
  expectedEmail,
  expectedOperatorSha256,
  signal,
) {
  const timeoutSignal = AbortSignal.timeout(OPERATOR_AUTHORITY_SOURCE_REQUEST_TIMEOUT_MILLISECONDS);
  const requestSignal = AbortSignal.any([signal, timeoutSignal]);
  const authorityText = authority.toString('ascii');
  let response;
  try {
    response = await implementations.fetch(OPERATOR_AUTHORITY_SOURCE_USERINFO_URL, {
      method: 'GET',
      headers: Object.freeze({
        Accept: 'application/json',
        Authorization: `Bearer ${authorityText}`,
        'Cache-Control': 'no-store',
        Pragma: 'no-cache',
      }),
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      signal: requestSignal,
    });
  } catch {
    rejectOperatorAuthoritySource(requestSignal.aborted ? 'aborted' : 'principal_request_failed');
  }
  let bytes;
  try {
    bytes = await responseBytes(response, requestSignal);
    let principal;
    try {
      principal = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } catch {
      rejectOperatorAuthoritySource('invalid_principal');
    }
    if (response.status !== 200 || !plainObject(principal)
      || typeof principal.email !== 'string' || principal.email !== expectedEmail
      || principal.email_verified !== true
      || sha256(Buffer.from(principal.email, 'utf8')) !== expectedOperatorSha256) {
      rejectOperatorAuthoritySource('invalid_principal');
    }
    return authorityText;
  } finally {
    overwrite(bytes);
  }
}

function createPublicBoundary(consume, close) {
  const boundary = Object.create(null);
  Object.defineProperties(boundary, {
    consume: { value: consume, enumerable: true },
    close: { value: close, enumerable: true },
  });
  return Object.freeze(boundary);
}

export function createBrowserRelayOperatorAuthoritySourceForImplementation(
  value,
  expectedOperatorSha256 = OPERATOR_USER_SHA256,
) {
  validateBrowserRelayOperatorAuthoritySourceProfile();
  const implementations = validateImplementations(value);
  if (!SHA256.test(expectedOperatorSha256)) {
    rejectOperatorAuthoritySource('invalid_configuration');
  }
  const closeController = new AbortController();
  let closed = false;
  let consumed = false;
  let activePromise;

  async function execute(callback, options) {
    const externalSignal = validateOptions(options);
    if (typeof callback !== 'function') rejectOperatorAuthoritySource('invalid_configuration');
    const signal = operationSignal(externalSignal, closeController.signal);
    if (signal.aborted) rejectOperatorAuthoritySource('aborted');
    const startedAt = currentTime(implementations);
    const expiresAt = startedAt + OPERATOR_AUTHORITY_SOURCE_MAXIMUM_WINDOW_MILLISECONDS;
    let accountBytes;
    let impersonationBytes;
    let authority;
    try {
      accountBytes = await runCommand(
        implementations,
        ['config', 'get-value', 'account', '--quiet'],
        signal,
      );
      const account = utf8(accountBytes, 'invalid_principal');
      accountBytes = undefined;
      if (!EMAIL.test(account) || account !== account.toLowerCase()
        || sha256(Buffer.from(account, 'utf8')) !== expectedOperatorSha256) {
        rejectOperatorAuthoritySource('invalid_principal');
      }

      impersonationBytes = await runCommand(
        implementations,
        ['config', 'get-value', 'auth/impersonate_service_account', '--quiet'],
        signal,
      );
      const impersonation = utf8(impersonationBytes, 'invalid_configuration');
      impersonationBytes = undefined;
      if (!['', '(unset)'].includes(impersonation)) {
        rejectOperatorAuthoritySource('invalid_configuration');
      }

      authority = validateToken(await runCommand(
        implementations,
        ['auth', 'print-access-token', `--account=${account}`, '--quiet'],
        signal,
      ));
      const authorityText = await verifyPrincipal(
        implementations,
        authority,
        account,
        expectedOperatorSha256,
        signal,
      );
      const beforeCallback = currentTime(implementations, startedAt);
      if (beforeCallback > expiresAt || signal.aborted) {
        rejectOperatorAuthoritySource(signal.aborted ? 'aborted' : 'window_expired');
      }
      const context = Object.freeze(Object.assign(Object.create(null), {
        expires_at_milliseconds: expiresAt,
        signal,
      }));
      let result;
      try {
        result = await callback(authority, context);
      } catch {
        rejectOperatorAuthoritySource(signal.aborted ? 'aborted' : 'callback_failed');
      }
      const completedAt = currentTime(implementations, beforeCallback);
      if (completedAt > expiresAt || signal.aborted) {
        rejectOperatorAuthoritySource(signal.aborted ? 'aborted' : 'window_expired');
      }
      return cloneOperatorAuthorityCallbackResult(result, authorityText);
    } finally {
      overwrite(accountBytes);
      overwrite(impersonationBytes);
      overwrite(authority);
    }
  }

  function consume(callback, options = {}) {
    if (closed) return Promise.reject(
      new Error('Staging browser-relay operator authority source failed: closed'),
    ).catch(() => rejectOperatorAuthoritySource('closed'));
    if (consumed) return Promise.reject(
      new Error('Staging browser-relay operator authority source failed: already_consumed'),
    ).catch(() => rejectOperatorAuthoritySource('already_consumed'));
    consumed = true;
    activePromise = execute(callback, options);
    activePromise.catch(() => undefined);
    return activePromise;
  }

  async function close() {
    if (!closed) {
      closed = true;
      closeController.abort();
    }
    if (activePromise !== undefined) {
      try {
        await activePromise;
      } catch {
        // Consumption exposes its own fixed failure; close remains idempotent.
      }
    }
    return true;
  }

  return createPublicBoundary(consume, close);
}
