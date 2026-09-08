import {
  createBrowserRelaySourceAuthorityAdaptersForTestInternal,
} from './internal.mjs';

export function createBrowserRelaySourceAuthorityAdaptersForTest(
  sessions,
  options,
  runtime,
) {
  return createBrowserRelaySourceAuthorityAdaptersForTestInternal(
    sessions,
    options,
    runtime,
  );
}
