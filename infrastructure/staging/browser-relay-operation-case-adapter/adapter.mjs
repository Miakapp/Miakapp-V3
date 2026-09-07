import {
  runBrowserRelayIndependentCaseSchedule,
} from '../browser-relay-independent-case-adapter/adapter.mjs';
import {
  runSingleUseBrowserRelayOperation,
} from '../browser-relay-operation/operation.mjs';
import {
  StagingBrowserRelayOperationCaseAdapterError,
} from './contract.mjs';
import {
  runBrowserRelayClaimBoundOperationWithRunners,
} from './internal.mjs';

export function runBrowserRelayClaimBoundOperation(components) {
  if (arguments.length !== 1) {
    throw new StagingBrowserRelayOperationCaseAdapterError(
      'Claim-bound operation creation accepts exactly one component root',
    );
  }
  return runBrowserRelayClaimBoundOperationWithRunners(
    runSingleUseBrowserRelayOperation,
    runBrowserRelayIndependentCaseSchedule,
    components,
  );
}
