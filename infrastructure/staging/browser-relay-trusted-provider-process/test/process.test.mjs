import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  StagingBrowserRelayTrustedProviderProcessError,
  buildTrustedProviderProcessCancel,
  buildTrustedProviderProcessExecute,
} from '../contract.mjs';
import {
  createTrustedProviderProcessFrameWriter,
  readTrustedProviderProcessFrames,
} from '../framed-channel.mjs';
import {
  createBrowserRelayTrustedProviderProcessInternal,
} from '../internal.mjs';
import {
  createBrowserRelayTrustedProviderProcess,
} from '../process.mjs';
import {
  closedOperationResult,
  createBundle,
  hostilePeerBundle,
  ownerBundle,
  playwrightCoreOwnerBundle,
  processExists,
  waitFor,
} from './helpers.mjs';

const HOSTILE_PEER = fileURLToPath(new URL('./fixtures/hostile-peer.mjs', import.meta.url));
const PROCESS_ENTRY_URL = new URL('../process.mjs', import.meta.url).href;
const UNCOOPERATIVE_DESCENDANT = fileURLToPath(
  new URL('./fixtures/uncooperative-descendant.mjs', import.meta.url),
);
const WORKER = fileURLToPath(new URL('../worker.mjs', import.meta.url));
const CANONICAL_TMP_DIRECTORY = realpathSync.native(tmpdir());

function options(bundle, overrides = {}) {
  return Object.freeze({
    owner_bundle_path: bundle.path,
    owner_bundle_sha256: bundle.sha256,
    ready_timeout_milliseconds: 250,
    operation_timeout_milliseconds: 500,
    cancellation_grace_milliseconds: 50,
    ...overrides,
  });
}

function errorCode(code) {
  return (error) => error instanceof StagingBrowserRelayTrustedProviderProcessError
    && error.code === code
    && !/Bearer|child-only|secret-value/u.test(error.message);
}

function registerBundleCleanup(t, bundle) {
  t.after(() => bundle.cleanup());
  return bundle;
}

function assertSuccessfulFreshProcess(source) {
  const outcome = spawnSync(process.execPath, ['--input-type=module', '--eval', source], {
    encoding: 'utf8',
    env: Object.create(null),
    timeout: 2_000,
  });
  assert.equal(outcome.status, 0);
  assert.equal(outcome.signal, null);
  assert.equal(outcome.stdout, '');
  assert.equal(outcome.stderr, '');
}

test('owns the complete synthetic owner lifecycle in a separate closed process', async (t) => {
  const observationDirectory = mkdtempSync(join(tmpdir(), 'miakapp-owner-observation-'));
  const observationPath = join(observationDirectory, 'observation.json');
  t.after(() => rmSync(observationDirectory, { force: true, recursive: true }));
  const bundle = registerBundleCleanup(t, ownerBundle({ observationPath }));
  const ownerProcess = createBrowserRelayTrustedProviderProcess(options(bundle));
  assert.deepEqual(Object.keys(ownerProcess), ['execute', 'close']);
  const result = await ownerProcess.execute();
  const observation = JSON.parse(readFileSync(observationPath, 'utf8'));
  assert.equal(result.state, 'completed_once_fully_clean');
  assert.notEqual(observation.pid, process.pid);
  assert.equal(existsSync(dirname(fileURLToPath(observation.entry_url))), false);
  assert.deepEqual(observation.env_keys, []);
  assert.deepEqual(observation.exec_argv, []);
  assert.equal(observation.process_send, true);
  assert.equal(observation.process_channel, true);
  assert.deepEqual(observation.context_keys, ['signal']);
  assert.equal(observation.context_frozen, true);
  assert.equal(observation.context_prototype_null, true);
  assert.equal(observation.closed, true);
  await assert.rejects(ownerProcess.execute(), errorCode('already_executed'));
  await ownerProcess.close();
  await ownerProcess.close();
});

