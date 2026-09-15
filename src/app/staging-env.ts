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

/**
 * A control plane derives every endpoint it publishes from one issuer:
 * `production-runtime-config.ts` builds `exchangeEndpoint`,
 * `userRelayExchangeEndpoint`, `runtimeDiagnosticsEndpoint` and
 * `componentUploadBaseUrl` by appending a fixed path to the same origin. So an
 * endpoint that does not share the origin of the exchange endpoint names a
 * *different* control plane from the one this shell authenticates against — a
 * stale host left behind by a copied `.env`, or a typo in the one place it
 * cannot be noticed.
 *
 * The origin is compared against the operator's own exchange endpoint rather
 * than against the endpoints published by discovery, and that is deliberate.
 * Discovery is fetched unauthenticated; treating it as the authority on where
 * our requests go would hand whoever answers that fetch the power to redirect
 * them. The exchange endpoint is already a required key the operator sets, so
 * anchoring on it adds no new trust and needs no network — this rule holds in
 * CI, offline, on every change.
 *
 * Only the origin is compared. The path is not derivable: staging points
 * `VITE_MIAKAPP_CONTROL_PLANE_EXCHANGE_ENDPOINT` at the user-relay exchange
 * rather than the access-token one, so demanding a particular suffix would
 * reject a working deployment.
 */
/**
 * The origin every other control plane value is measured against, or
 * `undefined` when the anchor cannot carry that weight.
 *
 * A plaintext or unparseable exchange endpoint is already its own fault in live
 * mode. Measuring anything against it would additionally report one host as two
 * control planes, which sends the operator looking for a second deployment that
 * does not exist. Every cross-key rule therefore goes silent here rather than
 * repeating that judgement.
 */
function controlPlaneOrigin(exchangeEndpoint: string): string | undefined {
  let exchange: URL;
  try {
    exchange = new URL(exchangeEndpoint);
  } catch {
    return undefined;
  }
  if (exchange.protocol !== 'https:') return undefined;
  return exchange.origin;
}

function describeIssuerOriginFault(
  key: string,
  exchangeEndpoint: string,
  value: string,
): string | undefined {
  const anchor = controlPlaneOrigin(exchangeEndpoint);
  if (anchor === undefined) return undefined;
  let endpoint: URL;
  try {
    endpoint = new URL(value);
  } catch {
    // The value already has its own fault reported.
    return undefined;
  }
  if (anchor === endpoint.origin) return undefined;
  return `${key} must share the control plane origin ${anchor}, but points at ${endpoint.origin}`;
}

/**
 * Unlike the endpoint keys, this one is a *list*, and the rule is containment
 * rather than equality: a deployment may legitimately name extra origins, since
 * the bytes are verified against the pointer's digest wherever they come from.
 *
 * But the control plane origin cannot be one of the optional ones. A pointer
 * never names an artifact anywhere else: `createProductionDeploymentConfig`
 * builds `componentArtifactBaseUrl` as `${issuer}/v1/components`, and
 * `ComponentStore` refuses to publish a release whose `publicUrl` is not
 * `${componentArtifactBaseUrl}/${sha256}.js` — it answers `temporarily_unavailable`
 * instead. So the origin is structural, not conventional.
 *
 * A list without it therefore rejects *every* artifact it is ever offered, at
 * `allowedArtifactOrigins.has(url.origin)` in `component-runtime/src/artifact.ts`,
 * as `pointer_invalid`. Releases look configured, the shell mounts, and nothing
 * ever activates — the same silent mode as a misspelled key. Should artifacts
 * one day be served from a bucket or CDN of their own, this rule is the thing
 * to revisit, because the premise above is what makes it true.
 */
function collectArtifactOriginFaults(
  value: string,
  exchangeEndpoint: string | undefined,
): readonly string[] {
  const key = 'VITE_MIAKAPP_COMPONENT_ARTIFACT_ORIGINS';
  const origins = value.split(',').map((origin) => origin.trim()).filter((origin) => origin !== '');
  if (origins.length === 0) return [`${key} lists no origin`];
  const faults: string[] = [];
  for (const origin of origins) {
    const fault = describeOriginFault(key, origin, { toleratesTrailingSlash: false });
    if (fault !== undefined) faults.push(fault);
  }
  // A malformed list is not yet a list; asking whether it contains the control
  // plane would pile a second sentence onto a value the operator must retype.
  if (faults.length > 0) return faults;
  if (exchangeEndpoint === undefined) return faults;
  const anchor = controlPlaneOrigin(exchangeEndpoint);
  if (anchor === undefined || origins.includes(anchor)) return faults;
  return [
    `${key} must include the control plane origin ${anchor}, which serves every artifact a pointer names; it lists ${origins.join(', ')}`,
  ];
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

  const exchangeEndpoint = present(env, 'VITE_MIAKAPP_CONTROL_PLANE_EXCHANGE_ENDPOINT');

  // Outside live mode the host never reads its live keys, so demanding them
  // would reject a deliberately configured demo build.
  if (mode === 'live') {
    for (const key of LIVE_REQUIRED_KEYS) {
      if (present(env, key) === undefined) faults.push(`${key} is required when ${MODE_KEY}=live`);
    }
    if (exchangeEndpoint !== undefined) {
      const fault = describeEndpointFault('VITE_MIAKAPP_CONTROL_PLANE_EXCHANGE_ENDPOINT', exchangeEndpoint);
      if (fault !== undefined) faults.push(fault);
    }
  }

  const diagnosticsEndpoint = present(env, 'VITE_MIAKAPP_RUNTIME_DIAGNOSTICS_ENDPOINT');
  if (diagnosticsEndpoint !== undefined) {
    const fault = describeEndpointFault('VITE_MIAKAPP_RUNTIME_DIAGNOSTICS_ENDPOINT', diagnosticsEndpoint);
    if (fault !== undefined) faults.push(fault);
    else if (exchangeEndpoint !== undefined) {
      // A misdirected diagnostics endpoint cannot be noticed at runtime: the
      // ingest route answers `204` with no body by design, so a shell posting
      // to the wrong origin looks exactly like one posting to the right origin,
      // and the loop stops reporting in silence.
      const crossFault = describeIssuerOriginFault(
        'VITE_MIAKAPP_RUNTIME_DIAGNOSTICS_ENDPOINT',
        exchangeEndpoint,
        diagnosticsEndpoint,
      );
      if (crossFault !== undefined) faults.push(crossFault);
    }
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
    else if (exchangeEndpoint !== undefined) {
      // This one is worse than a silent endpoint: `createControlPlanePointerReader`
      // sends the `authorization` header it just obtained — and the App Check
      // token — to whatever host this key names. A pointer endpoint off the
      // control plane origin therefore hands a live credential to a third party
      // on every activation, and the artifact it answers with is the code the
      // shell then runs.
      const crossFault = describeIssuerOriginFault(
        'VITE_MIAKAPP_COMPONENT_POINTER_ENDPOINT',
        exchangeEndpoint,
        pointerEndpoint,
      );
      if (crossFault !== undefined) faults.push(crossFault);
    }
  }
  if (artifactOrigins !== undefined) {
    // Half a release configuration already reads as "releases are off" above, so
    // the list is inert and the control plane anchor has nothing to say about it.
    const anchor = pointerEndpoint === undefined ? undefined : exchangeEndpoint;
    faults.push(...collectArtifactOriginFaults(artifactOrigins, anchor));
  }

  return faults;
}
