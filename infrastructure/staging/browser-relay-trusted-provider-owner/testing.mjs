import {
  createBrowserRelayTrustedProviderOwnerInternal,
} from './internal.mjs';

export function createBrowserRelayTrustedProviderOwnerForTesting(runtime) {
  if (arguments.length !== 1) {
    throw new Error('Trusted provider owner test runtime is required');
  }
  return createBrowserRelayTrustedProviderOwnerInternal(runtime);
}
