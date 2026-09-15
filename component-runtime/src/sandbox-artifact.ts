// Independent verification of an emitted sandbox artifact.
//
// `build-sandbox.ts` writes `sandbox.html` and the `firebase.json` that carries
// its headers. The unit tests around `sandbox-document.ts` prove the *builder*
// is correct given a broker source; they say nothing about the bytes that end up
// on disk after esbuild bundles the real broker and minifies it.
//
// That gap matters for exactly one reason: the CSP `script-src` hash is computed
// over the escaped script text, so any change in what the bundler emits — a
// minifier that starts producing `</script` inside a string literal, a banner,
// a trailing newline written differently — yields a document the browser loads
// and then refuses to execute. The failure is silent at build time and total at
// runtime.
//
// So this module re-derives the digest from the served bytes instead of reusing
// `sandbox-document.ts`. Importing the builder's own hashing here would make the
// check a tautology: it would agree with itself no matter what was written. It
// hashes through Web Crypto rather than `node:crypto` because this package is
// type-checked as browser code, and because that is the same primitive the
// browser applies to the element it is about to run.

export interface SandboxArtifactInput {
  /** The exact bytes of the emitted `sandbox.html`, decoded as UTF-8. */
  readonly html: string;
  /** The parsed `firebase.json` emitted alongside it. */
  readonly config: unknown;
  /** The origin the build was told would serve the document. */
  readonly sandboxOrigin: string;
  /** The origin the build was told is allowed to frame it. */
  readonly hostOrigin: string;
  /** The Hosting site the build was told to target. */
  readonly site: string;
}

export interface SandboxArtifactReport {
  /** Base64 SHA-256 recomputed from the served script text. */
  readonly scriptHash: string;
  /** Hex SHA-256 of the whole document, to identify a deployment. */
  readonly documentDigest: string;
  readonly scriptBytes: number;
  readonly documentBytes: number;
}

const encoder = new TextEncoder();

async function digest(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text)));
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export class SandboxArtifactError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SandboxArtifactError';
  }
}

function fail(message: string): never {
  throw new SandboxArtifactError(message);
}

const SCRIPT_OPEN = '<script type="module">';
const SCRIPT_CLOSE = '</script>';

/**
 * Pulls out the text the browser will hash for CSP.
 *
 * The document is generated, not authored, so this deliberately refuses
 * anything but the single expected element rather than parsing HTML loosely. A
 * second script element would be a second thing to hash, and CSP would block
 * whichever one was not declared.
 */
function extractInlineScript(html: string): string {
  const open = html.indexOf(SCRIPT_OPEN);
  if (open === -1) {
    fail(`no ${SCRIPT_OPEN} element in the document`);
  }
  if (html.indexOf(SCRIPT_OPEN, open + 1) !== -1) {
    fail('more than one inline script element');
  }
  // Counted over the whole file, not searched from the opening tag: a stray
  // `</script>` anywhere means the element the browser sees ends somewhere
  // other than where the builder thinks it does.
  const closes = html.split(SCRIPT_CLOSE).length - 1;
  if (closes !== 1) {
    fail(`expected exactly one ${SCRIPT_CLOSE}, found ${closes}`);
  }
  const start = open + SCRIPT_OPEN.length;
  const end = html.indexOf(SCRIPT_CLOSE, start);
  if (end === -1) {
    fail('inline script element is unterminated');
  }
  const script = html.slice(start, end);
  if (script.trim() === '') {
    fail('inline script is empty');
  }
  // `</script` in any case would have closed the element above; reaching here
  // with one present means it survived in a form the counter missed.
  if (/<\/script/iu.test(script)) {
    fail('inline script still contains an unescaped </script sequence');
  }
  return script;
}

