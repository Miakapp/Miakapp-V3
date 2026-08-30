import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { SANDBOX_DENY_DIRECTIVES, SANDBOX_DISABLED_FEATURES } from '../src/security-profile';

const port = 4173;
const root = new URL('../', import.meta.url);

async function bundle(entry: string): Promise<string> {
  const result = await build({
    absWorkingDir: root.pathname,
    entryPoints: [entry],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: ['es2022'],
    write: false,
    sourcemap: false,
    legalComments: 'none',
  });
  return result.outputFiles[0]!.text;
}

const brokerBundle = (await bundle('src/runtime-broker.ts')).replace(/<\/script/giu, '<\\/script');
const hostBundle = await bundle('src/host-harness.ts');
const brokerHash = createHash('sha256').update(brokerBundle).digest('base64');
const sandboxOrigin = `http://localhost:${port}`;
const hostOrigin = `http://127.0.0.1:${port}`;

const hostHtml = `<!doctype html>
<html lang="en" data-sandbox-origin="${sandboxOrigin}">
  <head>
    <meta charset="utf-8">
    <meta name="host-secret" content="firebase-secret-must-not-cross">
    <title>Miakapp runtime host</title>
  </head>
  <body>
    <div id="trusted-status" role="status">Trusted host ready</div>
    <div id="generated"></div>
    <script type="module" src="/host.js"></script>
  </body>
</html>`;

const sandboxHtml = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>Miakapp runtime broker</title></head>
  <body><script type="module">${brokerBundle}</script></body>
</html>`;

const sandboxCsp = [
  "sandbox allow-scripts",
  `script-src 'sha256-${brokerHash}'`,
  ...SANDBOX_DENY_DIRECTIVES,
  'worker-src blob:',
  'child-src blob:',
  `frame-ancestors ${hostOrigin}`,
].join('; ');

const permissionsPolicy = SANDBOX_DISABLED_FEATURES.map((feature) => `${feature}=()`).join(', ');

function response(body: BodyInit | null, init: ResponseInit = {}): Response {
  return new Response(body, init);
}

Bun.serve({
  hostname: '0.0.0.0',
  port,
  fetch(request) {
    const url = new URL(request.url);
    const hostname = url.hostname;
    if (url.pathname === '/host.html' && hostname === '127.0.0.1') {
      return response(hostHtml, {
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'content-security-policy': `default-src 'none'; script-src 'self'; frame-src ${sandboxOrigin}; connect-src 'self'; base-uri 'none'; form-action 'none'`,
          'referrer-policy': 'no-referrer',
          'x-content-type-options': 'nosniff',
          'cache-control': 'no-store',
        },
      });
    }
    if (url.pathname === '/host.js' && hostname === '127.0.0.1') {
      return response(hostBundle, {
        headers: {
          'content-type': 'text/javascript; charset=utf-8',
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
        },
      });
    }
    if (url.pathname === '/sandbox.html' && hostname === 'localhost') {
      return response(sandboxHtml, {
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'content-security-policy': sandboxCsp,
          'permissions-policy': permissionsPolicy,
          'referrer-policy': 'no-referrer',
          'x-content-type-options': 'nosniff',
          'cache-control': 'no-store',
          'cross-origin-resource-policy': 'cross-origin',
        },
      });
    }
    if (url.pathname === '/leak-module.mjs') {
      return response('export default true;', {
        headers: { 'content-type': 'text/javascript' },
      });
    }
    if (url.pathname === '/leak') return response(null, { status: 204 });
    if (url.pathname === '/health') return response('ok');
    return response('not found', { status: 404 });
  },
});

console.info(`runtime harness listening on ${hostOrigin}`);
