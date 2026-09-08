import {
  createBrowserRelaySourceSessionsForTestInternal,
} from './internal.mjs';

export function createBrowserRelaySourceSessionsForTest(clients, options, runtime) {
  return createBrowserRelaySourceSessionsForTestInternal(clients, options, runtime);
}
