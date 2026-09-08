import {
  createBrowserRelaySourceAuthorityAdaptersInternal,
} from './internal.mjs';

export function createBrowserRelaySourceAuthorityAdapters(sessions, options) {
  return createBrowserRelaySourceAuthorityAdaptersInternal(sessions, options);
}
