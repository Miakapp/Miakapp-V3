import {
  StagingBrowserRelaySecondaryCaseAdapterError,
} from './contract.mjs';
import {
  runBrowserRelaySecondaryCaseScheduleWithRunners,
} from './internal.mjs';

export function runBrowserRelaySecondaryCaseScheduleForTesting(
  chromiumCaseRunner,
  bridgeRunner,
  components,
  options = {},
) {
  if (arguments.length < 3 || arguments.length > 4) {
    throw new StagingBrowserRelaySecondaryCaseAdapterError(
      'Secondary case-adapter testing requires both runners and the components',
    );
  }
  return runBrowserRelaySecondaryCaseScheduleWithRunners(
    chromiumCaseRunner,
    bridgeRunner,
    components,
    options,
  );
}
