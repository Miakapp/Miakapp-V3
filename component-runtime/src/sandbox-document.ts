// The deliverable sandbox document.
//
// `mountComponentRuntime` points a frame at `${sandboxOrigin}/sandbox.html` and
// refuses to bind unless the frame reports the opaque origin `"null"`. Until now
// the only document that satisfied it lived in `test/server.ts`, so no
// deployment could serve one: the host half existed with nowhere to point.
//
// This module builds that document and, just as importantly, the headers it is
// only safe under. The confinement is carried by `Content-Security-Policy` and
// `Permissions-Policy` response headers, not by anything inside the file, so the
// HTML and the headers are produced together by one function. Emitting the file
// without its headers would serve an unsandboxed page that still looks correct.
//
// The policy is derived from `security-profile.ts` rather than restated, so a
// directive added there reaches the deployed sandbox without a second edit.

import { SANDBOX_DENY_DIRECTIVES, SANDBOX_DISABLED_FEATURES } from './security-profile';

export interface SandboxDocumentInput {
  /** The bundled `runtime-broker.ts` source, inlined into the document. */
  readonly brokerSource: string;
  /** The trusted origin allowed to frame the sandbox. */
  readonly hostOrigin: string;
  /** The origin that will serve this document. */
  readonly sandboxOrigin: string;
}

export interface SandboxHeader {
  readonly key: string;
  readonly value: string;
}

export interface SandboxDocument {
  /** The path the host hardcodes; the document is not servable anywhere else. */
  readonly path: '/sandbox.html';
  readonly html: string;
  /** Base64 SHA-256 of the inline script, as it appears in `html`. */
  readonly scriptHash: string;
  readonly headers: readonly SandboxHeader[];
}

export class SandboxDocumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SandboxDocumentError';
  }
}

/**
 * Accepts only a bare HTTPS origin.
 *
 * This mirrors `assertSandboxOrigin` in the host: a deployment that declares a
 * URL with a path, or a plaintext origin, is a misconfiguration we refuse to
 * build for rather than one the host discovers at mount time in a browser.
 */
function assertDeployOrigin(value: string, label: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new SandboxDocumentError(`${label} is not a URL`);
  }
  if (parsed.protocol !== 'https:') {
    throw new SandboxDocumentError(`${label} must be HTTPS`);
  }
  if (parsed.origin !== value.replace(/\/+$/u, '')) {
    throw new SandboxDocumentError(`${label} must carry no path, query or fragment`);
  }
  return parsed.origin;
}

async function sha256Base64(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  let binary = '';
  for (const byte of new Uint8Array(digest)) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

/**
 * Neutralises `</script` so the bundle cannot close its own element.
 *
 * The escape is applied *before* hashing because HTML does not unescape it: the
 * script element's text content, which the browser hashes for CSP, contains the
 * backslash. Hashing the unescaped source would produce a document the browser
 * then refuses to run.
 */
function inlineScriptText(brokerSource: string): string {
  return brokerSource.replace(/<\/script/giu, '<\\/script');
}

export async function buildSandboxDocument(input: SandboxDocumentInput): Promise<SandboxDocument> {
  const hostOrigin = assertDeployOrigin(input.hostOrigin, 'host origin');
  const sandboxOrigin = assertDeployOrigin(input.sandboxOrigin, 'sandbox origin');
  if (hostOrigin === sandboxOrigin) {
    // The whole containment rests on the frame being cross-origin and opaque.
    // Serving both halves from one site would leave the host trusting a frame
    // that shares its storage, and the host would refuse to bind anyway.
    throw new SandboxDocumentError('sandbox origin must differ from the host origin');
  }
  if (input.brokerSource.trim() === '') {
    throw new SandboxDocumentError('broker source is empty');
  }

  const script = inlineScriptText(input.brokerSource);
  const scriptHash = await sha256Base64(script);

  const csp = [
    // No `allow-same-origin`: the document's origin stays opaque, which is the
    // single fact the host verifies before binding the port.
    'sandbox allow-scripts',
    `script-src 'sha256-${scriptHash}'`,
    ...SANDBOX_DENY_DIRECTIVES,
    // The broker runs guest code in a blob: Worker; nothing else may be framed.
    'worker-src blob:',
    'child-src blob:',
    `frame-ancestors ${hostOrigin}`,
  ].join('; ');

  const permissionsPolicy = SANDBOX_DISABLED_FEATURES.map((feature) => `${feature}=()`).join(', ');

  const html = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>Miakapp component runtime sandbox</title></head>
  <body><script type="module">${script}</script></body>
</html>
`;

  return {
    path: '/sandbox.html',
    html,
    scriptHash,
    headers: [
      { key: 'Content-Type', value: 'text/html; charset=utf-8' },
      { key: 'Content-Security-Policy', value: csp },
      { key: 'Permissions-Policy', value: permissionsPolicy },
      { key: 'Referrer-Policy', value: 'no-referrer' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Cache-Control', value: 'no-store' },
      // The host frames this document from another origin, so it must be
      // readable cross-origin; nothing in it is secret.
      { key: 'Cross-Origin-Resource-Policy', value: 'cross-origin' },
    ],
  };
}

export interface SandboxHostingConfigInput {
  readonly site: string;
  readonly headers: readonly SandboxHeader[];
}

/**
 * The Firebase Hosting config for the sandbox site.
 *
 * It declares no rewrite on purpose. The host requests exactly one path, and an
 * unknown path must 404 rather than fall through to a document served under the
 * sandbox's headers.
 */
export function buildSandboxHostingConfig(input: SandboxHostingConfigInput): unknown {
  if (input.site.trim() === '') {
    throw new SandboxDocumentError('hosting site is empty');
  }
  return {
    hosting: {
      site: input.site,
      public: '.',
      ignore: ['firebase.json'],
      headers: [
        {
          source: '/sandbox.html',
          headers: input.headers.map((header) => ({ key: header.key, value: header.value })),
        },
      ],
    },
  };
}
