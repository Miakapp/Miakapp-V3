import {
  runBrowserRelayCaseSchedule,
} from '../browser-relay-case-scheduler/scheduler.mjs';
import {
  runBrowserRelayChromiumScenarioWithPageProjectionPort,
} from '../browser-relay-chromium-scenario/scenario.mjs';
import {
  StagingBrowserRelayChromiumCaseAdapterError,
} from './contract.mjs';
import {
  runBrowserRelayChromiumCaseScheduleWithRunners,
} from './internal.mjs';

export function runBrowserRelayChromiumCaseSchedule(components, options = {}) {
  if (arguments.length < 1 || arguments.length > 2) {
    throw new StagingBrowserRelayChromiumCaseAdapterError(
      'Chromium case-adapter creation accepts only components and an optional signal',
    );
  }
  return runBrowserRelayChromiumCaseScheduleWithRunners(
    runBrowserRelayCaseSchedule,
    runBrowserRelayChromiumScenarioWithPageProjectionPort,
    components,
    options,
  );
}
