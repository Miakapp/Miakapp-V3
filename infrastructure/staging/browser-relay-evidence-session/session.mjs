import process from 'node:process';

import {
  StagingBrowserRelayEvidenceSessionError,
} from './contract.mjs';
import {
  createBrowserRelayEvidenceSessionWithClock,
} from './internal.mjs';

const SYSTEM_MONOTONIC_CLOCK = process.hrtime.bigint;

export function createBrowserRelayEvidenceSession() {
  if (arguments.length !== 0) {
    throw new StagingBrowserRelayEvidenceSessionError(
      'Evidence session creation does not accept caller options',
    );
  }
  return createBrowserRelayEvidenceSessionWithClock(SYSTEM_MONOTONIC_CLOCK);
}
