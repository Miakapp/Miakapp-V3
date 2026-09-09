import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';

const MODULE_ALLOWLIST_SCHEMA =
  'miakapp.browser-relay-trusted-provider-owner-module-allowlist/1';
const SAFE_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.?\/)(?!.*\\)[A-Za-z0-9._@+/-]+$/u;
const rootUrl = new URL('../../../', import.meta.url);
const allowlistUrl = new URL('module-allowlist.json', import.meta.url);

function reject() {
  throw new Error('Trusted provider owner module graph rejected');
}

let parsed;
try {
  parsed = JSON.parse(readFileSync(allowlistUrl, 'utf8'));
} catch {
  reject();
}
if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)
  || JSON.stringify(Object.keys(parsed)) !== JSON.stringify(['schema', 'modules'])
  || parsed.schema !== MODULE_ALLOWLIST_SCHEMA || !Array.isArray(parsed.modules)
  || parsed.modules.length < 1
  || JSON.stringify([...parsed.modules].sort()) !== JSON.stringify(parsed.modules)
  || new Set(parsed.modules).size !== parsed.modules.length
  || parsed.modules.some((path) => typeof path !== 'string' || !SAFE_PATH.test(path))) {
  reject();
}

const allowedModuleUrls = new Set(parsed.modules.map((path) => new URL(path, rootUrl).href));
const ownerUrl = new URL('owner.mjs', import.meta.url).href;
if (!allowedModuleUrls.has(import.meta.url) || !allowedModuleUrls.has(ownerUrl)) reject();
parsed = undefined;

registerHooks({
  resolve(specifier, context, nextResolve) {
    const resolution = nextResolve(specifier, context);
    if (resolution?.url?.startsWith('node:') || allowedModuleUrls.has(resolution?.url)) {
      return resolution;
    }
    return reject();
  },
});

const ownerModule = await import('./owner.mjs');
if (JSON.stringify(Object.keys(ownerModule))
  !== JSON.stringify(['createBrowserRelayTrustedProviderOwner'])
  || typeof ownerModule.createBrowserRelayTrustedProviderOwner !== 'function') reject();
const ownerFactory = ownerModule.createBrowserRelayTrustedProviderOwner;

export function createBrowserRelayTrustedProviderOwner() {
  if (arguments.length !== 0) reject();
  return Reflect.apply(ownerFactory, undefined, []);
}
