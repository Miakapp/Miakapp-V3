import {
  createBrowserRelayAuthenticatedSourceReadersForTestInternal,
} from './internal.mjs';

export function createBrowserRelayAuthenticatedSourceReadersForTest(
  authorities,
  options,
  runtime,
) {
  return createBrowserRelayAuthenticatedSourceReadersForTestInternal(
    authorities,
    options,
    runtime,
  );
}
