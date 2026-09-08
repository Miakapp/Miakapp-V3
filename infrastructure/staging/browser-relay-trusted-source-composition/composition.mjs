import {
  createBrowserRelayAuthenticatedSourceReaders,
} from '../browser-relay-authenticated-source-readers/readers.mjs';
import {
  runBrowserRelayClaimBoundOperation,
} from '../browser-relay-operation-case-adapter/adapter.mjs';
import {
  createBrowserRelaySourceAuthorityAdapters,
} from '../browser-relay-source-authority-adapters/adapters.mjs';
import {
  createBrowserRelaySourceClients,
} from '../browser-relay-source-clients/clients.mjs';
import {
  createBrowserRelaySourceSessions,
} from '../browser-relay-source-session-producers/producers.mjs';
import {
  createBrowserRelaySourceTransports,
} from '../browser-relay-source-transports/transports.mjs';
import {
  StagingBrowserRelayTrustedSourceCompositionError,
} from './contract.mjs';
import {
  createBrowserRelayTrustedSourceCompositionInternal,
} from './internal.mjs';

const productionRuntime = Object.freeze({
  clock: Date.now.bind(Date),
  create_source_clients: createBrowserRelaySourceClients,
  create_source_sessions: createBrowserRelaySourceSessions,
  create_authority_adapters: createBrowserRelaySourceAuthorityAdapters,
  create_authenticated_readers: createBrowserRelayAuthenticatedSourceReaders,
  create_source_transports: createBrowserRelaySourceTransports,
  run_operation_case: runBrowserRelayClaimBoundOperation,
  provider_released() {},
});

export function createBrowserRelayTrustedSourceComposition(root, options) {
  if (arguments.length !== 2) {
    throw new StagingBrowserRelayTrustedSourceCompositionError();
  }
  return createBrowserRelayTrustedSourceCompositionInternal(root, options, productionRuntime);
}