test('rejects pre-abort and close-before-execute without starting an owner', async (t) => {
  const bundle = registerBundleCleanup(t, ownerBundle());
  assert.throws(
    () => createBrowserRelayTrustedProviderProcess(options(bundle), {}),
    errorCode('invalid_configuration'),
  );
  assert.throws(
    () => createBrowserRelayTrustedProviderProcess(new Proxy(options(bundle), {
      ownKeys() {
        throw new Error('Bearer caller-secret');
      },
    })),
    errorCode('invalid_configuration'),
  );
  const exactExecute = createBrowserRelayTrustedProviderProcess(options(bundle));
  await assert.rejects(
    exactExecute.execute({}, {}),
    errorCode('invalid_configuration'),
  );
  await exactExecute.close();
  const preAborted = createBrowserRelayTrustedProviderProcess(options(bundle));
  const controller = new AbortController();
  controller.abort(new Error('Bearer caller-secret'));
  await assert.rejects(preAborted.execute({ signal: controller.signal }), errorCode('aborted'));
  await preAborted.close();

  const closed = createBrowserRelayTrustedProviderProcess(options(bundle));
  await closed.close();
  await assert.rejects(closed.execute(), errorCode('closed'));
});

test('fails closed on owner integrity, import and interface drift', async (t) => {
  const valid = registerBundleCleanup(t, ownerBundle());
  const wrongDigest = createBrowserRelayTrustedProviderProcess({
    ...options(valid),
    owner_bundle_sha256: 'b'.repeat(64),
  });
  await assert.rejects(wrongDigest.execute(), errorCode('owner_integrity_failed'));

  const syntax = registerBundleCleanup(t, createBundle('export function broken( {'));
  await assert.rejects(
    createBrowserRelayTrustedProviderProcess(options(syntax)).execute(),
    errorCode('owner_import_failed'),
  );

  const wrongExport = registerBundleCleanup(t, createBundle('export const wrong = true;'));
  await assert.rejects(
    createBrowserRelayTrustedProviderProcess(options(wrongExport)).execute(),
    errorCode('owner_contract_failed'),
  );

  const wrongOwner = registerBundleCleanup(t, createBundle(`
export function createBrowserRelayTrustedProviderOwner() { return {}; }
`));
  await assert.rejects(
    createBrowserRelayTrustedProviderProcess(options(wrongOwner)).execute(),
    errorCode('owner_contract_failed'),
  );

  const observationDirectory = mkdtempSync(join(tmpdir(), 'miakapp-owner-tamper-'));
  const observationPath = join(observationDirectory, 'evaluated');
  t.after(() => rmSync(observationDirectory, { force: true, recursive: true }));
  const tampered = registerBundleCleanup(t, ownerBundle({ observationPath }));
  const tamperedBytes = readFileSync(tampered.path);
  tamperedBytes[tamperedBytes.byteLength - 1] ^= 0xff;
  writeFileSync(tampered.path, tamperedBytes);
  await assert.rejects(
    createBrowserRelayTrustedProviderProcess(options({
      ...tampered,
      sha256: createHash('sha256').update(tamperedBytes).digest('hex'),
    })).execute(),
    errorCode('owner_integrity_failed'),
  );
  assert.equal(existsSync(observationPath), false);
});

test('rejects linked and executable owner containers', async (t) => {
  const valid = registerBundleCleanup(t, ownerBundle());
  const linkDirectory = mkdtempSync(join(CANONICAL_TMP_DIRECTORY, 'miakapp-owner-link-'));
  const linkPath = join(linkDirectory, 'linked-owner.mjs');
  symlinkSync(valid.path, linkPath);
  t.after(() => rmSync(linkDirectory, { force: true, recursive: true }));
  await assert.rejects(
    createBrowserRelayTrustedProviderProcess({
      ...options(valid),
      owner_bundle_path: linkPath,
    }).execute(),
    errorCode('owner_integrity_failed'),
  );

  const linkedDirectory = join(linkDirectory, 'linked-directory');
  symlinkSync(valid.directory, linkedDirectory, 'dir');
  await assert.rejects(
    createBrowserRelayTrustedProviderProcess({
      ...options(valid),
      owner_bundle_path: join(linkedDirectory, 'owner.mjs'),
    }).execute(),
    errorCode('owner_integrity_failed'),
  );

  chmodSync(valid.path, 0o700);
  await assert.rejects(
    createBrowserRelayTrustedProviderProcess(options(valid)).execute(),
    errorCode('owner_integrity_failed'),
  );
  chmodSync(valid.path, 0o600);

});

