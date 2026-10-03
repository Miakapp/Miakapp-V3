// The deliverable `/app.html`: the document a whole-house application runs in.
//
// It sits beside `/sandbox.html` on the same dedicated sandbox site and follows
// the same rule: the HTML and the headers it is only safe under are produced by
// one function, because the confinement lives in the headers.
//
// The policy differs from the semantic broker's on purpose. A house app owns a
// document, so it may style it inline, draw from `data:`/`blob:` images and
// fonts, run WebAssembly and evaluate code — none of which widens its authority,
// since it already runs arbitrary script. What it keeps from the broker is what
// actually bounds that authority: an opaque origin (no `allow-same-origin`), no
// network of any kind, no navigation of anything but itself, no framing, no
// popups, and no powerful features.

import { APP_DOCUMENT_PATH } from './app-contract';
import { SANDBOX_DISABLED_FEATURES } from './security-profile';
import { SandboxDocumentError, type SandboxHeader } from './sandbox-document';

export interface AppDocumentInput {
  /** The bundled `app-bootstrap.ts` source, inlined into the document. */
  readonly bootstrapSource: string;
  readonly hostOrigin: string;
  readonly sandboxOrigin: string;
}

export interface AppDocument {
  readonly path: typeof APP_DOCUMENT_PATH;
  readonly html: string;
  readonly scriptHash: string;
  readonly headers: readonly SandboxHeader[];
}

/**
 * Sandbox tokens the frame is created with and the document re-asserts. Forms
 * are allowed so a house can use a `<form>` and its submit event; `form-action
 * 'none'` keeps a submission from ever leaving the document.
 */
export const APP_SANDBOX_TOKENS = Object.freeze(['allow-scripts', 'allow-forms'] as const);

export const APP_DENY_DIRECTIVES = Object.freeze([
  "default-src 'none'",
  "script-src-attr 'none'",
  "connect-src 'none'",
  "frame-src 'none'",
  "manifest-src 'none'",
  "object-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
] as const);

function assertDeployOrigin(value: string, label: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new SandboxDocumentError(`${label} is not a URL`);
  }
  if (parsed.protocol !== 'https:') throw new SandboxDocumentError(`${label} must be HTTPS`);
  if (parsed.origin !== value.replace(/\/+$/u, '')) {
    throw new SandboxDocumentError(`${label} must carry no path, query or fragment`);
  }
  return parsed.origin;
}

async function sha256Base64(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  let binary = '';
  for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** The CSP for a given bootstrap hash. Exported so test servers serve the same one. */
export function appContentSecurityPolicy(scriptHash: string, hostOrigin: string): string {
  return [
    `sandbox ${APP_SANDBOX_TOKENS.join(' ')}`,
    ...APP_DENY_DIRECTIVES,
    // The release itself arrives as a blob: module created by the bootstrap.
    `script-src 'sha256-${scriptHash}' blob: 'unsafe-eval' 'wasm-unsafe-eval'`,
    // Workers inherit this policy, so a house may compute off-thread without
    // gaining a network the document does not have.
    'worker-src blob:',
    'child-src blob:',
    "style-src 'unsafe-inline' blob: data:",
    'img-src data: blob:',
    'font-src data: blob:',
    'media-src data: blob:',
    `frame-ancestors ${hostOrigin}`,
  ].join('; ');
}

export function appPermissionsPolicy(): string {
  return SANDBOX_DISABLED_FEATURES.map((feature) => `${feature}=()`).join(', ');
}

export async function buildAppDocument(input: AppDocumentInput): Promise<AppDocument> {
  const hostOrigin = assertDeployOrigin(input.hostOrigin, 'host origin');
  const sandboxOrigin = assertDeployOrigin(input.sandboxOrigin, 'sandbox origin');
  if (hostOrigin === sandboxOrigin) {
    throw new SandboxDocumentError('sandbox origin must differ from the host origin');
  }
  if (input.bootstrapSource.trim() === '') {
    throw new SandboxDocumentError('app bootstrap source is empty');
  }

  const script = input.bootstrapSource.replace(/<\/script/giu, '<\\/script');
  const scriptHash = await sha256Base64(script);

  const html = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><title>Miakapp</title></head>
  <body><script type="module">${script}</script></body>
</html>
`;

  return {
    path: APP_DOCUMENT_PATH,
    html,
    scriptHash,
    headers: [
      { key: 'Content-Type', value: 'text/html; charset=utf-8' },
      { key: 'Content-Security-Policy', value: appContentSecurityPolicy(scriptHash, hostOrigin) },
      { key: 'Permissions-Policy', value: appPermissionsPolicy() },
      { key: 'Referrer-Policy', value: 'no-referrer' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Cache-Control', value: 'no-store' },
      { key: 'Cross-Origin-Resource-Policy', value: 'cross-origin' },
    ],
  };
}
