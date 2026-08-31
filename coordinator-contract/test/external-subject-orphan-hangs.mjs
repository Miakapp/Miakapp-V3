import { spawn } from 'node:child_process';

const descendant = spawn(
  process.execPath,
  ['--input-type=module', '--eval', 'setTimeout(() => process.exit(0), 4_000)'],
  {
    detached: true,
    stdio: ['ignore', 'inherit', 'inherit'],
  },
);
descendant.unref();

const waitCell = new Int32Array(new SharedArrayBuffer(4));
Atomics.wait(waitCell, 0, 0);
