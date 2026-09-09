import {
  createBrowserRelayTrustedProviderOwnerInternal,
} from './internal.mjs';
import {
  validateTrustedProviderOwnerBootstrap,
} from './contract.mjs';

export function createBrowserRelayTrustedProviderOwnerForTesting(runtime, bootstrap) {
  if (arguments.length !== 2) {
    throw new Error('Trusted provider owner test runtime and bootstrap are required');
  }
  return createBrowserRelayTrustedProviderOwnerInternal(
    runtime,
    validateTrustedProviderOwnerBootstrap(bootstrap),
  );
}
