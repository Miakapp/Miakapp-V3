import {
  StagingBrowserRelayTrustedSourceCompositionError,
} from './contract.mjs';
import {
  createBrowserRelayTrustedSourceCompositionInternal,
} from './internal.mjs';

export function createBrowserRelayTrustedSourceCompositionForTesting(
  root,
  options,
  runtime,
) {
  if (arguments.length !== 3) {
    throw new StagingBrowserRelayTrustedSourceCompositionError();
  }
  return createBrowserRelayTrustedSourceCompositionInternal(root, options, runtime);
}
