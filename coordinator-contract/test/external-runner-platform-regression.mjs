import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  externalRunnerPlatformError,
  WINDOWS_UNSUPPORTED_MESSAGE,
} from '../bin/platform-support.mjs';

for (const platform of ['darwin', 'freebsd', 'linux']) {
  assert.equal(externalRunnerPlatformError(platform), undefined, platform);
}
assert.equal(
  externalRunnerPlatformError('win32'),
  WINDOWS_UNSUPPORTED_MESSAGE,
);

const contractRoot = fileURLToPath(new URL('..', import.meta.url));
const checkerUrl = new URL('../bin/check-subject.mjs', import.meta.url);
const checker = fileURLToPath(checkerUrl);

function assertGuardedCheckerResult(result) {
  if (result.error !== undefined) throw result.error;
  assert.equal(result.status, 1);
  assert.equal(result.signal, null);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, `${WINDOWS_UNSUPPORTED_MESSAGE}\n`);
}

const tripwireDirectory = mkdtempSync(join(tmpdir(), 'miakapp-runner-guard-'));
const spawnMarker = join(tripwireDirectory, 'spawn-attempted');
try {
  const tripwireResult = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      `
        import childProcess from 'node:child_process';
        import { writeFileSync } from 'node:fs';
        import { syncBuiltinESMExports } from 'node:module';

        const rejectChildProcess = () => {
          writeFileSync(${JSON.stringify(spawnMarker)}, 'spawn attempted');
          throw new Error('External checker attempted to create a child process on win32');
        };
        for (const method of [
          'exec',
          'execFile',
          'execFileSync',
          'execSync',
          'fork',
          'spawn',
          'spawnSync',
        ]) childProcess[method] = rejectChildProcess;
        syncBuiltinESMExports();
        if (process.platform !== 'win32') {
          Object.defineProperty(process, 'platform', { value: 'win32' });
        }
        process.argv = [
          process.execPath,
          ${JSON.stringify(checker)},
          'this-subject-must-never-be-resolved.mjs',
        ];
        await import(${JSON.stringify(checkerUrl.href)});
      `,
    ],
    {
      cwd: contractRoot,
      encoding: 'utf8',
      env: process.env,
      timeout: 2_000,
    },
  );

  assert.equal(
    existsSync(spawnMarker),
    false,
    'win32 checker attempted to spawn a trusted runner',
  );
  assertGuardedCheckerResult(tripwireResult);
} finally {
  rmSync(tripwireDirectory, { recursive: true, force: true });
}

if (process.platform === 'win32') {
  const nativeResult = spawnSync(
    process.execPath,
    [checker, 'this-subject-must-never-be-resolved.mjs'],
    {
      cwd: contractRoot,
      encoding: 'utf8',
      env: process.env,
      timeout: 2_000,
    },
  );

  assertGuardedCheckerResult(nativeResult);
}
