import {
  StagingBrowserRelayChromiumCaseAdapterError,
} from './contract.mjs';
import {
  runBrowserRelayChromiumCaseScheduleWithRunners,
} from './internal.mjs';

export function runBrowserRelayChromiumCaseScheduleForTesting(
  schedulerRunner,
  scenarioRunner,
  components,
  options = {},
) {
  if (arguments.length < 3 || arguments.length > 4) {
    throw new StagingBrowserRelayChromiumCaseAdapterError(
      'Chromium case-adapter testing requires both runners and the components',
    );
  }
  return runBrowserRelayChromiumCaseScheduleWithRunners(
    schedulerRunner,
    scenarioRunner,
    components,
    options,
  );
}
