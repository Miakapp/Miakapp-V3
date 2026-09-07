import {
  createBrowserRelaySourceTransportsForTestInternal,
} from './internal.mjs';

export function createBrowserRelaySourceTransportsForTest(providers, options, runtime) {
  return createBrowserRelaySourceTransportsForTestInternal(providers, options, runtime);
}
