import {
  createBrowserRelaySourceTransportsInternal,
} from './internal.mjs';

export function createBrowserRelaySourceTransports(providers, options) {
  return createBrowserRelaySourceTransportsInternal(providers, options);
}
