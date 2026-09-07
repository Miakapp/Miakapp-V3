import {
  runBrowserRelayChromiumCaseSchedule,
} from '../browser-relay-chromium-case-adapter/adapter.mjs';
import {
  runBrowserRelayPlaywrightBridge,
} from '../browser-relay-playwright-bridge/bridge.mjs';
import {
  StagingBrowserRelaySecondaryCaseAdapterError,
} from './contract.mjs';
import {
  runBrowserRelaySecondaryCaseScheduleWithRunners,
} from './internal.mjs';

export function runBrowserRelaySecondaryCaseSchedule(components, options = {}) {
  if (arguments.length < 1 || arguments.length > 2) {
    throw new StagingBrowserRelaySecondaryCaseAdapterError(
      'Secondary case-adapter creation accepts only components and an optional signal',
    );
  }
  return runBrowserRelaySecondaryCaseScheduleWithRunners(
    runBrowserRelayChromiumCaseSchedule,
    runBrowserRelayPlaywrightBridge,
    components,
    options,
  );
}
