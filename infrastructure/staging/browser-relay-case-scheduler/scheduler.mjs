import {
  createBrowserRelayEvidenceSession,
} from '../browser-relay-evidence-session/session.mjs';
import {
  StagingBrowserRelayCaseSchedulerError,
} from './contract.mjs';
import {
  runBrowserRelayCaseScheduleWithSessionFactory,
} from './internal.mjs';

export function runBrowserRelayCaseSchedule(adapter, options = {}) {
  if (arguments.length < 1 || arguments.length > 2) {
    throw new StagingBrowserRelayCaseSchedulerError(
      'Case scheduler creation accepts only an adapter and optional abort signal',
    );
  }
  return runBrowserRelayCaseScheduleWithSessionFactory(
    createBrowserRelayEvidenceSession,
    adapter,
    options,
  );
}
