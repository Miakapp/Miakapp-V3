/**
 * The shell reads its own deployment configuration in the browser, from
 * `configured-host.ts`, after the bundle has already been built and served.
 * That placement gives every configuration mistake the same shape: it is
 * discovered by a visitor, on a deployed site, and never by the person who
 * typed the value.
 *
 * Two failure modes make that worth moving earlier, and they fail in opposite
 * directions. A key `required()` reads is fatal at module evaluation, so a
 * missing one replaces the application with a blank page. A key `optional()`
 * reads is not: a misspelled `VITE_MIAKAPP_COMPONENT_SANDBOX_ORIGIN` returns
 * `undefined`, the component runtime declines to mount, and the deployment is
 * indistinguishable from one that simply has not enabled the runtime yet.
 * Nothing anywhere reports the typo.
 *
 * This module restates those rules as a pure function over an environment so
 * `scripts/deploy-staging.sh` can apply them before `vite build`. It is a
 * second reading of the same contract, not a new one: every rule below exists
 * because `configured-host.ts`, `component-runtime-host.ts` or
 * `component-runtime/src/artifact.ts` already enforces it somewhere the
 * operator cannot watch.
 */

/** Keys the live host requires; each one is read through `required()`. */
const LIVE_REQUIRED_KEYS = [
  'VITE_MIAKAPP_APP_CHECK_SITE_KEY',
  'VITE_MIAKAPP_CONTROL_PLANE_EXCHANGE_ENDPOINT',
  'VITE_MIAKAPP_FIREBASE_API_KEY',
  'VITE_MIAKAPP_FIREBASE_APP_ID',
  'VITE_MIAKAPP_FIREBASE_AUTH_DOMAIN',
  'VITE_MIAKAPP_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_MIAKAPP_FIREBASE_PROJECT_ID',
  'VITE_MIAKAPP_FIREBASE_STORAGE_BUCKET',
  'VITE_MIAKAPP_HOME_DETAIL',
  'VITE_MIAKAPP_HOME_ID',
  'VITE_MIAKAPP_HOME_NAME',
] as const;

/** Keys that may be absent, and that disable a feature in silence when they are. */
const OPTIONAL_KEYS = [
  'VITE_MIAKAPP_COMPONENT_ARTIFACT_ORIGINS',
  'VITE_MIAKAPP_COMPONENT_POINTER_ENDPOINT',
  'VITE_MIAKAPP_COMPONENT_SANDBOX_ORIGIN',
  'VITE_MIAKAPP_RUNTIME_DIAGNOSTICS_ENDPOINT',
] as const;

const MODE_KEY = 'VITE_MIAKAPP_MODE';
const SUPPORTED_MODES = new Set(['live', 'demo']);

/**
 * Every `VITE_`-prefixed key the bundle can act on. The set is closed on
 * purpose: an unrecognised key is the observable half of a typo whose other
 * half is a feature that quietly stayed off. Checking the whole `VITE_` prefix
 * rather than `VITE_MIAKAPP_` is what catches a name misspelled early
 * — `VITE_MIKAAPP_MODE` would otherwise look like somebody else's variable —
 * and every key under that prefix is copied into a bundle served to the
 * public, so an unread one has no reason to be there.
 */
export const KNOWN_STAGING_ENV_KEYS: ReadonlySet<string> = new Set<string>([
  MODE_KEY,
  ...LIVE_REQUIRED_KEYS,
  ...OPTIONAL_KEYS,
]);

const BUNDLED_PREFIX = 'VITE_';

function present(env: Readonly<Record<string, string>>, key: string): string | undefined {
  const value = env[key];
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  return value.trim();
}

/**
 * `assertSandboxOrigin` and `component-runtime/src/artifact.ts` both compare a
 * configured origin against `URL.origin`, which never carries a path, a query
 * or a fragment. A value that does carry one matches nothing: the runtime
 * refuses every artifact it is handed and reports a contract violation about
 * the artifact rather than about the configuration.
 *
 * The two differ on one point, and this function keeps the difference rather
 * than picking a side. `assertSandboxOrigin` strips trailing slashes before
 * comparing, so `https://sandbox.test/` mounts; artifact origins are matched
 * with `Set.has(url.origin)`, where the same trailing slash matches nothing.
 * Rejecting a value the runtime accepts would block a working deployment, so
 * the tolerance is granted only where the runtime grants it.
 */
function describeOriginFault(
  key: string,
  value: string,
  { toleratesTrailingSlash }: { readonly toleratesTrailingSlash: boolean },
): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return `${key} is not a URL: ${value}`;
  }
  if (parsed.protocol !== 'https:') return `${key} must use HTTPS: ${value}`;
  const compared = toleratesTrailingSlash ? value.replace(/\/+$/u, '') : value;
  if (parsed.origin !== compared) {
    return `${key} must be a bare origin with no path, query or fragment: ${value}`;
  }
  return undefined;
}

