// Verifies an emitted sandbox artifact against the boundary it was built for.
//
//   bun run verify:sandbox
//
// Reads the same three variables as `build:sandbox`, plus the same optional
// output directory, and checks what is actually on disk. Run it after the build
// and before `firebase deploy`: a mismatch here is a document the browser would
// load and then refuse to execute.

import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { verifySandboxArtifact } from '../src/sandbox-artifact';

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') {
    throw new Error(`${name} must be set; the sandbox boundary is never guessed`);
  }
  return value.trim();
}

async function main(): Promise<void> {
  const sandboxOrigin = required('MIAKAPP_SANDBOX_ORIGIN');
  const hostOrigin = required('MIAKAPP_HOST_ORIGIN');
  const site = required('MIAKAPP_SANDBOX_SITE');
  const outDir = resolve(process.env.MIAKAPP_SANDBOX_OUT_DIR?.trim() || 'dist-sandbox');

  const html = await readFile(join(outDir, 'sandbox.html'), 'utf8');
  const config: unknown = JSON.parse(await readFile(join(outDir, 'firebase.json'), 'utf8'));

  const report = await verifySandboxArtifact({ html, config, sandboxOrigin, hostOrigin, site });

  process.stdout.write(
    [
      `verified         ${outDir}`,
      `script-src hash  sha256-${report.scriptHash} (recomputed from the served script)`,
      `inline script    ${report.scriptBytes} bytes`,
      `sandbox.html     sha256:${report.documentDigest} (${report.documentBytes} bytes)`,
      '',
    ].join('\n'),
  );
}

await main();
