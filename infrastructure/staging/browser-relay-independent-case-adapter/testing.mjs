import {
  StagingBrowserRelayIndependentCaseAdapterError,
} from './contract.mjs';
import {
  runBrowserRelayIndependentCaseScheduleWithRunner,
} from './internal.mjs';

export function runBrowserRelayIndependentCaseScheduleForTesting(
  secondaryCaseRunner,
  components,
  options = {},
) {
  if (arguments.length < 2 || arguments.length > 3) {
    throw new StagingBrowserRelayIndependentCaseAdapterError(
      'Independent case-adapter testing requires a runner and the components',
    );
  }
  return runBrowserRelayIndependentCaseScheduleWithRunner(
    secondaryCaseRunner,
    components,
    options,
  );
}
