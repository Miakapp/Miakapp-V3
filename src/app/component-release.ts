import {
  IndexedDbArtifactCache,
  loadVerifiedArtifact,
  type ArtifactCache,
  type LoadedArtifact,
} from '../../component-runtime/src/artifact-cache';
import type {
  ComponentPointerV1,
  PointerValidationContext,
} from '../../component-runtime/src/contract';
import {
  ComponentReleaseLedger,
  IndexedDbReleaseMetadataStore,
  type ReleaseMetadataStore,
} from '../../component-runtime/src/release-state';

import { markOpen } from './house-snapshot';

const EMPTY_DIGESTS: ReadonlySet<string> = new Set<string>();

/** The control plane's read envelope around the live pointer (RFC 0004 §13.2). */
const POINTER_STATE_SCHEMA = 'miakapp.component-pointer-state/1';

/**
 * The home has published no interface of its own. Not a failure: the shell
 * shows the home without one rather than an error.
 */
export class NoPublishedRelease extends Error {
  constructor(readonly homeName?: string, readonly viewerIsOwner = false) {
    super('the home has published no interface');
    this.name = 'NoPublishedRelease';
  }
}

const HOME_INTERFACE_SCHEMA = 'miakapp.home-interface/1';
const HOME_INTERFACE_KEYS = ['generation', 'home_id', 'home_url', 'name', 'pointer', 'schema'];

/**
 * A pointer read through the resident route, with the home's public directory
 * name. The name is display text from Miakapp's directory, never from the
 * home's interface.
 */
export class HomeInterfaceRead {
  constructor(
    readonly pointer: unknown,
    readonly homeName: string,
    readonly viewerIsOwner = false,
  ) {}
}

function hasExactKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(record).sort();
  return actual.length === keys.length && actual.every((key, index) => key === keys[index]);
}

/**
 * Opens the control plane's read envelopes — the publisher's
 * `{ schema, generation, pointer }` or the resident's `miakapp.home-interface/1`
 * — with a null pointer for a home that never published. The ledger validates
 * a bare pointer, so only these exact envelopes are opened: any other shape is
 * handed to the ledger untouched, to be rejected there.
 */
export function unwrapPointerState(value: unknown): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  if (record.schema === POINTER_STATE_SCHEMA && hasExactKeys(record, ['generation', 'pointer', 'schema'])) {
    return record.pointer;
  }
  const base = { ...record };
  delete base.viewer_is_owner;
  if (record.schema === HOME_INTERFACE_SCHEMA && hasExactKeys(base, HOME_INTERFACE_KEYS)
    && typeof record.name === 'string' && record.name.length > 0 && record.name.length <= 128) {
    return new HomeInterfaceRead(record.pointer, record.name, record.viewer_is_owner === true);
  }
  return value;
}

/**
 * Reads the live component pointer for one home. The control-plane route is
 * RFC 0004 §13.2; the value is returned unvalidated because the release ledger
 * owns pointer validation and the anti-rollback floor.
 */
export type ComponentPointerReader = (signal?: AbortSignal) => Promise<unknown>;

export interface ControlPlanePointerReaderOptions {
  readonly endpoint: string;
  readonly homeId: string;
  readonly authorize: (signal?: AbortSignal) => Promise<string>;
  /**
   * Mirrors the control-plane exchange convention: the browser proves app
   * integrity with an App Check token alongside the bearer credential.
   */
  readonly appCheckToken?: (signal?: AbortSignal) => Promise<string>;
  readonly fetch?: typeof globalThis.fetch;
}

export interface ComponentReleaseOptions {
  readonly homeId: string;
  readonly allowedArtifactOrigins: ReadonlySet<string>;
  readonly allowedPathPrefixes?: readonly string[];
  readonly readPointer: ComponentPointerReader;
  readonly quarantinedDigests?: ReadonlySet<string>;
  readonly cache?: ArtifactCache;
  readonly store?: ReleaseMetadataStore;
  readonly fetch?: typeof globalThis.fetch;
  readonly onCacheError?: (error: unknown) => void;
}

export interface ActivatedRelease {
  readonly pointer: ComponentPointerV1;
  readonly artifact: LoadedArtifact;
  /** True when the candidate failed to load and the last-known-good was used. */
  readonly fellBack: boolean;
  /** The home's public directory name, when the read carried it. */
  readonly homeName?: string;
  /** The signed-in person owns this home: they need no first-visit agreement. */
  readonly viewerIsOwner?: boolean;
}

export interface ComponentReleaseCoordinator {
  activate(signal?: AbortSignal): Promise<ActivatedRelease>;
  /**
   * The last release this browser verified for the home, from its own cache,
   * without touching the network; undefined when there is none.
   */
  peek?(signal?: AbortSignal): Promise<ActivatedRelease | undefined>;
}

