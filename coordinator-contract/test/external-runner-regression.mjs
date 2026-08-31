import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { encodeFrame, readFrames } from '../bin/framed-channel.mjs';

const contractRoot = fileURLToPath(new URL('..', import.meta.url));
const checker = fileURLToPath(new URL('../bin/check-subject.mjs', import.meta.url));
const hangingSubject = fileURLToPath(new URL('./external-subject-hangs.mjs', import.meta.url));
const exitingSubject = fileURLToPath(new URL('./external-subject-exits.mjs', import.meta.url));
const spoofingSubject = fileURLToPath(
  new URL('./external-subject-spoofs-completion.mjs', import.meta.url),
);
const isolatedSubject = fileURLToPath(
  new URL('./external-subject-has-no-trusted-ipc.mjs', import.meta.url),
);
const workerChannelAttacker = fileURLToPath(
  new URL('./external-subject-attacks-worker-channel.mjs', import.meta.url),
);
const orphaningSubject = fileURLToPath(
  new URL('./external-subject-orphan-hangs.mjs', import.meta.url),
);

function runHangingSubject(hangStage, stageTimeoutMs, totalTimeoutMs) {
  const result = spawnSync(process.execPath, [checker, hangingSubject], {
    cwd: contractRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      MIAKAPP_CONTRACT_STAGE_TIMEOUT_MS: String(stageTimeoutMs),
      MIAKAPP_CONTRACT_TOTAL_TIMEOUT_MS: String(totalTimeoutMs),
      MIAKAPP_TEST_HANG_STAGE: hangStage,
    },
    killSignal: 'SIGKILL',
    timeout: 5_000,
  });
  if (result.error !== undefined) throw result.error;
  assert.equal(result.status, 124);
  assert.equal(result.signal, null);
  assert.equal(result.stdout, '');
  return result.stderr;
}

for (const stage of ['import', 'factory', 'reset', 'dispatch', 'observe']) {
  const stderr = runHangingSubject(stage, 250, 2_000);
  assert.equal(
    stderr,
    `External subject conformance timed out during ${stage} after 250 ms\n`,
  );
}

const spoofResult = spawnSync(process.execPath, [checker, spoofingSubject], {
  cwd: contractRoot,
  encoding: 'utf8',
  env: process.env,
  killSignal: 'SIGKILL',
  timeout: 5_000,
});
if (spoofResult.error !== undefined) throw spoofResult.error;
assert.equal(spoofResult.status, 1);
assert.equal(spoofResult.signal, null);
assert.equal(spoofResult.stdout, '');
assert.equal(
  spoofResult.stderr,
  'External subject exited successfully without a trusted completion marker\n',
);

const isolatedResult = spawnSync(process.execPath, [checker, isolatedSubject], {
  cwd: contractRoot,
  encoding: 'utf8',
  env: process.env,
  killSignal: 'SIGKILL',
  timeout: 5_000,
});
if (isolatedResult.error !== undefined) throw isolatedResult.error;
assert.equal(isolatedResult.status, 0);
assert.equal(isolatedResult.signal, null);
assert.equal(isolatedResult.stderr, '');
assert.equal(
  isolatedResult.stdout,
  '{"schema":"miakapp.coordinator-contract/1","scenarios":14,"status":"conformant"}\n',
);

for (const [attack, expectedError] of [
  ['invalid_response', 'External subject worker sent an invalid response'],
  ['oversized_response', 'Worker protocol frame must contain 1 to 4194304 bytes'],
]) {
  const result = spawnSync(process.execPath, [checker, workerChannelAttacker], {
    cwd: contractRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      MIAKAPP_CONTRACT_STAGE_TIMEOUT_MS: '2000',
      MIAKAPP_CONTRACT_TOTAL_TIMEOUT_MS: '5000',
      MIAKAPP_TEST_WORKER_CHANNEL_ATTACK: attack,
    },
    killSignal: 'SIGKILL',
    timeout: 6_000,
  });
  if (result.error !== undefined) throw result.error;
  assert.equal(result.status, 1, attack);
  assert.equal(result.signal, null, attack);
  assert.equal(result.stdout, '', attack);
  assert.match(result.stderr, new RegExp(expectedError), attack);
}

