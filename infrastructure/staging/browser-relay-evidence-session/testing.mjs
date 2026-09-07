import {
  StagingBrowserRelayEvidenceSessionError,
} from './contract.mjs';
import {
  createBrowserRelayEvidenceSessionWithClock,
} from './internal.mjs';

export function createBrowserRelayEvidenceSessionForTest(clock) {
  if (arguments.length !== 1 || typeof clock !== 'function') {
    throw new StagingBrowserRelayEvidenceSessionError(
      'Evidence session test clock must be one function',
    );
  }
  return createBrowserRelayEvidenceSessionWithClock(clock);
}
