import {
  createBrowserRelaySourceSessionsInternal,
} from './internal.mjs';

export function createBrowserRelaySourceSessions(clients, options) {
  return createBrowserRelaySourceSessionsInternal(clients, options);
}
