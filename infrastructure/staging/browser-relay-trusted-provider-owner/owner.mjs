import {
  createBrowserRelayTrustedSourceComposition,
} from '../browser-relay-trusted-source-composition/composition.mjs';
import {
  createBrowserRelayTrustedProviderBrowser,
} from './browser.mjs';
import {
  validateTrustedProviderOwnerSchedule,
  rejectTrustedProviderOwner,
} from './contract.mjs';
import {
  createBrowserRelayTrustedProviderOwnerInternal,
} from './internal.mjs';
import {
  createBrowserRelayTrustedProviderOperation,
} from './operation.mjs';
import {
  createBrowserRelayTrustedProviderSourceTruth,
  delayBrowserRelayTrustedProviderOwnerTimeline,
} from './source-truth.mjs';

const productionRuntime = Object.freeze({
  clock: Date.now.bind(Date),
  delay: delayBrowserRelayTrustedProviderOwnerTimeline,
  createSourceTruth: createBrowserRelayTrustedProviderSourceTruth,
  createOperation: createBrowserRelayTrustedProviderOperation,
  createBrowser: createBrowserRelayTrustedProviderBrowser,
  createComposition: createBrowserRelayTrustedSourceComposition,
});

export function createBrowserRelayTrustedProviderOwner() {
  if (arguments.length !== 0) rejectTrustedProviderOwner();
  validateTrustedProviderOwnerSchedule();
  return createBrowserRelayTrustedProviderOwnerInternal(productionRuntime);
}
