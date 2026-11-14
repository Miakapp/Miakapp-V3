import type { HomeSummary, TrustedHost, TrustedHostSnapshot } from './host';

const PREVIEW_HOME: HomeSummary = Object.freeze({
  id: 'home_preview',
  name: 'Preview home',
  detail: 'Offline preview',
  accent: '#ffd45c',
});

const SNAPSHOT: TrustedHostSnapshot = Object.freeze({
  authenticated: false,
  activeHome: PREVIEW_HOME,
  homes: Object.freeze([PREVIEW_HOME]),
  // Nothing to connect to, so nothing to report as offline.
  connection: 'ready' as const,
  preview: true,
  signInAvailable: false,
});

/** The host of a build with no control plane: no identity, no relay, no home. */
export function createPreviewHost(): TrustedHost {
  return {
    getSnapshot: () => SNAPSHOT,
    subscribe: () => () => undefined,
    dispose: () => undefined,
  };
}
