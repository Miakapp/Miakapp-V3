import {
  createBrowserRelayOperatorAuthoritySourceForImplementation,
} from './internal.mjs';

export function createBrowserRelayOperatorAuthoritySourceForTesting(
  implementations,
  expectedOperatorSha256,
) {
  return createBrowserRelayOperatorAuthoritySourceForImplementation(
    implementations,
    expectedOperatorSha256,
  );
}
