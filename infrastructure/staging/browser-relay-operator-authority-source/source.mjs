import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { createBrowserRelayOperatorAuthoritySourceForImplementation } from './internal.mjs';
import { childEnvironment, OPERATOR_USER_SHA256 } from '../workload/contract.mjs';

const REPOSITORY_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

function command(args, options) {
  const result = spawnSync('gcloud', args, {
    cwd: REPOSITORY_ROOT,
    env: childEnvironment(),
    input: undefined,
    encoding: null,
    maxBuffer: options.maximum_output_bytes,
    shell: false,
    signal: options.signal,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: options.timeout_milliseconds,
  });
  return Object.freeze({
    ok: result.error === undefined && result.signal === null && result.status === 0,
    stdout: Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.alloc(0),
    stderr: Buffer.isBuffer(result.stderr) ? result.stderr : Buffer.alloc(0),
  });
}

const IMPLEMENTATIONS = Object.freeze({
  clock: Date.now,
  command,
  fetch: globalThis.fetch.bind(globalThis),
});

export function createBrowserRelayOperatorAuthoritySource() {
  return createBrowserRelayOperatorAuthoritySourceForImplementation(
    IMPLEMENTATIONS,
    OPERATOR_USER_SHA256,
  );
}
