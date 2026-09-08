import {
  createBrowserRelaySourceClientsForTestInternal,
} from './internal.mjs';

export function createBrowserRelaySourceClientsForTest(authorities, options, runtime) {
  return createBrowserRelaySourceClientsForTestInternal(authorities, options, runtime);
}
