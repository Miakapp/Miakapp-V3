import {
  createBrowserRelaySourceClientsInternal,
} from './internal.mjs';

export function createBrowserRelaySourceClients(authorities, options) {
  return createBrowserRelaySourceClientsInternal(authorities, options);
}
