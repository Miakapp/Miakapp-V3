import assert from 'node:assert/strict';
import test from 'node:test';

import {
  StagingBrowserRelayTrustedProviderProcessError,
  TRUSTED_PROVIDER_PROCESS_DEFAULT_CANCELLATION_GRACE_MILLISECONDS,
  TRUSTED_PROVIDER_PROCESS_DEFAULT_OPERATION_TIMEOUT_MILLISECONDS,
  TRUSTED_PROVIDER_PROCESS_DEFAULT_READY_TIMEOUT_MILLISECONDS,
  TRUSTED_PROVIDER_PROCESS_MAXIMUM_OWNER_BUNDLE_BYTES,
  TRUSTED_PROVIDER_PROCESS_MAXIMUM_OWNER_BUNDLE_FILE_BYTES,
  TRUSTED_PROVIDER_PROCESS_MAXIMUM_OWNER_BUNDLE_FILES,
  TRUSTED_PROVIDER_PROCESS_MAXIMUM_OWNER_BUNDLE_MANIFEST_BYTES,
  TRUSTED_PROVIDER_PROCESS_MAXIMUM_OWNER_BUNDLE_PATH_BYTES,
  TRUSTED_PROVIDER_PROCESS_MAXIMUM_OWNER_BUNDLE_SEGMENT_BYTES,
  buildTrustedProviderProcessCancel,
  buildTrustedProviderProcessExecute,
  buildTrustedProviderProcessFailure,
  buildTrustedProviderProcessOptions,
  buildTrustedProviderProcessReady,
  buildTrustedProviderProcessResult,
  buildTrustedProviderProcessStartupFailure,
  cloneValidatedTrustedProviderProcessResult,
  normalizeTrustedProviderProcessOptions,
  validateTrustedProviderOwner,
  validateTrustedProviderOwnerModule,
  validateTrustedProviderProcessCancel,
  validateTrustedProviderProcessExecute,
  validateTrustedProviderProcessExecuteInput,
  validateTrustedProviderProcessFailure,
  validateTrustedProviderProcessOptions,
  validateTrustedProviderProcessReady,
  validateTrustedProviderProcessResult,
  validateTrustedProviderProcessStartupFailure,
} from '../contract.mjs';
import { closedOperationResult } from './helpers.mjs';

const DIGEST = 'a'.repeat(64);
const REQUEST_ID = 'A'.repeat(43);
const FULL_OPTIONS = Object.freeze({
  owner_bundle_path: '/tmp/reviewed-owner.mjs',
  owner_bundle_sha256: DIGEST,
  ready_timeout_milliseconds: 50,
  operation_timeout_milliseconds: 500,
  cancellation_grace_milliseconds: 25,
});

function fixedCode(code) {
  return (error) => error instanceof StagingBrowserRelayTrustedProviderProcessError
    && error.code === code
    && error.message === `Trusted provider process failed (${code})`;
}

