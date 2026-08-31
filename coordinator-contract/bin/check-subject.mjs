#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { writeSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { externalRunnerPlatformError } from './platform-support.mjs';

const DEFAULT_STAGE_TIMEOUT_MS = 10_000;
const DEFAULT_TOTAL_TIMEOUT_MS = 120_000;
const MAX_STAGE_TIMEOUT_MS = 60_000;
const MAX_TOTAL_TIMEOUT_MS = 300_000;
const MAX_OUTPUT_BYTES = 1_048_576;
const TIMEOUT_EXIT_CODE = 124;
const CHILD_KILL_GRACE_MS = 250;
const CONTRACT_PROFILES = new Set(['sdk', 'migration', 'all']);

const platformError = externalRunnerPlatformError(process.platform);

if (platformError !== undefined) {
  writeSync(process.stderr.fd, `${platformError}\n`);
  process.exit(1);
}

function timeoutFromEnvironment(name, fallback, maximum) {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new RangeError(`${name} must be an integer between 1 and ${maximum}`);
  }
  return value;
}

const arguments_ = process.argv.slice(2);
let profile = 'all';
let subjectPath;
if (arguments_.length === 1) {
  [subjectPath] = arguments_;
} else if (arguments_.length === 3 && arguments_[0] === '--profile') {
  [, profile, subjectPath] = arguments_;
}
if (subjectPath === undefined || !CONTRACT_PROFILES.has(profile)) {
  throw new Error(
    'Usage: check-subject.mjs [--profile sdk|migration|all] <absolute-or-relative-subject-module>',
  );
}

const stageTimeoutMs = timeoutFromEnvironment(
  'MIAKAPP_CONTRACT_STAGE_TIMEOUT_MS',
  DEFAULT_STAGE_TIMEOUT_MS,
  MAX_STAGE_TIMEOUT_MS,
);
const totalTimeoutMs = timeoutFromEnvironment(
  'MIAKAPP_CONTRACT_TOTAL_TIMEOUT_MS',
  DEFAULT_TOTAL_TIMEOUT_MS,
  MAX_TOTAL_TIMEOUT_MS,
);
const workerPath = fileURLToPath(new URL('./run-subject.mjs', import.meta.url));
const child = spawn(process.execPath, [workerPath, '--profile', profile, resolve(subjectPath)], {
  detached: true,
  env: process.env,
  stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
});

const stdout = [];
const stderr = [];
let stdoutBytes = 0;
let stderrBytes = 0;
let stage = 'startup';
let failure;
let stageTimer;
let killGraceTimer;
let parentSignalExitCode;
let runnerToken;
let completed = false;
let outcomeSettled = false;
let resolveOutcomePromise;
const outcomePromise = new Promise((resolveOutcome) => {
  resolveOutcomePromise = resolveOutcome;
});

function settleOutcome(outcome) {
  if (outcomeSettled) return;
  outcomeSettled = true;
  resolveOutcomePromise(outcome);
}

child.on('error', (error) => {
  if (failure === undefined && parentSignalExitCode === undefined) {
    settleOutcome({ error });
  }
});
child.once('close', (code, signal) => settleOutcome({ code, signal }));

function killChild() {
  if (child.pid === undefined || child.killed) return;
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch (error) {
    if (error?.code !== 'ESRCH') child.kill('SIGKILL');
  }
}

function releaseChildHandles() {
  child.stdout.destroy();
  child.stderr.destroy();
  child.stdout.unref?.();
  child.stderr.unref?.();
  child.channel?.unref?.();
  if (child.connected) {
    try {
      child.disconnect();
    } catch {
      // The worker is already being force-terminated; releasing every other
      // parent-side handle still guarantees that cleanup remains bounded.
    }
  }
  child.unref();
  settleOutcome({ forced: true });
}

function scheduleChildRelease() {
  if (killGraceTimer !== undefined) return;
  killGraceTimer = setTimeout(releaseChildHandles, CHILD_KILL_GRACE_MS);
}

function terminate(message, exitCode) {
  if (failure !== undefined) return;
  failure = { message, exitCode };
  killChild();
  scheduleChildRelease();
}

function armStageTimer() {
  clearTimeout(stageTimer);
  stageTimer = setTimeout(() => {
    terminate(
      `External subject conformance timed out during ${stage} after ${stageTimeoutMs} ms`,
      TIMEOUT_EXIT_CODE,
    );
  }, stageTimeoutMs);
}

function captureOutput(target, chunk, stream) {
  const currentBytes = stream === 'stdout' ? stdoutBytes : stderrBytes;
  if (currentBytes + chunk.byteLength > MAX_OUTPUT_BYTES) {
    terminate(`External subject ${stream} exceeded ${MAX_OUTPUT_BYTES} bytes`, 1);
    return;
  }
  target.push(chunk);
  if (stream === 'stdout') stdoutBytes += chunk.byteLength;
  else stderrBytes += chunk.byteLength;
}

child.stdout.on('data', (chunk) => captureOutput(stdout, chunk, 'stdout'));
child.stderr.on('data', (chunk) => captureOutput(stderr, chunk, 'stderr'));
child.on('message', (message) => {
  if (message === null || typeof message !== 'object') return;
  if (message.type === 'bootstrap') {
    if (runnerToken !== undefined
      || typeof message.token !== 'string'
      || message.token.length < 32) {
      terminate('External subject runner sent an invalid bootstrap message', 1);
      return;
    }
    runnerToken = message.token;
    return;
  }
  if (runnerToken === undefined || message.token !== runnerToken) return;
  if (message.type === 'stage' && typeof message.stage === 'string') {
    stage = message.stage;
    armStageTimer();
  } else if (message.type === 'complete') {
    completed = true;
  }
});

armStageTimer();
const totalTimer = setTimeout(() => {
  terminate(
    `External subject conformance exceeded its total timeout after ${totalTimeoutMs} ms`,
    TIMEOUT_EXIT_CODE,
  );
}, totalTimeoutMs);

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    parentSignalExitCode = signal === 'SIGINT' ? 130 : 143;
    killChild();
    scheduleChildRelease();
  });
}

const outcome = await outcomePromise;

clearTimeout(stageTimer);
clearTimeout(totalTimer);
clearTimeout(killGraceTimer);
if (stdoutBytes > 0) process.stdout.write(Buffer.concat(stdout, stdoutBytes));
if (stderrBytes > 0) process.stderr.write(Buffer.concat(stderr, stderrBytes));

if (parentSignalExitCode !== undefined) {
  process.exitCode = parentSignalExitCode;
} else if (failure !== undefined) {
  process.stderr.write(`${failure.message}\n`);
  process.exitCode = failure.exitCode;
} else if ('error' in outcome) {
  throw outcome.error;
} else if (outcome.code !== 0) {
  if (outcome.signal !== null) {
    process.stderr.write(`External subject process terminated by ${outcome.signal}\n`);
  }
  process.exitCode = outcome.code ?? 1;
} else if (!completed) {
  process.stderr.write(
    'External subject exited successfully without a trusted completion marker\n',
  );
  process.exitCode = 1;
}
