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

const EMPTY_DIGESTS: ReadonlySet<string> = new Set<string>();

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
}

export interface ComponentReleaseCoordinator {
  activate(signal?: AbortSignal): Promise<ActivatedRelease>;
}

export function createControlPlanePointerReader(
  options: ControlPlanePointerReaderOptions,
): ComponentPointerReader {
  const base = options.endpoint.replace(/\/+$/u, '');
  const url = `${base}/v1/homes/${options.homeId}/component-pointer`;
  return async (signal) => {
    const authorization = await options.authorize(signal);
    const headers: Record<string, string> = {
      accept: 'application/json',
      authorization,
    };
    if (options.appCheckToken !== undefined) {
      headers['x-firebase-appcheck'] = await options.appCheckToken(signal);
    }
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
    const response = await (options.fetch ?? globalThis.fetch)(url, request);
    if (!response.ok) {
      throw new Error(`component pointer read returned HTTP ${response.status}`);
    }
    return await response.json();
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

  return {
    async activate(signal) {
      const ledgerInstance = releaseLedger();
      const accepted = await ledgerInstance.accept(
        await options.readPointer(signal),
        quarantinedDigests,
      );
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
        };
      }

      // The candidate became last-known-good only after it verified end to end.
      await ledgerInstance.markActive(candidate, quarantinedDigests);
      return { pointer: candidate, artifact, fellBack: false };
    },
  };
}