test('loads the pinned Playwright-core package tree without launching a browser', {
  timeout: 30_000,
}, async (t) => {
  const bundle = registerBundleCleanup(t, playwrightCoreOwnerBundle());
  const ownerProcess = createBrowserRelayTrustedProviderProcess(options(bundle, {
    ready_timeout_milliseconds: 10_000,
    operation_timeout_milliseconds: 5_000,
  }));
  assert.equal((await ownerProcess.execute()).state, 'completed_once_fully_clean');
  await ownerProcess.close();
});

test('rejects ESM and CommonJS module resolution outside the verified workspace', async (t) => {
  const suffix = `${process.pid}-${Date.now()}`;
  const packageName = `miakapp-owner-ambient-${suffix}`;
  const packageDirectory = join(CANONICAL_TMP_DIRECTORY, 'node_modules', packageName);
  const externalName = `miakapp-owner-external-${suffix}.mjs`;
  const externalPath = join(CANONICAL_TMP_DIRECTORY, externalName);
  mkdirSync(packageDirectory, { recursive: true });
  writeFileSync(join(packageDirectory, 'package.json'), JSON.stringify({
    name: packageName,
    main: 'index.cjs',
  }));
  writeFileSync(join(packageDirectory, 'index.cjs'), 'module.exports = true;\n');
  writeFileSync(externalPath, 'export default true;\n');
  t.after(() => {
    rmSync(packageDirectory, { force: true, recursive: true });
    rmSync(externalPath, { force: true });
  });

  const result = JSON.stringify(closedOperationResult());
  for (const dependencySource of [
    `import ${JSON.stringify(packageName)};`,
    `import ${JSON.stringify(`../${externalName}`)};`,
    `import ${JSON.stringify(pathToFileURL(externalPath).href)};`,
    `import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
require(${JSON.stringify(packageName)});`,
  ]) {
    const bundle = registerBundleCleanup(t, createBundle(`${dependencySource}
const RESULT = ${result};
export function createBrowserRelayTrustedProviderOwner() {
  return {
    async execute() { return RESULT; },
    async close() {}
  };
}
`));
    await assert.rejects(
      createBrowserRelayTrustedProviderProcess(options(bundle)).execute(),
      errorCode('owner_import_failed'),
    );
  }
});

test('sanitizes execute, result and close failures', async (t) => {
  for (const [mode, code] of [
    ['throw_secret', 'owner_execution_failed'],
    ['invalid_result', 'owner_result_invalid'],
    ['close_secret', 'owner_close_failed'],
  ]) {
    const bundle = registerBundleCleanup(t, ownerBundle({ mode }));
    await assert.rejects(
      createBrowserRelayTrustedProviderProcess(options(bundle)).execute(),
      errorCode(code),
    );
  }
});

test('collapses pre-spawn runtime and entropy failures to fixed public codes', () => {
  const optionsSource = JSON.stringify({
    owner_bundle_path: '/tmp/not-opened-owner.mjs',
    owner_bundle_sha256: 'a'.repeat(64),
  });
  assertSuccessfulFreshProcess(`
import crypto from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
crypto.randomBytes = () => { throw new Error('Bearer entropy-secret'); };
syncBuiltinESMExports();
const { createBrowserRelayTrustedProviderProcess } = await import(${JSON.stringify(PROCESS_ENTRY_URL)});
try {
  await createBrowserRelayTrustedProviderProcess(${optionsSource}).execute();
} catch (error) {
  process.exit(error?.code === 'peer_failed'
    && error?.message === 'Trusted provider process failed (peer_failed)'
    && !error.message.includes('Bearer') ? 0 : 2);
}
process.exit(3);
`);
  assertSuccessfulFreshProcess(`
import process from 'node:process';
Object.defineProperty(process, 'release', { value: { name: 'bun' } });
const { createBrowserRelayTrustedProviderProcess } = await import(${JSON.stringify(PROCESS_ENTRY_URL)});
try {
  await createBrowserRelayTrustedProviderProcess(${optionsSource}).execute();
} catch (error) {
  process.exit(error?.code === 'unsupported_platform'
    && error?.message === 'Trusted provider process failed (unsupported_platform)' ? 0 : 2);
}
process.exit(3);
`);
});

