// Emits the deployable sandbox site.
//
//   bun run component-runtime/scripts/build-sandbox.ts
//
// Requires, with no defaults:
//   MIAKAPP_SANDBOX_ORIGIN  the HTTPS origin that will serve /app.html
//   MIAKAPP_HOST_ORIGIN     the HTTPS origin allowed to frame it
//   MIAKAPP_SANDBOX_SITE    the Firebase Hosting site serving the sandbox origin
//
// These are the containment boundary. Guessing one would silently produce a
// document that either refuses to bind or, worse, trusts the wrong framer, so a
// missing variable fails the build instead.
//
// Output (default `dist-sandbox/`):
//   app.html       the whole-house application document, bootstrap inlined
//   firebase.json  hosting config carrying the CSP hash of *this* build
//
// Deploy with:
//   firebase deploy --only hosting --config dist-sandbox/firebase.json
//
// The two files are one unit. `app.html` served without the generated headers
// is an unsandboxed page that still looks correct, which is why the config is
// emitted next to it rather than checked in: the script-src hash changes
// whenever the bootstrap does.

import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { buildAppDocument } from '../src/app-document';
import { buildSandboxHostingConfig } from '../src/sandbox-document';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') {
    throw new Error(`${name} must be set; the sandbox boundary is never guessed`);
  }
  return value.trim();
}

async function bundleBootstrap(entry = 'src/app-bootstrap.ts'): Promise<string> {
  const result = await build({
    absWorkingDir: packageRoot,
    entryPoints: [entry],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: ['es2022'],
    write: false,
    sourcemap: false,
    legalComments: 'none',
    minify: true,
  });
  const output = result.outputFiles[0];
  if (!output) {
    throw new Error('bootstrap bundle produced no output');
  }
  return output.text;
}

async function main(): Promise<void> {
  const sandboxOrigin = required('MIAKAPP_SANDBOX_ORIGIN');
  const hostOrigin = required('MIAKAPP_HOST_ORIGIN');
  const site = required('MIAKAPP_SANDBOX_SITE');
  const outDir = resolve(process.env.MIAKAPP_SANDBOX_OUT_DIR?.trim() || 'dist-sandbox');

  const appDocument = await buildAppDocument({
    bootstrapSource: await bundleBootstrap(),
    hostOrigin,
    sandboxOrigin,
  });
  const config = buildSandboxHostingConfig({
    site,
    documents: [{ path: appDocument.path, headers: appDocument.headers }],
  });

  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, 'app.html'), appDocument.html, 'utf8');
  await writeFile(join(outDir, 'firebase.json'), `${JSON.stringify(config, null, 2)}\n`, 'utf8');

  // Printed so a deployment can be checked against what was built.
  process.stdout.write(
    [
      `sandbox origin   ${sandboxOrigin}`,
      `host origin      ${hostOrigin}`,
      `hosting site     ${site}`,
      `app.html         sha256:${createHash('sha256').update(appDocument.html).digest('hex')} (script sha256-${appDocument.scriptHash})`,
      `output           ${outDir}`,
      '',
    ].join('\n'),
  );
}

await main();
