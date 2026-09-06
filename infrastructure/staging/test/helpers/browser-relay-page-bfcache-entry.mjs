import { createBrowserRelayPageHarness } from './browser-relay-page-harness.mjs';

// Test-only dependencies: this exercises the real page runtime, not Firebase or SDK acceptance.
let harness;
const nativeEvents = {
  trusted_pagehides: 0,
  trusted_pageshows: 0,
  persisted_pagehides: 0,
  persisted_pageshows: 0,
  untrusted_events: 0,
};
for (const name of ['pagehide', 'pageshow']) {
  globalThis.addEventListener(name, (event) => {
    if (!event.isTrusted) {
      nativeEvents.untrusted_events += 1;
      return;
    }
    nativeEvents[name === 'pagehide' ? 'trusted_pagehides' : 'trusted_pageshows'] += 1;
    if (event.persisted) {
      nativeEvents[name === 'pagehide' ? 'persisted_pagehides' : 'persisted_pageshows'] += 1;
    }
  });
}

function observe() {
  return {
    initialized: harness !== undefined,
    native_events: { ...nativeEvents },
    page: harness?.host.observe(),
    lifecycle: harness?.host.observeLifecycle(),
    cleanup: harness?.cleanupCounts(),
    counts: harness?.counts(),
    indexed_db_unavailable: globalThis.indexedDB === undefined,
  };
}

Object.defineProperty(globalThis, 'miakappOfflineRelaySmoke', {
  configurable: false,
  enumerable: false,
  writable: false,
  value: Object.freeze({
    async initialize(browserName, generation) {
      if (harness !== undefined) throw new Error('Offline page initializes once');
      harness = createBrowserRelayPageHarness({
        global: globalThis,
        browserName,
        generation,
        now: () => performance.now(),
      });
      await harness.host.initialize(harness.privateInput());
      await harness.host.start();
      globalThis.addEventListener('pagehide', (event) => {
        if (!event.isTrusted) return;
        const observation = observe();
        const value = {
          trusted: true,
          persisted: event.persisted === true,
          page_state: observation.page.state,
          lifecycle_pagehides: observation.lifecycle.events.filter(
            ({ event: name }) => name === 'pagehide',
          ).length,
          active_websockets: observation.page.active_websockets,
          client_stops: observation.counts.clientStops,
          active_sockets: observation.counts.activeSockets,
          indexed_db_unavailable: observation.indexed_db_unavailable,
        };
        globalThis.sessionStorage.setItem(
          'miakapp-offline-lifecycle',
          JSON.stringify(value),
        );
      }, { once: true });
      return observe();
    },
    observe,
    observeState: (expected) => harness.host.observeState(expected),
    call: (target) => harness.host.call(target),
    async stop() {
      await harness.host.stop();
      return observe();
    },
  }),
});
