// A verifier that cannot fail is worse than no verifier: it turns "checked" into
// a claim nobody re-examines. So these cases feed it artifacts that the builder
// would never produce and require each one to be rejected, alongside the happy
// path where the builder's real output must pass.

import { describe, expect, it } from 'vitest';
import {
  buildSandboxDocument,
  buildSandboxHostingConfig,
} from '../../component-runtime/src/sandbox-document';
import {
  SandboxArtifactError,
  verifySandboxArtifact,
} from '../../component-runtime/src/sandbox-artifact';

const HOST_ORIGIN = 'https://app.miakapp.test';
const SANDBOX_ORIGIN = 'https://sandbox.miakapp.test';
const SITE = 'miakapp-sandbox';
const BROKER = 'globalThis.__broker = () => "runtime";';

interface Artifact {
  readonly html: string;
  readonly config: unknown;
}

/** Produces exactly what `build-sandbox.ts` writes to disk. */
async function emit(brokerSource = BROKER): Promise<Artifact> {
  const document = await buildSandboxDocument({
    brokerSource,
    hostOrigin: HOST_ORIGIN,
    sandboxOrigin: SANDBOX_ORIGIN,
  });
  const config = buildSandboxHostingConfig({ site: SITE, headers: document.headers });
  // Round-tripped through JSON because that is how the CLI reads it back, and a
  // value that does not survive serialisation should fail here too.
  return { html: document.html, config: JSON.parse(JSON.stringify(config)) as unknown };
}

function verify(artifact: Artifact) {
  return verifySandboxArtifact({
    ...artifact,
    sandboxOrigin: SANDBOX_ORIGIN,
    hostOrigin: HOST_ORIGIN,
    site: SITE,
  });
}

/** Rewrites the CSP in an emitted config without touching anything else. */
function withCsp(config: unknown, edit: (csp: string) => string): unknown {
  const clone = JSON.parse(JSON.stringify(config)) as {
    hosting: { headers: { headers: { key: string; value: string }[] }[] };
  };
  const rule = clone.hosting.headers[0];
  if (!rule) {
    throw new Error('emitted config carries no header rule');
  }
  const csp = rule.headers.find((header) => header.key === 'Content-Security-Policy');
  if (!csp) {
    throw new Error('emitted config carries no CSP');
  }
  csp.value = edit(csp.value);
  return clone;
}

describe('verifySandboxArtifact', () => {
  it('accepts what the builder emits and recomputes the served hash', async () => {
    const artifact = await emit();
    const report = await verify(artifact);

    // The point of the check: the hash is derived from the served bytes and then
    // found in the policy, rather than read back out of the builder. It lives in
    // the header only — the document carries no meta CSP to fall back on.
    expect(JSON.stringify(artifact.config)).toContain(`'sha256-${report.scriptHash}'`);
    expect(artifact.html).not.toContain('sha256-');
    expect(report.documentDigest).toMatch(/^[0-9a-f]{64}$/u);
    expect(report.scriptBytes).toBe(BROKER.length);
    expect(report.documentBytes).toBe(artifact.html.length);
  });

  it('accepts a broker that had to be escaped, hashing the escaped text', async () => {
    // The trap this whole module exists for: HTML does not unescape the
    // backslash, so the browser hashes the text carrying it.
    const artifact = await emit('const html = "</script>"; globalThis.__broker = html;');
    const report = await verify(artifact);
    expect(artifact.html).toContain('<\\/script');
    expect(report.scriptHash).not.toBe('');
  });

  it('rejects a document whose script was edited after the hash was declared', async () => {
    const artifact = await emit();
    const html = artifact.html.replace(BROKER, 'globalThis.__broker = () => "attacker";');
    expect(html).not.toBe(artifact.html);
    await expect(verify({ ...artifact, html })).rejects.toBeInstanceOf(SandboxArtifactError);
  });

  it('rejects a second inline script the policy never hashed', async () => {
    const artifact = await emit();
    const html = artifact.html.replace(
      '</body>',
      '<script type="module">globalThis.__extra = 1;</script></body>',
    );
    await expect(verify({ ...artifact, html })).rejects.toThrow(/more than one inline script/u);
  });

  it('rejects an unescaped </script> that truncates the element early', async () => {
    const artifact = await emit();
    const html = artifact.html.replace(BROKER, `${BROKER}</script><p>`);
    await expect(verify({ ...artifact, html })).rejects.toThrow(/exactly one <\/script>/u);
  });

  it('rejects a policy that allows any inline script beside the hash', async () => {
    const artifact = await emit();
    const config = withCsp(artifact.config, (csp) =>
      csp.replace(/script-src ([^;]+)/u, "script-src $1 'unsafe-inline'"),
    );
    await expect(verify({ ...artifact, config })).rejects.toThrow(/script-src/u);
  });

  it('rejects a sandbox directive that hands the document a real origin', async () => {
    const artifact = await emit();
    const config = withCsp(artifact.config, (csp) =>
      csp.replace('sandbox allow-scripts', 'sandbox allow-scripts allow-same-origin'),
    );
    await expect(verify({ ...artifact, config })).rejects.toThrow(/allow-scripts/u);
  });

  it('rejects a policy that lets any page frame the sandbox', async () => {
    const artifact = await emit();
    const config = withCsp(artifact.config, (csp) =>
      csp.replace(`frame-ancestors ${HOST_ORIGIN}`, 'frame-ancestors *'),
    );
    await expect(verify({ ...artifact, config })).rejects.toThrow(/frame-ancestors/u);
  });

  it('rejects a config that would answer unknown paths with a rewrite', async () => {
    const artifact = await emit();
    const config = JSON.parse(JSON.stringify(artifact.config)) as {
      hosting: Record<string, unknown>;
    };
    config.hosting.rewrites = [{ source: '**', destination: '/sandbox.html' }];
    await expect(verify({ ...artifact, config })).rejects.toThrow(/rewrites/u);
  });

  it('rejects a config built for a different hosting site', async () => {
    const artifact = await emit();
    await expect(
      verifySandboxArtifact({
        ...artifact,
        sandboxOrigin: SANDBOX_ORIGIN,
        hostOrigin: HOST_ORIGIN,
        site: 'some-other-site',
      }),
    ).rejects.toThrow(/site/u);
  });

  it('rejects a build whose two origins collapsed into one', async () => {
    const artifact = await emit();
    await expect(
      verifySandboxArtifact({
        ...artifact,
        sandboxOrigin: HOST_ORIGIN,
        hostOrigin: HOST_ORIGIN,
        site: SITE,
      }),
    ).rejects.toThrow(/cross-origin/u);
  });

  it('rejects an artifact served without its containment headers', async () => {
    const artifact = await emit();
    await expect(
      verify({ ...artifact, config: { hosting: { site: SITE, headers: [] } } }),
    ).rejects.toBeInstanceOf(SandboxArtifactError);
  });
});