function readHeaders(config: unknown, site: string): ReadonlyMap<string, string> {
  if (typeof config !== 'object' || config === null) {
    fail('hosting config is not an object');
  }
  const hosting = (config as { hosting?: unknown }).hosting;
  if (typeof hosting !== 'object' || hosting === null) {
    fail('hosting config has no hosting section');
  }
  const section = hosting as Record<string, unknown>;
  if (section.site !== site) {
    fail(`hosting config targets site ${String(section.site)}, expected ${site}`);
  }
  // A rewrite would let an unknown path be answered by a document served under
  // the sandbox's headers. The host requests one path; everything else 404s.
  if (section.rewrites !== undefined) {
    fail('hosting config declares rewrites; unknown paths must 404');
  }
  const headerRules = section.headers;
  if (!Array.isArray(headerRules) || headerRules.length !== 1) {
    fail('hosting config must declare exactly one header rule');
  }
  const rule = headerRules[0] as { source?: unknown; headers?: unknown };
  if (rule.source !== '/sandbox.html') {
    fail(`header rule covers ${String(rule.source)}, expected /sandbox.html`);
  }
  if (!Array.isArray(rule.headers)) {
    fail('header rule carries no headers');
  }
  const headers = new Map<string, string>();
  for (const entry of rule.headers as readonly unknown[]) {
    const header = entry as { key?: unknown; value?: unknown };
    if (typeof header.key !== 'string' || typeof header.value !== 'string') {
      fail('header entry is not a key/value pair of strings');
    }
    headers.set(header.key.toLowerCase(), header.value);
  }
  return headers;
}

function directives(csp: string): ReadonlyMap<string, string> {
  const map = new Map<string, string>();
  for (const part of csp.split(';')) {
    const trimmed = part.trim();
    if (trimmed === '') {
      continue;
    }
    const space = trimmed.indexOf(' ');
    const name = space === -1 ? trimmed : trimmed.slice(0, space);
    map.set(name.toLowerCase(), space === -1 ? '' : trimmed.slice(space + 1).trim());
  }
  return map;
}

/**
 * Checks the emitted artifact against the boundary the build was given.
 *
 * Throws on the first inconsistency; returns the digests a deployment can be
 * identified by. Every assertion here is about the *served* bytes, so it holds
 * regardless of how the document was produced.
 */
export async function verifySandboxArtifact(
  input: SandboxArtifactInput,
): Promise<SandboxArtifactReport> {
  const script = extractInlineScript(input.html);
  const scriptHash = toBase64(await digest(script));

  const headers = readHeaders(input.config, input.site);
  const csp = headers.get('content-security-policy');
  if (csp === undefined) {
    fail('no Content-Security-Policy header');
  }
  const policy = directives(csp);

  const scriptSrc = policy.get('script-src');
  if (scriptSrc === undefined) {
    fail('CSP declares no script-src');
  }
  // Exactly the hash, nothing beside it: a second source would let the sandbox
  // run code the build never hashed.
  if (scriptSrc !== `'sha256-${scriptHash}'`) {
    fail(
      `CSP script-src is ${scriptSrc}, but the served script hashes to 'sha256-${scriptHash}'`,
    );
  }

  const sandbox = policy.get('sandbox');
  if (sandbox === undefined) {
    fail('CSP declares no sandbox directive');
  }
  if (sandbox !== 'allow-scripts') {
    // `allow-same-origin` in particular would give the document a real origin,
    // and the host refuses to bind to anything but the opaque `"null"`.
    fail(`CSP sandbox is "${sandbox}", expected exactly "allow-scripts"`);
  }

  const frameAncestors = policy.get('frame-ancestors');
  if (frameAncestors !== input.hostOrigin) {
    fail(`CSP frame-ancestors is ${String(frameAncestors)}, expected ${input.hostOrigin}`);
  }

  if (input.sandboxOrigin === input.hostOrigin) {
    fail('sandbox origin equals host origin; the frame would not be cross-origin');
  }

  const permissionsPolicy = headers.get('permissions-policy');
  if (permissionsPolicy === undefined || permissionsPolicy.trim() === '') {
    fail('no Permissions-Policy header');
  }
  for (const required of ['referrer-policy', 'x-content-type-options', 'content-type']) {
    if (headers.get(required) === undefined) {
      fail(`no ${required} header`);
    }
  }

  return {
    scriptHash,
    documentDigest: toHex(await digest(input.html)),
    scriptBytes: encoder.encode(script).length,
    documentBytes: encoder.encode(input.html).length,
  };
}
