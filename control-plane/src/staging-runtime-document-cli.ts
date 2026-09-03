import { fileURLToPath } from 'node:url';

import { REQUEST_JSON_LIMITS, parseRequestJson } from './json.js';
import {
  buildInitialStagingRuntimeDocument,
  validateInitialStagingRuntimeDocument,
} from './staging-runtime-document.js';

async function standardInput(): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of process.stdin) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    length += bytes.byteLength;
    if (length > REQUEST_JSON_LIMITS.maximumBytes) throw new Error('input limit');
    chunks.push(bytes);
  }
  if (length === 0) throw new Error('empty input');
  return Buffer.concat(chunks);
}

async function main(): Promise<void> {
  if (process.argv.length !== 3 || !['build', 'validate'].includes(process.argv[2] ?? '')) {
    throw new Error('usage');
  }
  const input = parseRequestJson(await standardInput());
  if (process.argv[2] === 'build') {
    process.stdout.write(`${JSON.stringify(buildInitialStagingRuntimeDocument(input))}\n`);
    return;
  }
  validateInitialStagingRuntimeDocument(input);
  process.stdout.write('{"status":"valid"}\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    console.error('Staging runtime document validation failed.');
    process.exitCode = 1;
  });
}
