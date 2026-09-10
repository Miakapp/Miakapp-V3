import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const MODULES = Object.freeze([
  '../authority-channel.mjs',
  '../contract.mjs',
  '../framed-channel.mjs',
  '../internal.mjs',
  '../owner-bundle.mjs',
  '../process.mjs',
  '../worker.mjs',
  '../guard.mjs',
].map((specifier) => new URL(specifier, import.meta.url).href));

test('all production imports remain inert under denied side-effect capabilities', () => {
  const program = `
import childProcess from 'node:child_process';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';

const denied = [];
const deny = (name) => (...args) => {
  denied.push({ name, arguments: args.length });
  throw new Error('denied side effect');
};
childProcess.spawn = deny('spawn');
for (const name of [
      'openSync', 'readFileSync', 'writeFileSync', 'createReadStream',
      'createWriteStream', 'lstatSync', 'mkdirSync', 'mkdtempSync', 'rmSync'
]) {
  const original = fs[name].bind(fs);
  fs[name] = (...args) => {
    const stack = new Error().stack ?? '';
    if (stack.includes('getSourceSync (node:internal/modules/esm/load:')) {
      return original(...args);
    }
    return deny(name)(...args);
  };
}
syncBuiltinESMExports();
globalThis.fetch = deny('fetch');
globalThis.WebSocket = class { constructor() { deny('WebSocket')(); } };
globalThis.XMLHttpRequest = class { constructor() { deny('XMLHttpRequest')(); } };
globalThis.EventSource = class { constructor() { deny('EventSource')(); } };

await import(${JSON.stringify(`${MODULES[0]}?loader_baseline=1`)});
await import('node:process');
await new Promise((resolve) => setImmediate(resolve));
const before = process._getActiveHandles().length;
for (const url of ${JSON.stringify(MODULES)}) await import(url);
await new Promise((resolve) => setImmediate(resolve));
if (denied.length !== 0) throw new Error('production import attempted a side effect');
if (process._getActiveHandles().length !== before) {
  throw new Error('production import retained a handle');
}
`;
  const outcome = spawnSync(process.execPath, ['--input-type=module', '--eval', program], {
    encoding: 'utf8',
    env: Object.create(null),
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 5_000,
  });
  if (outcome.error !== undefined) throw outcome.error;
  assert.equal(outcome.status, 0, outcome.stderr);
  assert.equal(outcome.signal, null);
  assert.equal(outcome.stdout, '');
  assert.equal(outcome.stderr, '');
});
