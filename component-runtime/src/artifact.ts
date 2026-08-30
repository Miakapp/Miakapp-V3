import {
  ContractViolation,
  LIMITS,
  type ComponentPointerV1,
} from './contract';

const JAVASCRIPT_CONTENT_TYPES = new Set([
  'text/javascript',
  'application/javascript',
]);

export interface ArtifactFetchOptions {
  fetch?: typeof globalThis.fetch;
  signal?: AbortSignal;
  allowedArtifactOrigins: ReadonlySet<string>;
  allowedPathPrefixes?: readonly string[];
}

export interface VerifiedArtifact {
  bytes: Uint8Array;
  sha256: string;
}

function fail(code: string, message: string): never {
  throw new ContractViolation(code, message);
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '');
}

export async function sha256Base64Url(bytes: Uint8Array): Promise<string> {
  const digestInput = new Uint8Array(bytes.byteLength);
  digestInput.set(bytes);
  const digest = await crypto.subtle.digest('SHA-256', digestInput);
  return encodeBase64Url(new Uint8Array(digest));
}

function equalAscii(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

export async function verifyArtifactBytes(
  pointer: Pick<ComponentPointerV1, 'size' | 'sha256'>,
  bytes: Uint8Array,
): Promise<VerifiedArtifact> {
  if (bytes.byteLength > LIMITS.artifactBytes) {
    fail('artifact_too_large', 'artifact exceeds the runtime limit');
  }
  if (bytes.byteLength !== pointer.size) {
    fail('artifact_size_mismatch', `expected ${pointer.size} bytes, received ${bytes.byteLength}`);
  }
  const digest = await sha256Base64Url(bytes);
  if (!equalAscii(digest, pointer.sha256)) {
    fail('artifact_hash_mismatch', 'artifact digest does not match the pointer');
  }
  return { bytes, sha256: digest };
}

function validateFinalUrl(
  raw: string,
  allowedOrigins: ReadonlySet<string>,
  allowedPathPrefixes: readonly string[] | undefined,
): void {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return fail('pointer_invalid', 'artifact response has an invalid final URL');
  }
  if (url.protocol !== 'https:' || !allowedOrigins.has(url.origin)) {
    fail('pointer_invalid', 'artifact response left the allowed origin');
  }
  if (allowedPathPrefixes?.length
    && !allowedPathPrefixes.some((prefix) => url.pathname.startsWith(prefix))) {
    fail('pointer_invalid', 'artifact response left the allowed path');
  }
}

function validateResponseMetadata(response: Response): void {
  if (!response.ok) fail('artifact_fetch_failed', `artifact returned HTTP ${response.status}`);
  const rawType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (!rawType || !JAVASCRIPT_CONTENT_TYPES.has(rawType)) {
    fail('artifact_fetch_failed', 'artifact content type is not JavaScript');
  }
}

async function readBoundedBody(response: Response, expectedSize: number): Promise<Uint8Array> {
  if (!response.body) fail('artifact_fetch_failed', 'artifact response has no readable body');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      const chunk = result.value;
      total += chunk.byteLength;
      if (total > expectedSize || total > LIMITS.artifactBytes) {
        await reader.cancel('artifact size limit exceeded');
        fail('artifact_too_large', 'artifact response exceeded the declared size');
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }
  if (total !== expectedSize) {
    fail('artifact_size_mismatch', `expected ${expectedSize} bytes, received ${total}`);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function fetchAndVerifyArtifact(
  pointer: ComponentPointerV1,
  options: ArtifactFetchOptions,
): Promise<VerifiedArtifact> {
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  if (!fetchImplementation) fail('artifact_fetch_failed', 'fetch is unavailable');
  const requestedUrl = new URL(pointer.url);
  if (!options.allowedArtifactOrigins.has(requestedUrl.origin)) {
    fail('pointer_invalid', 'artifact URL origin is not allowed');
  }
  if (options.allowedPathPrefixes?.length
    && !options.allowedPathPrefixes.some((prefix) => requestedUrl.pathname.startsWith(prefix))) {
    fail('pointer_invalid', 'artifact URL path is not allowed');
  }

  let response: Response;
  try {
    const request: RequestInit = {
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      mode: 'cors',
      referrerPolicy: 'no-referrer',
    };
    if (options.signal) request.signal = options.signal;
    response = await fetchImplementation(pointer.url, request);
  } catch (error) {
    if (error instanceof ContractViolation) throw error;
    fail('artifact_fetch_failed', `artifact fetch failed: ${error instanceof Error ? error.message : 'unknown error'}`);
  }

  validateResponseMetadata(response);
  if (response.url) {
    validateFinalUrl(response.url, options.allowedArtifactOrigins, options.allowedPathPrefixes);
  }
  return verifyArtifactBytes(pointer, await readBoundedBody(response, pointer.size));
}
