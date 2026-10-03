import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { SANDBOX_DENY_DIRECTIVES, SANDBOX_DISABLED_FEATURES } from '../src/security-profile';
import { appContentSecurityPolicy, appPermissionsPolicy } from '../src/app-document';

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
const artifactCacheBundle = await bundle('src/artifact-cache.ts');
const brokerHash = createHash('sha256').update(brokerBundle).digest('base64');
const sandboxOrigin = `http://localhost:${port}`;
const hostOrigin = `http://127.0.0.1:${port}`;
const releaseStateBundle = await bundle('src/release-state.ts');

// The house-app corpus: the deployed `/app.html` policy, built by the same
// function the sandbox site build uses, and a host page that plays the shell.
const appBootstrap = (await bundle('src/app-bootstrap.ts')).replace(/<\/script/giu, '<\\/script');
const appBootstrapHash = createHash('sha256').update(appBootstrap).digest('base64');
const appHarnessBundle = await bundle('test/app-harness.ts');
const appHtml = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>Miakapp</title></head>
  <body><script type="module">${appBootstrap}</script></body>
</html>`;
const appHostHtml = `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8">
    <title>Miakapp shell</title>
    <style>
      body { margin: 0; height: 100vh; display: flex; flex-direction: column; }
      #shell-bar { height: 48px; flex: none; display: flex; align-items: center; padding: 0 12px; background: #141713; }
      #stage { flex: 1; position: relative; }
      #stage iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; }
    </style>
  </head>
  <body>
    <header id="shell-bar"><button id="shell-menu" type="button">Menu Miakapp</button></header>
    <main id="stage"></main>
    <script>localStorage.setItem('shell-secret', 'session-must-not-cross');</script>
    <script type="module" src="/app-harness.js"></script>
  </body>
</html>`;
const appHostInline = createHash('sha256')
  .update("localStorage.setItem('shell-secret', 'session-must-not-cross');")
  .digest('base64');

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

// The no-prelude boundary experiment. This document is served with byte-identical
// security headers to /sandbox.html so the only difference from the deployed
// runtime is the missing confinement prelude. Whatever the probe still cannot do
// here is denied by the browser rather than by our JavaScript.
const boundaryProbe = await Bun.file(new URL('../fixtures/boundary-probe.mjs', import.meta.url)).text();
const boundaryScript = `
  const source = ${JSON.stringify(boundaryProbe)};
  const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
  // Classic, exactly like RuntimeBroker creates the guest Worker. A module
  // worker would make importScripts absent for reasons unrelated to security.
  const worker = new Worker(url, { type: 'classic' });
  const publish = (text) => {
    const node = document.getElementById('observations');
    node.textContent = text;
    node.dataset.done = 'true';
  };
  worker.onmessage = (event) => publish(event.data);
  worker.onerror = (event) => publish('worker-error:' + (event.message || 'unknown'));
`;
const boundaryHash = createHash('sha256').update(boundaryScript).digest('base64');

const boundaryHtml = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>Miakapp boundary probe</title></head>
  <body>
    <div id="observations">probe running</div>
    <script>${boundaryScript}</script>
  </body>
</html>`;

const sandboxCsp = [
  "sandbox allow-scripts",
  `script-src 'sha256-${brokerHash}'`,
  ...SANDBOX_DENY_DIRECTIVES,
  'worker-src blob:',
  'child-src blob:',
  `frame-ancestors ${hostOrigin}`,
].join('; ');

// Identical to sandboxCsp apart from the inline script it authorises, so the
// experiment cannot accidentally weaken the policy it is measuring.
const boundaryCsp = [
  'sandbox allow-scripts',
  `script-src 'sha256-${boundaryHash}'`,
  ...SANDBOX_DENY_DIRECTIVES,
  'worker-src blob:',
  'child-src blob:',
  `frame-ancestors ${hostOrigin}`,
].join('; ');

const permissionsPolicy = SANDBOX_DISABLED_FEATURES.map((feature) => `${feature}=()`).join(', ');

function response(body: BodyInit | null, init: ResponseInit = {}): Response {
  return new Response(body, init);
}

// Server-side egress evidence. A request observed by the browser's devtools
// protocol may still have been refused before dispatch; a request recorded here
// definitively left the browser and reached a remote listener.
let leakHits: string[] = [];

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
    if (url.pathname === '/artifact-cache.js' && hostname === '127.0.0.1') {
      return response(artifactCacheBundle, {
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
    if (url.pathname === '/boundary.html' && hostname === 'localhost') {
      return response(boundaryHtml, {
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'content-security-policy': boundaryCsp,
          'permissions-policy': permissionsPolicy,
          'referrer-policy': 'no-referrer',
          'x-content-type-options': 'nosniff',
          'cache-control': 'no-store',
          'cross-origin-resource-policy': 'cross-origin',
        },
      });
    }
    if (url.pathname === '/leak-hits' && hostname === '127.0.0.1') {
      return response(JSON.stringify(leakHits), {
        headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
      });
    }
    if (url.pathname === '/leak-reset' && hostname === '127.0.0.1') {
      leakHits = [];
      return response('ok', { headers: { 'cache-control': 'no-store' } });
    }
    if (url.pathname === '/leak-module.mjs') {
      leakHits.push(request.url);
      return response('export default true;', {
        headers: { 'content-type': 'text/javascript' },
      });
    }
    if (url.pathname === '/leak') {
      leakHits.push(request.url);
      return response(null, { status: 204 });
    }
    if (url.pathname === '/release-state.js' && hostname === '127.0.0.1') {
      return response(releaseStateBundle, {
        headers: {
          'content-type': 'text/javascript; charset=utf-8',
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
        },
      });
    }
    if (url.pathname === '/app-host.html' && hostname === '127.0.0.1') {
      return response(appHostHtml, {
        headers: {
          'content-type': 'text/html; charset=utf-8',
          // `frame-src` is the shell's half of the boundary: the house frame
          // may only ever hold a document from the sandbox origin.
          'content-security-policy': `default-src 'none'; script-src 'self' 'sha256-${appHostInline}'; style-src 'unsafe-inline'; frame-src ${sandboxOrigin}; connect-src 'self'; base-uri 'none'; form-action 'none'`,
          'cache-control': 'no-store',
        },
      });
    }
    if (url.pathname === '/app-harness.js' && hostname === '127.0.0.1') {
      return response(appHarnessBundle, {
        headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' },
      });
    }
    if (url.pathname === '/app.html' && hostname === 'localhost') {
      return response(appHtml, {
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'content-security-policy': appContentSecurityPolicy(appBootstrapHash, hostOrigin),
          'permissions-policy': appPermissionsPolicy(),
          'referrer-policy': 'no-referrer',
          'x-content-type-options': 'nosniff',
          'cache-control': 'no-store',
          'cross-origin-resource-policy': 'cross-origin',
        },
      });
    }
    if (url.pathname === '/health') return response('ok');
    return response('not found', { status: 404 });
  },
});

console.info(`runtime harness listening on ${hostOrigin}`);