test('forwards cooperative cancellation without its reason', async (t) => {
  const observationDirectory = mkdtempSync(join(tmpdir(), 'miakapp-owner-cancel-'));
  const observationPath = join(observationDirectory, 'started');
  t.after(() => rmSync(observationDirectory, { force: true, recursive: true }));
  const bundle = registerBundleCleanup(t, ownerBundle({
    mode: 'wait_for_abort',
    observationPath,
  }));
  const controller = new AbortController();
  const ownerProcess = createBrowserRelayTrustedProviderProcess(options(bundle, {
    operation_timeout_milliseconds: 2_000,
  }));
  const operation = ownerProcess.execute({ signal: controller.signal });
  await waitFor(() => existsSync(observationPath));
  controller.abort(new Error('Bearer caller-secret'));
  await assert.rejects(operation, errorCode('aborted'));
  await ownerProcess.close();
});

test('hard-terminates an owner that ignores abort and never replays it', async (t) => {
  const observationDirectory = mkdtempSync(join(tmpdir(), 'miakapp-owner-timeout-'));
  const observationPath = join(observationDirectory, 'started');
  t.after(() => rmSync(observationDirectory, { force: true, recursive: true }));
  const bundle = registerBundleCleanup(t, ownerBundle({
    mode: 'ignore_abort',
    observationPath,
  }));
  const ownerProcess = createBrowserRelayTrustedProviderProcess(options(bundle, {
    operation_timeout_milliseconds: 500,
    cancellation_grace_milliseconds: 50,
  }));
  const startedAt = Date.now();
  const operation = ownerProcess.execute();
  await waitFor(() => existsSync(observationPath));
  await assert.rejects(operation, errorCode('operation_timeout'));
  assert.ok(Date.now() - startedAt < 2_000);
  await assert.rejects(ownerProcess.execute(), errorCode('already_executed'));
  await ownerProcess.close();
});

test('close converges with an active uncooperative operation', async (t) => {
  const observationDirectory = mkdtempSync(join(tmpdir(), 'miakapp-owner-close-'));
  const observationPath = join(observationDirectory, 'started');
  t.after(() => rmSync(observationDirectory, { force: true, recursive: true }));
  const bundle = registerBundleCleanup(t, ownerBundle({
    mode: 'ignore_abort',
    observationPath,
  }));
  const ownerProcess = createBrowserRelayTrustedProviderProcess(options(bundle, {
    operation_timeout_milliseconds: 2_000,
    cancellation_grace_milliseconds: 25,
  }));
  const operation = ownerProcess.execute();
  await waitFor(() => existsSync(observationPath));
  await ownerProcess.close();
  await assert.rejects(operation, errorCode('closed'));
});

test('kills a SIGTERM-ignoring descendant in the same POSIX process group', async (t) => {
  const observationDirectory = mkdtempSync(join(tmpdir(), 'miakapp-owner-descendant-'));
  const pidPath = join(observationDirectory, 'pid');
  t.after(() => rmSync(observationDirectory, { force: true, recursive: true }));
  const bundle = registerBundleCleanup(t, ownerBundle({
    mode: 'descendant',
    observationPath: pidPath,
    descendantPath: UNCOOPERATIVE_DESCENDANT,
  }));
  const ownerProcess = createBrowserRelayTrustedProviderProcess(options(bundle, {
    operation_timeout_milliseconds: 500,
    cancellation_grace_milliseconds: 50,
  }));
  const operation = ownerProcess.execute();
  await waitFor(() => existsSync(pidPath));
  await assert.rejects(operation, errorCode('operation_timeout'));
  const descendantPid = Number(readFileSync(pidPath, 'utf8'));
  assert.ok(Number.isSafeInteger(descendantPid) && descendantPid > 1);
  await waitFor(() => !processExists(descendantPid));
  await ownerProcess.close();
});