function describeEndpointFault(key: string, value: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return `${key} is not a URL: ${value}`;
  }
  if (parsed.protocol !== 'https:') return `${key} must use HTTPS: ${value}`;
  return undefined;
}

function collectArtifactOriginFaults(value: string): readonly string[] {
  const key = 'VITE_MIAKAPP_COMPONENT_ARTIFACT_ORIGINS';
  const origins = value.split(',').map((origin) => origin.trim()).filter((origin) => origin !== '');
  if (origins.length === 0) return [`${key} lists no origin`];
  const faults: string[] = [];
  for (const origin of origins) {
    const fault = describeOriginFault(key, origin, { toleratesTrailingSlash: false });
    if (fault !== undefined) faults.push(fault);
  }
  return faults;
}

/**
 * Reports every reason the given environment would not produce a working
 * staging bundle, in a stable order. An empty result means the values pass the
 * same checks the shell applies at runtime — it does not mean the endpoints
 * exist or answer, which only the deployment can tell.
 */
export function collectStagingEnvFaults(env: Readonly<Record<string, string>>): readonly string[] {
  const faults: string[] = [];

  for (const key of Object.keys(env).sort()) {
    if (!key.startsWith(BUNDLED_PREFIX)) continue;
    if (KNOWN_STAGING_ENV_KEYS.has(key)) continue;
    faults.push(`${key} is not a key this bundle reads; check the spelling`);
  }

  const mode = present(env, MODE_KEY);
  if (mode === undefined) {
    faults.push(`${MODE_KEY} is required; staging deploys the live host with "live"`);
  } else if (!SUPPORTED_MODES.has(mode)) {
    faults.push(`${MODE_KEY} must be "live" or "demo", not ${mode}`);
  }

  // Outside live mode the host never reads its live keys, so demanding them
  // would reject a deliberately configured demo build.
  if (mode === 'live') {
    for (const key of LIVE_REQUIRED_KEYS) {
      if (present(env, key) === undefined) faults.push(`${key} is required when ${MODE_KEY}=live`);
    }
    const exchangeEndpoint = present(env, 'VITE_MIAKAPP_CONTROL_PLANE_EXCHANGE_ENDPOINT');
    if (exchangeEndpoint !== undefined) {
      const fault = describeEndpointFault('VITE_MIAKAPP_CONTROL_PLANE_EXCHANGE_ENDPOINT', exchangeEndpoint);
      if (fault !== undefined) faults.push(fault);
    }
  }

  const diagnosticsEndpoint = present(env, 'VITE_MIAKAPP_RUNTIME_DIAGNOSTICS_ENDPOINT');
  if (diagnosticsEndpoint !== undefined) {
    const fault = describeEndpointFault('VITE_MIAKAPP_RUNTIME_DIAGNOSTICS_ENDPOINT', diagnosticsEndpoint);
    if (fault !== undefined) faults.push(fault);
  }

  const sandboxOrigin = present(env, 'VITE_MIAKAPP_COMPONENT_SANDBOX_ORIGIN');
  if (sandboxOrigin !== undefined) {
    const fault = describeOriginFault('VITE_MIAKAPP_COMPONENT_SANDBOX_ORIGIN', sandboxOrigin, {
      toleratesTrailingSlash: true,
    });
    if (fault !== undefined) faults.push(fault);
  }

  const pointerEndpoint = present(env, 'VITE_MIAKAPP_COMPONENT_POINTER_ENDPOINT');
  const artifactOrigins = present(env, 'VITE_MIAKAPP_COMPONENT_ARTIFACT_ORIGINS');
  // `readComponentReleaseConfiguration` returns undefined unless both are set,
  // so declaring one alone reads as "releases are off" rather than as an error.
  if (pointerEndpoint !== undefined && artifactOrigins === undefined) {
    faults.push(
      'VITE_MIAKAPP_COMPONENT_ARTIFACT_ORIGINS is required alongside VITE_MIAKAPP_COMPONENT_POINTER_ENDPOINT; component releases stay off without it',
    );
  }
  if (artifactOrigins !== undefined && pointerEndpoint === undefined) {
    faults.push(
      'VITE_MIAKAPP_COMPONENT_POINTER_ENDPOINT is required alongside VITE_MIAKAPP_COMPONENT_ARTIFACT_ORIGINS; component releases stay off without it',
    );
  }
  if (pointerEndpoint !== undefined) {
    const fault = describeEndpointFault('VITE_MIAKAPP_COMPONENT_POINTER_ENDPOINT', pointerEndpoint);
    if (fault !== undefined) faults.push(fault);
  }
  if (artifactOrigins !== undefined) faults.push(...collectArtifactOriginFaults(artifactOrigins));

  return faults;
}
