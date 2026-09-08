import {
  createBrowserRelayAuthenticatedSourceReadersInternal,
} from './internal.mjs';

export function createBrowserRelayAuthenticatedSourceReaders(authorities, options) {
  return createBrowserRelayAuthenticatedSourceReadersInternal(authorities, options);
}