test('settles only after successful and failed owner descendants are gone', async (t) => {
  for (const [mode, expectedCode] of [
    ['descendant_success', undefined],
    ['descendant_throw', 'owner_execution_failed'],
  ]) {
    const observationDirectory = mkdtempSync(join(tmpdir(), 'miakapp-owner-orphan-'));
    const pidPath = join(observationDirectory, 'pid');
    t.after(() => rmSync(observationDirectory, { force: true, recursive: true }));
    const bundle = registerBundleCleanup(t, ownerBundle({
      mode,
      observationPath: pidPath,
      descendantPath: UNCOOPERATIVE_DESCENDANT,
    }));
    const ownerProcess = createBrowserRelayTrustedProviderProcess(options(bundle));
    if (expectedCode === undefined) {
      assert.equal((await ownerProcess.execute()).state, 'completed_once_fully_clean');
    } else {
      await assert.rejects(ownerProcess.execute(), errorCode(expectedCode));
    }
    assert.equal(existsSync(pidPath), true);
    const descendantPid = Number(readFileSync(pidPath, 'utf8'));
    assert.ok(Number.isSafeInteger(descendantPid) && descendantPid > 1);
    assert.equal(processExists(descendantPid), false);
    await ownerProcess.close();
  }
});

test('sends one cooperative cancel across concurrent abort and close', async (t) => {
  const observationDirectory = mkdtempSync(join(tmpdir(), 'miakapp-cancel-count-'));
  const observationPath = join(observationDirectory, 'count');
  t.after(() => rmSync(observationDirectory, { force: true, recursive: true }));
  const bundle = registerBundleCleanup(t, hostilePeerBundle({
    mode: 'count_cancels',
    observation_path: observationPath,
  }));
  const ownerProcess = createBrowserRelayTrustedProviderProcessInternal(
    options(bundle, {
      ready_timeout_milliseconds: 500,
      operation_timeout_milliseconds: 2_000,
      cancellation_grace_milliseconds: 500,
    }),
    HOSTILE_PEER,
  );
  const controller = new AbortController();
  const operation = ownerProcess.execute({ signal: controller.signal });
  await waitFor(() => existsSync(`${observationPath}.started`));
  const rejection = assert.rejects(operation, errorCode('aborted'));
  controller.abort(new Error('Bearer caller-secret'));
  const closing = ownerProcess.close();
  await rejection;
  await closing;
  assert.equal(readFileSync(observationPath, 'utf8'), '1');
});

test('rejects hostile startup frames and early exits', async (t) => {
  for (const [mode, code] of [
    ['noncanonical', 'invalid_protocol'],
    ['duplicate', 'invalid_protocol'],
    ['oversized', 'invalid_protocol'],
    ['truncated', 'invalid_protocol'],
    ['flood', 'invalid_protocol'],
    ['wrong_version', 'invalid_protocol'],
    ['early_exit', 'peer_closed'],
    ['hang_ready', 'ready_timeout'],
  ]) {
    const bundle = registerBundleCleanup(t, hostilePeerBundle({ mode }));
    const ownerProcess = createBrowserRelayTrustedProviderProcessInternal(
      options(bundle, {
        ready_timeout_milliseconds: mode === 'hang_ready' ? 150 : 500,
      }),
      HOSTILE_PEER,
    );
    await assert.rejects(ownerProcess.execute(), errorCode(code));
    await ownerProcess.close();
  }
});