test('validates exact bounded options and applies reviewed defaults', () => {
  assert.equal(TRUSTED_PROVIDER_PROCESS_MAXIMUM_OWNER_BUNDLE_BYTES, 33_554_432);
  assert.equal(TRUSTED_PROVIDER_PROCESS_MAXIMUM_OWNER_BUNDLE_MANIFEST_BYTES, 262_144);
  assert.equal(TRUSTED_PROVIDER_PROCESS_MAXIMUM_OWNER_BUNDLE_FILES, 512);
  assert.equal(TRUSTED_PROVIDER_PROCESS_MAXIMUM_OWNER_BUNDLE_FILE_BYTES, 8_388_608);
  assert.equal(TRUSTED_PROVIDER_PROCESS_MAXIMUM_OWNER_BUNDLE_PATH_BYTES, 256);
  assert.equal(TRUSTED_PROVIDER_PROCESS_MAXIMUM_OWNER_BUNDLE_SEGMENT_BYTES, 255);
  assert.deepEqual(validateTrustedProviderProcessOptions(FULL_OPTIONS), FULL_OPTIONS);
  assert.deepEqual(buildTrustedProviderProcessOptions({
    owner_bundle_path: FULL_OPTIONS.owner_bundle_path,
    owner_bundle_sha256: DIGEST,
  }), {
    owner_bundle_path: FULL_OPTIONS.owner_bundle_path,
    owner_bundle_sha256: DIGEST,
    ready_timeout_milliseconds: TRUSTED_PROVIDER_PROCESS_DEFAULT_READY_TIMEOUT_MILLISECONDS,
    operation_timeout_milliseconds:
      TRUSTED_PROVIDER_PROCESS_DEFAULT_OPERATION_TIMEOUT_MILLISECONDS,
    cancellation_grace_milliseconds:
      TRUSTED_PROVIDER_PROCESS_DEFAULT_CANCELLATION_GRACE_MILLISECONDS,
  });
  for (const invalid of [
    null,
    { ...FULL_OPTIONS, extra: true },
    { ...FULL_OPTIONS, owner_bundle_path: 'relative.mjs' },
    { ...FULL_OPTIONS, owner_bundle_path: '/tmp/../tmp/owner.mjs' },
    { ...FULL_OPTIONS, owner_bundle_sha256: 'A'.repeat(64) },
    { ...FULL_OPTIONS, ready_timeout_milliseconds: 0 },
    { ...FULL_OPTIONS, operation_timeout_milliseconds: 1.5 },
    { ...FULL_OPTIONS, cancellation_grace_milliseconds: 5_001 },
  ]) assert.throws(() => validateTrustedProviderProcessOptions(invalid), fixedCode('invalid_configuration'));
  assert.deepEqual(normalizeTrustedProviderProcessOptions(FULL_OPTIONS), FULL_OPTIONS);
  assert.deepEqual(normalizeTrustedProviderProcessOptions({
    owner_bundle_path: FULL_OPTIONS.owner_bundle_path,
    owner_bundle_sha256: DIGEST,
  }), buildTrustedProviderProcessOptions({
    owner_bundle_path: FULL_OPTIONS.owner_bundle_path,
    owner_bundle_sha256: DIGEST,
  }));

  let getterCalls = 0;
  const accessor = { ...FULL_OPTIONS };
  Object.defineProperty(accessor, 'owner_bundle_path', {
    enumerable: true,
    get() {
      getterCalls += 1;
      return FULL_OPTIONS.owner_bundle_path;
    },
  });
  const hidden = { ...FULL_OPTIONS };
  Object.defineProperty(hidden, 'hidden', { value: true });
  const symbol = { ...FULL_OPTIONS, [Symbol('hidden')]: true };
  const customPrototype = Object.assign(Object.create({ inherited: true }), FULL_OPTIONS);
  const hostileProxy = new Proxy(FULL_OPTIONS, {
    ownKeys() {
      throw new Error('Bearer caller-secret');
    },
  });
  for (const invalid of [accessor, hidden, symbol, customPrototype, hostileProxy]) {
    assert.throws(
      () => normalizeTrustedProviderProcessOptions(invalid),
      fixedCode('invalid_configuration'),
    );
  }
  assert.equal(getterCalls, 0);
});

test('accepts only an optional AbortSignal execute input', () => {
  assert.deepEqual(validateTrustedProviderProcessExecuteInput(), {});
  const signal = new AbortController().signal;
  assert.equal(validateTrustedProviderProcessExecuteInput({ signal }).signal, signal);
  for (const invalid of [null, [], { extra: true }, { signal: {} }]) {
    assert.throws(
      () => validateTrustedProviderProcessExecuteInput(invalid),
      fixedCode('invalid_configuration'),
    );
  }
  let getterCalls = 0;
  const accessor = {};
  Object.defineProperty(accessor, 'signal', {
    enumerable: true,
    get() {
      getterCalls += 1;
      return signal;
    },
  });
  const hidden = {};
  Object.defineProperty(hidden, 'hidden', { value: true });
  for (const invalid of [accessor, hidden, { signal, [Symbol('hidden')]: true }]) {
    assert.throws(
      () => validateTrustedProviderProcessExecuteInput(invalid),
      fixedCode('invalid_configuration'),
    );
  }
  assert.equal(getterCalls, 0);
});

test('captures only the exact owner factory and hooks', async () => {
  const factory = () => {};
  assert.equal(validateTrustedProviderOwnerModule({
    createBrowserRelayTrustedProviderOwner: factory,
  }), factory);
  assert.throws(
    () => validateTrustedProviderOwnerModule({
      createBrowserRelayTrustedProviderOwner: factory,
      extra: true,
    }),
    fixedCode('owner_contract_failed'),
  );
  const calls = [];
  const originalOwner = {
    async execute() {
      assert.equal(this, originalOwner);
      calls.push('execute');
    },
    async close() {
      assert.equal(this, originalOwner);
      calls.push('close');
    },
  };
  const owner = validateTrustedProviderOwner(originalOwner);
  assert.deepEqual(Object.keys(owner), ['execute', 'close']);
  await owner.execute();
  await owner.close();
  assert.deepEqual(calls, ['execute', 'close']);
  assert.throws(
    () => validateTrustedProviderOwner({ execute() {}, close: true }),
    fixedCode('owner_contract_failed'),
  );
  let getterCalls = 0;
  const accessorModule = {};
  Object.defineProperty(accessorModule, 'createBrowserRelayTrustedProviderOwner', {
    enumerable: true,
    get() {
      getterCalls += 1;
      return factory;
    },
  });
  for (const invalid of [
    accessorModule,
    { createBrowserRelayTrustedProviderOwner: factory, [Symbol('hidden')]: true },
    new Proxy({ createBrowserRelayTrustedProviderOwner: factory }, {}),
  ]) assert.throws(
    () => validateTrustedProviderOwnerModule(invalid),
    fixedCode('owner_contract_failed'),
  );
  assert.equal(getterCalls, 0);
});

