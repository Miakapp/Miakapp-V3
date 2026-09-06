import { createBrowserRelayPageHarness } from './browser-relay-page-harness.mjs';

let harness;

function host() {
  if (harness === undefined) throw new Error('Offline bridge page is not initialized');
  return harness.host;
}

const api = Object.freeze({
  async initialize(input) {
    if (harness !== undefined) throw new Error('Offline bridge page initializes once');
    harness = createBrowserRelayPageHarness({
      browserName: input?.browser,
      generation: 2,
      global: globalThis,
      now: () => performance.now(),
    });
    return harness.host.initialize(input);
  },
  start: () => host().start(),
  observe: () => host().observe(),
  observeLifecycle: () => host().observeLifecycle(),
  observeState: (expected) => host().observeState(expected),
  call: (target) => host().call(target),
  suspend: () => host().suspend(),
  resume: () => host().resume(),
  stop: () => host().stop(),
});

Object.defineProperty(globalThis, 'miakappBrowserRelayPage', {
  configurable: false,
  enumerable: false,
  writable: false,
  value: api,
});
