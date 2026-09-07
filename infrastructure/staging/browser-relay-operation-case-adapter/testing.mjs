import {
  StagingBrowserRelayOperationCaseAdapterError,
} from './contract.mjs';
import {
  runBrowserRelayClaimBoundOperationWithRunners,
} from './internal.mjs';

export function runBrowserRelayClaimBoundOperationForTesting(
  operationRunner,
  matrixRunner,
  components,
  options = {},
) {
  if (arguments.length < 3 || arguments.length > 4) {
    throw new StagingBrowserRelayOperationCaseAdapterError(
      'Claim-bound operation testing requires two runners and the components',
    );
  }
  return runBrowserRelayClaimBoundOperationWithRunners(
    operationRunner,
    matrixRunner,
    components,
    options,
  );
}
