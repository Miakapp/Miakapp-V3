import {
  runBrowserRelaySecondaryCaseSchedule,
} from '../browser-relay-secondary-case-adapter/adapter.mjs';
import {
  StagingBrowserRelayIndependentCaseAdapterError,
} from './contract.mjs';
import {
  runBrowserRelayIndependentCaseScheduleWithRunner,
} from './internal.mjs';

export function runBrowserRelayIndependentCaseSchedule(components, options = {}) {
  if (arguments.length < 1 || arguments.length > 2) {
    throw new StagingBrowserRelayIndependentCaseAdapterError(
      'Independent case-adapter creation accepts only components and an optional signal',
    );
  }
  return runBrowserRelayIndependentCaseScheduleWithRunner(
    runBrowserRelaySecondaryCaseSchedule,
    components,
    options,
  );
}
