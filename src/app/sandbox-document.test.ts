// The sandbox document is the other half of `component-runtime-host.ts`, so it
// is covered by the same suite that gates the host: the two have to agree about
// the origin rules, and a change to either that breaks that agreement should
// turn one suite red rather than surface in a browser.

import { describe, expect, it } from 'vitest';
import {
  buildSandboxDocument,
  buildSandboxHostingConfig,
  SandboxDocumentError,
} from '../../component-runtime/src/sandbox-document';
import {
  SANDBOX_DENY_DIRECTIVES,
  SANDBOX_DISABLED_FEATURES,
} from '../../component-runtime/src/security-profile';
import { assertSandboxOrigin } from './component-runtime-host';

const HOST_ORIGIN = 'https://app.miakapp.test';
const SANDBOX_ORIGIN = 'https://sandbox.miakapp.test';
const BROKER = 'globalThis.__broker = () => "runtime";';

function build(overrides: Partial<Parameters<typeof buildSandboxDocument>[0]> = {}) {
  return buildSandboxDocument({
    brokerSource: BROKER,
    hostOrigin: HOST_ORIGIN,
    sandboxOrigin: SANDBOX_ORIGIN,
    ...overrides,
  });
}

function headerValue(headers: readonly { key: string; value: string }[], key: string): string {
  const found = headers.find((header) => header.key.toLowerCase() === key.toLowerCase());
  if (!found) {
    throw new Error(`missing header ${key}`);
  }
  return found.value;
}

describe('buildSandboxDocument', () => {
  it('serves the one path the host requests', async () => {
    const document = await build();
    expect(document.path).toBe('/sandbox.html');
    expect(document.html).toContain(BROKER);
    expect(document.html.startsWith('<!doctype html>')).toBe(true);
  });

  it('keeps the document opaque by withholding allow-same-origin', async () => {
    const csp = headerValue((await build()).headers, 'content-security-policy');
    expect(csp).toContain('sandbox allow-scripts');
    expect(csp).not.toContain('allow-same-origin');
  });

  it('binds the inline script by hash, computed over the escaped text', async () => {
    const document = await build();
    const csp = headerValue(document.headers, 'content-security-policy');
    expect(csp).toContain(`script-src 'sha256-${document.scriptHash}'`);

    // The hash has to cover exactly what sits between the script tags.
    const inline = document.html.slice(
      document.html.indexOf('<script type="module">') + '<script type="module">'.length,
      document.html.indexOf('</script>'),
    );
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(inline));
    let binary = '';
    for (const byte of new Uint8Array(digest)) {
      binary += String.fromCharCode(byte);
    }
    expect(btoa(binary)).toBe(document.scriptHash);
  });

  it('prevents a bundle from closing its own script element', async () => {
    const document = await build({ brokerSource: 'const a = "</script><img>";' });
    expect(document.html).toContain('<\\/script>');
    expect(document.html.indexOf('</script>')).toBe(document.html.lastIndexOf('</script>'));
  });

  it('carries every deny directive from the security profile', async () => {
    const csp = headerValue((await build()).headers, 'content-security-policy');
    for (const directive of SANDBOX_DENY_DIRECTIVES) {
      expect(csp).toContain(directive);
    }
  });

  it('disables every feature the security profile names', async () => {
    const policy = headerValue((await build()).headers, 'permissions-policy');
    for (const feature of SANDBOX_DISABLED_FEATURES) {
      expect(policy).toContain(`${feature}=()`);
    }
  });

  it('allows the guest worker and nothing else to be framed', async () => {
    const csp = headerValue((await build()).headers, 'content-security-policy');
    expect(csp).toContain('worker-src blob:');
    expect(csp).toContain('child-src blob:');
    expect(csp).toContain("frame-src 'none'");
  });

  it('lets only the declared host origin frame it', async () => {
    const csp = headerValue((await build()).headers, 'content-security-policy');
    expect(csp).toContain(`frame-ancestors ${HOST_ORIGIN}`);
  });

  it('stays readable cross-origin and uncached', async () => {
    const headers = (await build()).headers;
    expect(headerValue(headers, 'cross-origin-resource-policy')).toBe('cross-origin');
    expect(headerValue(headers, 'cache-control')).toBe('no-store');
    expect(headerValue(headers, 'x-content-type-options')).toBe('nosniff');
    expect(headerValue(headers, 'referrer-policy')).toBe('no-referrer');
  });

  it('refuses a plaintext origin', async () => {
    await expect(build({ sandboxOrigin: 'http://sandbox.miakapp.test' })).rejects.toBeInstanceOf(
      SandboxDocumentError,
    );
    await expect(build({ hostOrigin: 'http://app.miakapp.test' })).rejects.toBeInstanceOf(
      SandboxDocumentError,
    );
  });

  it('refuses an origin carrying a path', async () => {
    await expect(build({ sandboxOrigin: 'https://sandbox.miakapp.test/run' })).rejects.toBeInstanceOf(
      SandboxDocumentError,
    );
  });

  it('refuses to build a same-origin sandbox', async () => {
    await expect(build({ sandboxOrigin: HOST_ORIGIN })).rejects.toThrow(/must differ/u);
  });

  it('refuses an empty bundle', async () => {
    await expect(build({ brokerSource: '   ' })).rejects.toBeInstanceOf(SandboxDocumentError);
  });

  it('agrees with the origin rule the host enforces at mount time', async () => {
    const document = await build();
    // What we are willing to build must be what the host is willing to mount.
    expect(assertSandboxOrigin(SANDBOX_ORIGIN, HOST_ORIGIN)).toBe(SANDBOX_ORIGIN);
    expect(document.headers.length).toBeGreaterThan(0);
    expect(() => assertSandboxOrigin(HOST_ORIGIN, HOST_ORIGIN)).toThrow();
  });
});

describe('buildSandboxHostingConfig', () => {
  it('pins the headers to the sandbox path and declares no rewrite', async () => {
    const document = await build();
    const config = buildSandboxHostingConfig({
      site: 'miakapp-3-sandbox',
      headers: document.headers,
    }) as {
      hosting: {
        site: string;
        public: string;
        rewrites?: unknown;
        headers: { source: string; headers: { key: string; value: string }[] }[];
      };
    };

    expect(config.hosting.site).toBe('miakapp-3-sandbox');
    expect(config.hosting.public).toBe('.');
    // An unknown path must 404 rather than inherit the sandbox headers.
    expect(config.hosting.rewrites).toBeUndefined();
    expect(config.hosting.headers).toHaveLength(1);
    expect(config.hosting.headers[0]!.source).toBe('/sandbox.html');
    expect(config.hosting.headers[0]!.headers.map((header) => header.key)).toEqual(
      document.headers.map((header) => header.key),
    );
  });

  it('refuses an undeclared site', () => {
    expect(() => buildSandboxHostingConfig({ site: '', headers: [] })).toThrow(SandboxDocumentError);
  });
});