export function createControlPlanePointerReader(
  options: ControlPlanePointerReaderOptions,
): ComponentPointerReader {
  const base = options.endpoint.replace(/\/+$/u, '');
  // The resident route (RFC 0004 §13.5): any signed-in resident, no recent
  // sign-in. The publisher route stays for publishers.
  const url = `${base}/v1/homes/${options.homeId}/interface`;
  return async (signal) => {
    // Both credentials are independent: fetch them together.
    const [authorization, appCheck] = await Promise.all([
      options.authorize(signal),
      options.appCheckToken?.(signal),
    ]);
    const headers: Record<string, string> = {
      accept: 'application/json',
      authorization,
    };
    if (appCheck !== undefined) headers['x-firebase-appcheck'] = appCheck;
    const request: RequestInit = {
      method: 'GET',
      headers,
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      mode: 'cors',
      referrerPolicy: 'no-referrer',
    };
    if (signal) request.signal = signal;
    markOpen('pointer-request');
    const response = await (options.fetch ?? globalThis.fetch)(url, request);
    if (!response.ok) {
      throw new Error(`component pointer read returned HTTP ${response.status}`);
    }
    return unwrapPointerState(await response.json());
  };
}

export function createComponentReleaseCoordinator(
  options: ComponentReleaseOptions,
): ComponentReleaseCoordinator {
  const context: PointerValidationContext = {
    expectedHomeId: options.homeId,
    allowedArtifactOrigins: options.allowedArtifactOrigins,
    ...(options.allowedPathPrefixes === undefined
      ? {}
      : { allowedPathPrefixes: options.allowedPathPrefixes }),
  };
  const quarantinedDigests = options.quarantinedDigests ?? EMPTY_DIGESTS;
  let cache = options.cache;
  let ledger: ComponentReleaseLedger | undefined;

  function releaseLedger(): ComponentReleaseLedger {
    ledger ??= new ComponentReleaseLedger(
      context,
      options.store ?? new IndexedDbReleaseMetadataStore(),
    );
    return ledger;
  }

  function artifactCache(): ArtifactCache | undefined {
    if (cache === undefined && options.cache === undefined) {
      try {
        cache = new IndexedDbArtifactCache();
      } catch (error) {
        options.onCacheError?.(error);
      }
    }
    return cache;
  }

  async function load(
    pointer: ComponentPointerV1,
    signal: AbortSignal | undefined,
  ): Promise<LoadedArtifact> {
    return await loadVerifiedArtifact(pointer, {
      allowedArtifactOrigins: options.allowedArtifactOrigins,
      ...(options.allowedPathPrefixes === undefined
        ? {}
        : { allowedPathPrefixes: options.allowedPathPrefixes }),
      ...(artifactCache() === undefined ? {} : { cache: artifactCache() as ArtifactCache }),
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
      ...(options.onCacheError === undefined ? {} : { onCacheError: options.onCacheError }),
      ...(signal === undefined ? {} : { signal }),
    });
  }

  const offline: typeof globalThis.fetch = async () => {
    throw new Error('peek reads the cache only');
  };

  return {
    async peek(signal) {
      const known = (await releaseLedger().read())?.last_known_good;
      if (known === undefined || quarantinedDigests.has(known.sha256)) return undefined;
      const cached = artifactCache();
      if (cached === undefined) return undefined;
      const artifact = await loadVerifiedArtifact(known, {
        allowedArtifactOrigins: options.allowedArtifactOrigins,
        ...(options.allowedPathPrefixes === undefined
          ? {}
          : { allowedPathPrefixes: options.allowedPathPrefixes }),
        cache: cached,
        fetch: offline,
        ...(signal === undefined ? {} : { signal }),
      });
      return { pointer: known, artifact, fellBack: false };
    },

    async activate(signal) {
      const ledgerInstance = releaseLedger();
      const read = await options.readPointer(signal);
      const homeName = read instanceof HomeInterfaceRead ? read.homeName : undefined;
      const viewerIsOwner = read instanceof HomeInterfaceRead && read.viewerIsOwner;
      const named = { ...(homeName === undefined ? {} : { homeName }), ...(viewerIsOwner ? { viewerIsOwner } : {}) };
      const pointer = read instanceof HomeInterfaceRead ? read.pointer : read;
      if (pointer === null) throw new NoPublishedRelease(homeName, viewerIsOwner);
      const accepted = await ledgerInstance.accept(pointer, quarantinedDigests);
      const candidate = accepted.highest_accepted;

      let artifact: LoadedArtifact;
      try {
        artifact = await load(candidate, signal);
      } catch (error) {
        // No component code has run yet, so automatic fallback is still allowed.
        const fallback = await ledgerInstance.automaticFallback(candidate, {
          phase: 'staging',
          quarantinedDigests,
        });
        if (fallback === undefined) throw error;
        return {
          pointer: fallback,
          artifact: await load(fallback, signal),
          fellBack: true,
          ...named,
        };
      }

      // The candidate became last-known-good only after it verified end to end.
      await ledgerInstance.markActive(candidate, quarantinedDigests);
      return { pointer: candidate, artifact, fellBack: false, ...named };
    },
  };
}