test('builds and validates the exact versioned protocol', async () => {
  assert.equal(
    validateTrustedProviderProcessReady(
      buildTrustedProviderProcessReady(DIGEST),
      DIGEST,
    ).type,
    'ready',
  );
  assert.equal(
    validateTrustedProviderProcessStartupFailure(
      buildTrustedProviderProcessStartupFailure('owner_integrity_failed'),
    ),
    'owner_integrity_failed',
  );
  assert.equal(
    validateTrustedProviderProcessExecute(
      buildTrustedProviderProcessExecute(REQUEST_ID),
    ).request_id,
    REQUEST_ID,
  );
  assert.equal(
    validateTrustedProviderProcessCancel(
      buildTrustedProviderProcessCancel(REQUEST_ID),
      REQUEST_ID,
    ).type,
    'cancel',
  );
  assert.equal(
    validateTrustedProviderProcessFailure(
      buildTrustedProviderProcessFailure(REQUEST_ID, 'owner_execution_failed'),
      REQUEST_ID,
    ),
    'owner_execution_failed',
  );
  const result = closedOperationResult();
  const resultMessage = await buildTrustedProviderProcessResult(REQUEST_ID, result);
  assert.deepEqual(
    await validateTrustedProviderProcessResult(resultMessage, REQUEST_ID),
    result,
  );
  assert.notEqual(resultMessage.result, result);
});

test('rejects version, key, ID, code and accessor drift', async () => {
  const execute = buildTrustedProviderProcessExecute(REQUEST_ID);
  for (const invalid of [
    { ...execute, protocol_version: 2 },
    { ...execute, request_id: 'short' },
    { ...execute, extra: true },
    { ...execute, type: 'generic_method' },
  ]) assert.throws(() => validateTrustedProviderProcessExecute(invalid), fixedCode('invalid_protocol'));
  const accessor = {};
  let getterCalls = 0;
  Object.defineProperty(accessor, 'schema', {
    enumerable: true,
    get() {
      getterCalls += 1;
      return execute.schema;
    },
  });
  for (const [key, value] of Object.entries(execute).slice(1)) accessor[key] = value;
  assert.throws(
    () => validateTrustedProviderProcessExecute(accessor),
    fixedCode('invalid_protocol'),
  );
  assert.equal(getterCalls, 0);
  assert.throws(
    () => buildTrustedProviderProcessFailure(REQUEST_ID, 'Bearer secret'),
    fixedCode('invalid_protocol'),
  );
  await assert.rejects(
    validateTrustedProviderProcessResult(
      await buildTrustedProviderProcessResult(REQUEST_ID, closedOperationResult()),
      'B'.repeat(43),
    ),
    fixedCode('invalid_protocol'),
  );
});

test('clones and independently rejects non-closed or private results', async () => {
  const original = closedOperationResult();
  const clone = await cloneValidatedTrustedProviderProcessResult(original);
  assert.deepEqual(clone, original);
  assert.notEqual(clone, original);
  await assert.rejects(
    cloneValidatedTrustedProviderProcessResult({
      ...original,
      secret_value: 'child-only-secret-value',
    }),
    fixedCode('owner_result_invalid'),
  );
  const cyclic = {};
  cyclic.self = cyclic;
  await assert.rejects(
    cloneValidatedTrustedProviderProcessResult(cyclic),
    fixedCode('owner_result_invalid'),
  );
});

test('public errors never preserve hostile codes or child diagnostics', () => {
  const error = new StagingBrowserRelayTrustedProviderProcessError(
    'Bearer child-only-secret-value',
  );
  assert.equal(error.code, 'invalid_configuration');
  assert.equal(error.message, 'Trusted provider process failed (invalid_configuration)');
  assert.doesNotMatch(error.message, /Bearer|child-only/u);
});