const floodedChannel = new PassThrough();
const floodFailure = new Promise((resolve) => {
  readFrames(floodedChannel, () => {}, resolve);
});
const emptyFrame = encodeFrame({});
for (let index = 0; index < 8_193; index += 1) floodedChannel.write(emptyFrame);
assert.match(
  (await floodFailure).message,
  /Worker protocol exceeded 8192 frames/,
);

let deeplyNested = null;
for (let depth = 0; depth < 65; depth += 1) deeplyNested = [deeplyNested];
const deepChannel = new PassThrough();
const depthFailure = new Promise((resolve) => {
  readFrames(deepChannel, () => {}, resolve);
});
deepChannel.end(encodeFrame(deeplyNested));
assert.match(
  (await depthFailure).message,
  /Worker protocol JSON exceeds depth 64/,
);

const orphanStartedAt = Date.now();
const orphanResult = spawnSync(process.execPath, [checker, orphaningSubject], {
  cwd: contractRoot,
  encoding: 'utf8',
  env: {
    ...process.env,
    MIAKAPP_CONTRACT_STAGE_TIMEOUT_MS: '250',
    MIAKAPP_CONTRACT_TOTAL_TIMEOUT_MS: '2000',
  },
  killSignal: 'SIGKILL',
  timeout: 6_000,
});
if (orphanResult.error !== undefined) throw orphanResult.error;
assert.equal(orphanResult.status, 124);
assert.equal(orphanResult.signal, null);
assert.equal(orphanResult.stdout, '');
assert.equal(
  orphanResult.stderr,
  'External subject conformance timed out during import after 250 ms\n',
);
assert.ok(
  Date.now() - orphanStartedAt < 2_000,
  'checker waited for a detached descendant that retained worker stdio',
);

const signalledStartedAt = Date.now();
const signalled = spawn(process.execPath, [checker, orphaningSubject], {
  cwd: contractRoot,
  env: {
    ...process.env,
    MIAKAPP_CONTRACT_STAGE_TIMEOUT_MS: '5000',
    MIAKAPP_CONTRACT_TOTAL_TIMEOUT_MS: '5000',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const signalledStdout = [];
const signalledStderr = [];
signalled.stdout.on('data', (chunk) => signalledStdout.push(chunk));
signalled.stderr.on('data', (chunk) => signalledStderr.push(chunk));
const sendSignal = setTimeout(() => signalled.kill('SIGTERM'), 250);
const forceSignalTest = setTimeout(() => signalled.kill('SIGKILL'), 3_000);
const signalledOutcome = await new Promise((resolve, reject) => {
  signalled.once('error', reject);
  signalled.once('close', (code, signal) => resolve({ code, signal }));
});
clearTimeout(sendSignal);
clearTimeout(forceSignalTest);
assert.deepEqual(signalledOutcome, { code: 143, signal: null });
assert.equal(Buffer.concat(signalledStdout).toString(), '');
assert.equal(Buffer.concat(signalledStderr).toString(), '');
assert.ok(
  Date.now() - signalledStartedAt < 2_000,
  'signalled checker waited for a detached descendant that retained worker stdio',
);

const totalStderr = runHangingSubject('import', 2_000, 250);
assert.equal(
  totalStderr,
  'External subject conformance exceeded its total timeout after 250 ms\n',
);

for (const stage of ['import', 'factory', 'reset', 'dispatch', 'observe']) {
  const result = spawnSync(process.execPath, [checker, exitingSubject], {
    cwd: contractRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      MIAKAPP_TEST_EXIT_STAGE: stage,
    },
    killSignal: 'SIGKILL',
    timeout: 5_000,
  });
  if (result.error !== undefined) throw result.error;
  assert.equal(result.status, 1, stage);
  assert.equal(result.signal, null, stage);
  assert.equal(result.stdout, '', stage);
  assert.equal(
    result.stderr,
    'External subject exited successfully without a trusted completion marker\n',
    stage,
  );
}
