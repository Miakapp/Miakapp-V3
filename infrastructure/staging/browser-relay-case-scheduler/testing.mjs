import {
  StagingBrowserRelayCaseSchedulerError,
} from './contract.mjs';
import {
  runBrowserRelayCaseScheduleWithSessionFactory,
} from './internal.mjs';

export function runBrowserRelayCaseScheduleForTest(sessionFactory, adapter, options = {}) {
  if (arguments.length < 2 || arguments.length > 3) {
    throw new StagingBrowserRelayCaseSchedulerError(
      'Test case scheduler requires a session factory, adapter and optional abort signal',
    );
  }
  return runBrowserRelayCaseScheduleWithSessionFactory(sessionFactory, adapter, options);
}