test('rejects hostile terminal identity, code, duplication, crash and hang', async (t) => {
  for (const [mode, code] of [
    ['wrong_id', 'invalid_protocol'],
    ['invalid_code', 'invalid_protocol'],
    ['extra_terminal', 'invalid_protocol'],
    ['crash_after_execute', 'peer_closed'],
    ['result_then_hang', 'operation_timeout'],
  ]) {
    const bundle = registerBundleCleanup(t, hostilePeerBundle({
      mode,
      result: closedOperationResult(),
    }));
    const ownerProcess = createBrowserRelayTrustedProviderProcessInternal(
      options(bundle, {
        ready_timeout_milliseconds: 500,
        operation_timeout_milliseconds: mode === 'result_then_hang' ? 250 : 1_000,
        cancellation_grace_milliseconds: 50,
      }),
      HOSTILE_PEER,
    );
    await assert.rejects(ownerProcess.execute(), errorCode(code));
    await ownerProcess.close();
  }
});

test('accepts one valid hostile-peer result only after clean process close', async (t) => {
  const expected = closedOperationResult();
  const bundle = registerBundleCleanup(t, hostilePeerBundle({
    mode: 'result',
    result: expected,
  }));
  const ownerProcess = createBrowserRelayTrustedProviderProcessInternal(
    options(bundle),
    HOSTILE_PEER,
  );
  assert.deepEqual(await ownerProcess.execute(), expected);
  await ownerProcess.close();
});

test('worker closes the owner before reporting an active protocol failure', {
  timeout: 5_000,
}, async (t) => {
  const observationDirectory = mkdtempSync(join(tmpdir(), 'miakapp-protocol-close-'));
  const observationPath = join(observationDirectory, 'state');
  t.after(() => rmSync(observationDirectory, { force: true, recursive: true }));
  const bundle = registerBundleCleanup(t, ownerBundle({
    mode: 'protocol_failure_order',
    observationPath,
  }));
  const ownerWorkspacePath = realpathSync.native(
    mkdtempSync(join(CANONICAL_TMP_DIRECTORY, 'miakapp-worker-owner-')),
  );
  t.after(() => rmSync(ownerWorkspacePath, { force: true, recursive: true }));
  const child = spawn(process.execPath, [
    WORKER,
    '--protocol-version',
    '1',
    '--owner-bundle-path',
    bundle.path,
    '--owner-bundle-sha256',
    bundle.sha256,
    '--owner-workspace-path',
    ownerWorkspacePath,
  ], {
    detached: true,
    env: Object.create(null),
    shell: false,
    stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'],
  });
  t.after(() => {
    if (!Number.isSafeInteger(child.pid)) return;
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      // The asserted close path normally owns cleanup.
    }
  });
  const requestStream = child.stdio[3];
  const responseStream = child.stdio[4];
  assert.notEqual(requestStream, null);
  assert.notEqual(responseStream, null);
  const writer = createTrustedProviderProcessFrameWriter(requestStream);
  let resolveReady;
  let rejectReady;
  let resolveTerminal;
  let rejectTerminal;
  const ready = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const terminal = new Promise((resolve, reject) => {
    resolveTerminal = resolve;
    rejectTerminal = reject;
  });
  readTrustedProviderProcessFrames(responseStream, {
    onMessage(message) {
      if (message.type === 'ready') resolveReady();
      else resolveTerminal(message);
    },
    onFailure() {
      const failure = new Error('worker response framing failed');
      rejectReady(failure);
      rejectTerminal(failure);
    },
    onEnd() {
      rejectTerminal(new Error('worker response ended before a terminal message'));
    },
  });
  const childClosed = new Promise((resolve) => {
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  await ready;
  const requestIdentifier = 'A'.repeat(43);
  await writer.write(buildTrustedProviderProcessExecute(requestIdentifier));
  await waitFor(() => existsSync(observationPath));
  await writer.write(buildTrustedProviderProcessCancel(requestIdentifier));
  await writer.write(buildTrustedProviderProcessCancel(requestIdentifier));
  const message = await terminal;
  assert.equal(message.type, 'failure');
  assert.equal(message.request_id, requestIdentifier);
  assert.equal(message.code, 'invalid_protocol');
  assert.equal(readFileSync(observationPath, 'utf8'), 'closed');
  writer.destroy();
  responseStream.destroy();
  assert.deepEqual(await childClosed, { code: 1, signal: null });
});
