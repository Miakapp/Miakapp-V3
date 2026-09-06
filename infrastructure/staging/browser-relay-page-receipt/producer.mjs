import { isDeepStrictEqual } from 'node:util';

import {
  COUNTER_KEYS,
  SOURCE_ASSERTIONS,
  SOURCE_RECEIPT_SCHEMA,
  STABLE_OUTCOME_CLASSES,
  validateSourceReceipt,
} from '../browser-relay-aggregator/contract.mjs';
import {
  MAXIMUM_LIFECYCLE_PAUSE_MILLISECONDS,
  MAXIMUM_RENEWAL_INTERVAL_MILLISECONDS,
  MINIMUM_RENEWAL_INTERVAL_MILLISECONDS,
  PAGE_FACT_ORDER_BY_BROWSER,
  StagingBrowserRelayPageReceiptError,
  validateBrowserRelayPageFact,
  validateBrowserRelayPageReceiptProfile,
} from './contract.mjs';

const CUMULATIVE_INTEGER_FIELDS = Object.freeze([
  'client_instances',
  'firebase_auth_sessions',
  'app_check_instances',
  'firebase_token_requests',
  'app_check_token_requests',
  'control_plane_exchanges',
  'websocket_connections',
  'maximum_active_websockets',
  'source_credentials_on_websocket',
  'browser_credential_persistence_events',
  'duration_milliseconds',
]);
const CUMULATIVE_ARRAY_FIELDS = Object.freeze([
  'relay_ids',
  'client_statuses',
  'failure_classes',
]);
const LIFECYCLE_CUMULATIVE_INTEGER_FIELDS = Object.freeze([
  'suspensions',
  'resumptions',
  'sign_outs',
  'disposals',
]);
const LIFECYCLE_CUMULATIVE_ARRAY_FIELDS = Object.freeze([
  'events',
  'state_transitions',
  'call_outcomes',
]);

function reject(message) {
  throw new StagingBrowserRelayPageReceiptError(message);
}

function exact(value, expected, path) {
  if (!isDeepStrictEqual(value, expected)) reject(`${path} has drifted`);
}

function emptyCounters() {
  return Object.fromEntries(COUNTER_KEYS.map((key) => [key, 0]));
}

function prefix(previous, current) {
  return previous.length <= current.length
    && previous.every((entry, index) => entry === current[index]);
}

function deepPrefix(previous, current) {
  return previous.length <= current.length
    && previous.every((entry, index) => isDeepStrictEqual(entry, current[index]));
}

function requireCumulativeObservation(previous, current) {
  if (previous === undefined) return;
  for (const field of CUMULATIVE_INTEGER_FIELDS) {
    if (current[field] < previous[field]) {
      reject(`page_fact.observation.${field} moved backwards within one page instance`);
    }
  }
  for (const field of CUMULATIVE_ARRAY_FIELDS) {
    if (!prefix(previous[field], current[field])) {
      reject(`page_fact.observation.${field} is not a cumulative prefix`);
    }
  }
}

function requireCumulativeLifecycle(previous, current) {
  if (previous === undefined) return;
  for (const field of LIFECYCLE_CUMULATIVE_INTEGER_FIELDS) {
    if (current[field] < previous[field]) {
      reject(`page_fact.lifecycle_observation.${field} moved backwards within one page instance`);
    }
  }
  for (const field of LIFECYCLE_CUMULATIVE_ARRAY_FIELDS) {
    if (!deepPrefix(previous[field], current[field])) {
      reject(`page_fact.lifecycle_observation.${field} is not a cumulative prefix`);
    }
  }
}

function requirePageIdentity(fact, pageInstance, inputGeneration, identityGeneration) {
  exact(fact.page_instance, pageInstance, 'page_fact.page_instance');
  exact(fact.input_generation, inputGeneration, 'page_fact.input_generation');
  exact(fact.identity_generation, identityGeneration, 'page_fact.identity_generation');
}

function requireOptionalEvidence(fact, { state = false, call = false, lifecycle = null }) {
  if ((fact.state_observation !== null) !== state) {
    reject('page_fact.state_observation presence has drifted');
  }
  if ((fact.call_observation !== null) !== call) {
    reject('page_fact.call_observation presence has drifted');
  }
  if (lifecycle === null) {
    exact(fact.lifecycle_event, null, 'page_fact.lifecycle_event');
  } else {
    if (fact.lifecycle_event === null) reject('page_fact.lifecycle_event is missing');
    exact(fact.lifecycle_event.type, lifecycle, 'page_fact.lifecycle_event.type');
    const hostEvent = fact.lifecycle_observation.events.at(-1);
    exact(hostEvent, {
      event: fact.lifecycle_event.type,
      persisted: fact.lifecycle_event.persisted,
    }, 'page_fact lifecycle event host projection');
  }
}

function requireLifecycleCleanup(fact, expected) {
  exact({
    suspensions: fact.lifecycle_observation.suspensions,
    resumptions: fact.lifecycle_observation.resumptions,
    sign_outs: fact.lifecycle_observation.sign_outs,
    disposals: fact.lifecycle_observation.disposals,
  }, expected, 'page_fact lifecycle cleanup counters');
}

function requireNoTerminalCleanup(fact) {
  exact({
    sign_outs: fact.lifecycle_observation.sign_outs,
    disposals: fact.lifecycle_observation.disposals,
  }, {
    sign_outs: 0,
    disposals: 0,
  }, 'page_fact premature lifecycle cleanup counters');
}

function requireFreshLifecycle(fact) {
  exact(fact.lifecycle_observation, {
    schema: 'miakapp.staging-browser-relay-page-lifecycle-observation/1',
    browser: fact.browser,
    events: [],
    suspensions: 0,
    resumptions: 0,
    sign_outs: 0,
    disposals: 0,
    state_transitions: [],
    call_outcomes: [],
  }, 'initialized page lifecycle observation');
}

function requireObservationState(observation, state) {
  exact(observation.state, state, 'page_fact.observation.state');
  exact(observation.source_credentials_on_websocket, 0,
    'page_fact.observation.source_credentials_on_websocket');
  exact(observation.browser_credential_persistence_events, 0,
    'page_fact.observation.browser_credential_persistence_events');
}

function requireLastStatus(observation, status) {
  exact(
    observation.client_statuses.at(-1),
    status,
    'page_fact.observation final client status',
  );
}

function requireInitialized(observation) {
  requireObservationState(observation, 'initialized');
  exact({
    client_instances: observation.client_instances,
    firebase_auth_sessions: observation.firebase_auth_sessions,
    app_check_instances: observation.app_check_instances,
    firebase_token_requests: observation.firebase_token_requests,
    app_check_token_requests: observation.app_check_token_requests,
    control_plane_exchanges: observation.control_plane_exchanges,
    websocket_connections: observation.websocket_connections,
    active_websockets: observation.active_websockets,
    maximum_active_websockets: observation.maximum_active_websockets,
    relay_ids: observation.relay_ids,
    client_statuses: observation.client_statuses,
    failure_classes: observation.failure_classes,
  }, {
    client_instances: 1,
    firebase_auth_sessions: 1,
    app_check_instances: 1,
    firebase_token_requests: 0,
    app_check_token_requests: 0,
    control_plane_exchanges: 0,
    websocket_connections: 0,
    active_websockets: 0,
    maximum_active_websockets: 0,
    relay_ids: [],
    client_statuses: [],
    failure_classes: [],
  }, 'initialized page observation');
}

function requireReady(observation, {
  clientInstances,
  controlPlaneExchanges,
  websocketConnections,
  relayIds,
}) {
  requireObservationState(observation, 'ready');
  exact(observation.client_instances, clientInstances,
    'page_fact.observation.client_instances');
  exact(observation.firebase_auth_sessions, 1,
    'page_fact.observation.firebase_auth_sessions');
  exact(observation.app_check_instances, 1,
    'page_fact.observation.app_check_instances');
  exact(observation.firebase_token_requests, controlPlaneExchanges,
    'page_fact.observation.firebase_token_requests');
  exact(observation.app_check_token_requests, controlPlaneExchanges,
    'page_fact.observation.app_check_token_requests');
  exact(observation.control_plane_exchanges, controlPlaneExchanges,
    'page_fact.observation.control_plane_exchanges');
  exact(observation.websocket_connections, websocketConnections,
    'page_fact.observation.websocket_connections');
  exact(observation.active_websockets, 1,
    'page_fact.observation.active_websockets');
  exact(observation.maximum_active_websockets, 1,
    'page_fact.observation.maximum_active_websockets');
  exact(observation.relay_ids, relayIds, 'page_fact.observation.relay_ids');
  requireLastStatus(observation, 'ready');
}

function requireMatchedState(fact, minimumRevision = 1) {
  if (fact.state_observation?.state !== 'matched'
    || fact.state_observation.stale !== false
    || fact.state_observation.revision < minimumRevision) {
    reject('page_fact did not observe the required authoritative state');
  }
  return fact.state_observation.revision;
}

function requireAppliedCall(fact) {
  exact(fact.call_observation, {
    schema: 'miakapp.staging-browser-relay-page-call-observation/1',
    state: 'completed',
    outcome: 'applied',
  }, 'page_fact.call_observation');
}

function hasOutcome(lifecycleObservation, outcome) {
  return lifecycleObservation.call_outcomes.includes(outcome);
}

function validateChromiumPhase(fact, retained) {
  const observation = fact.observation;
  if (fact.sequence <= 15) requirePageIdentity(fact, 1, 1, 1);
  else requirePageIdentity(fact, 2, 2, 2);
  if (fact.phase !== 'signed_out_stopped' && fact.phase !== 'replacement_stopped') {
    requireNoTerminalCleanup(fact);
  }

  switch (fact.phase) {
    case 'initial_initialized':
      requireOptionalEvidence(fact, {});
      requireInitialized(observation);
      requireFreshLifecycle(fact);
      break;
    case 'initial_ready':
      requireOptionalEvidence(fact, {});
      requireReady(observation, {
        clientInstances: 1,
        controlPlaneExchanges: 1,
        websocketConnections: 1,
        relayIds: ['relay-a'],
      });
      retained.initialReadyElapsed = fact.elapsed_milliseconds;
      break;
    case 'authoritative_state':
      requireOptionalEvidence(fact, { state: true });
      requireObservationState(observation, 'ready');
      retained.authoritativeRevision = requireMatchedState(fact);
      break;
    case 'patched_state':
      requireOptionalEvidence(fact, { state: true });
      requireObservationState(observation, 'ready');
      retained.patchedRevision = requireMatchedState(
        fact,
        retained.authoritativeRevision + 1,
      );
      exact(
        retained.patchedRevision,
        retained.authoritativeRevision + 1,
        'patched state revision',
      );
      break;
    case 'initial_call':
      requireOptionalEvidence(fact, { call: true });
      requireObservationState(observation, 'ready');
      exact(observation.active_websockets, 1, 'initial call active WebSocket count');
      requireAppliedCall(fact);
      break;
    case 'same_relay_reauthenticated': {
      requireOptionalEvidence(fact, {});
      requireReady(observation, {
        clientInstances: 1,
        controlPlaneExchanges: 2,
        websocketConnections: 1,
        relayIds: ['relay-a'],
      });
      const interval = fact.elapsed_milliseconds - retained.initialReadyElapsed;
      if (interval < MINIMUM_RENEWAL_INTERVAL_MILLISECONDS
        || interval > MAXIMUM_RENEWAL_INTERVAL_MILLISECONDS) {
        reject('Same-relay reauthentication was not observed in its scheduled interval');
      }
      retained.reauthenticatedElapsed = fact.elapsed_milliseconds;
      break;
    }
    case 'relay_handoff_stale': {
      requireOptionalEvidence(fact, { state: true });
      requireObservationState(observation, 'ready');
      exact(observation.control_plane_exchanges, 3,
        'route-changing control-plane exchange count');
      exact(observation.firebase_token_requests, 3,
        'route-changing Firebase source request count');
      exact(observation.app_check_token_requests, 3,
        'route-changing App Check source request count');
      if (observation.websocket_connections < 1 || observation.websocket_connections > 2
        || observation.maximum_active_websockets !== 1
        || !observation.client_statuses.includes('reconnecting')
        || !isDeepStrictEqual(
          observation.relay_ids,
          observation.websocket_connections === 1
            ? ['relay-a']
            : ['relay-a', 'relay-b'],
        )) {
        reject('Route-changing handoff did not remain serialized');
      }
      if (fact.state_observation?.state !== 'pending'
        || fact.state_observation.stale !== true
        || fact.state_observation.revision < retained.patchedRevision) {
        reject('Route-changing handoff did not expose an honest stale view');
      }
      const interval = fact.elapsed_milliseconds - retained.reauthenticatedElapsed;
      if (interval < MINIMUM_RENEWAL_INTERVAL_MILLISECONDS
        || interval > MAXIMUM_RENEWAL_INTERVAL_MILLISECONDS) {
        reject('Route-changing reauthentication was not observed in its scheduled interval');
      }
      break;
    }
    case 'relay_b_ready':
      requireOptionalEvidence(fact, {});
      requireReady(observation, {
        clientInstances: 1,
        controlPlaneExchanges: 3,
        websocketConnections: 2,
        relayIds: ['relay-a', 'relay-b'],
      });
      break;
    case 'relay_b_state':
      requireOptionalEvidence(fact, { state: true });
      requireObservationState(observation, 'ready');
      retained.relayBRevision = requireMatchedState(fact, retained.patchedRevision);
      break;
    case 'relay_b_call':
      requireOptionalEvidence(fact, { call: true });
      requireObservationState(observation, 'ready');
      exact(observation.active_websockets, 1, 'relay B call active WebSocket count');
      requireAppliedCall(fact);
      break;
    case 'failed_and_uncertain_calls':
      requireOptionalEvidence(fact, { state: true });
      requireObservationState(observation, 'ready');
      if (!hasOutcome(fact.lifecycle_observation, 'failed')
        || !hasOutcome(fact.lifecycle_observation, 'outcome_unknown')
        || fact.state_observation?.state !== 'pending'
        || fact.state_observation.stale !== true) {
        reject('Stable failed and uncertain outcomes were not both observed');
      }
      retained.uncertainWebsocketConnections = observation.websocket_connections;
      break;
    case 'relay_b_recovered':
      requireOptionalEvidence(fact, { state: true });
      requireReady(observation, {
        clientInstances: 1,
        controlPlaneExchanges: 4,
        websocketConnections: 3,
        relayIds: ['relay-a', 'relay-b'],
      });
      if (retained.uncertainWebsocketConnections !== 2) {
        reject('The uncertain call did not precede exactly one replacement connection');
      }
      retained.recoveredRevision = requireMatchedState(fact, retained.relayBRevision);
      break;
    case 'pagehide_suspended':
      requireOptionalEvidence(fact, { lifecycle: 'pagehide' });
      requireObservationState(observation, 'suspended');
      exact(observation.client_instances, 1, 'suspended client instance count');
      exact(observation.websocket_connections, 3, 'suspended WebSocket connection count');
      exact(observation.active_websockets, 0, 'suspended active WebSocket count');
      exact(observation.maximum_active_websockets, 1,
        'suspended maximum active WebSocket count');
      requireLifecycleCleanup(fact, {
        suspensions: 1,
        resumptions: 0,
        sign_outs: 0,
        disposals: 0,
      });
      retained.pagehideElapsed = fact.elapsed_milliseconds;
      break;
    case 'pageshow_restored':
      requireOptionalEvidence(fact, { state: true, lifecycle: 'pageshow' });
      requireReady(observation, {
        clientInstances: 2,
        controlPlaneExchanges: 5,
        websocketConnections: 4,
        relayIds: ['relay-a', 'relay-b'],
      });
      requireMatchedState(fact, retained.recoveredRevision);
      requireLifecycleCleanup(fact, {
        suspensions: 1,
        resumptions: 1,
        sign_outs: 0,
        disposals: 0,
      });
      if (fact.elapsed_milliseconds - retained.pagehideElapsed
        > MAXIMUM_LIFECYCLE_PAUSE_MILLISECONDS) {
        reject('Page lifecycle restore exceeded its reviewed bound');
      }
      break;
    case 'signed_out_stopped':
      requireOptionalEvidence(fact, {});
      requireObservationState(observation, 'stopped');
      exact(observation.client_instances, 2, 'stopped client instance count');
      exact(observation.websocket_connections, 4, 'stopped WebSocket connection count');
      exact(observation.active_websockets, 0, 'stopped active WebSocket count');
      requireLifecycleCleanup(fact, {
        suspensions: 1,
        resumptions: 1,
        sign_outs: 1,
        disposals: 1,
      });
      retained.firstIdentityStoppedElapsed = fact.elapsed_milliseconds;
      break;
    case 'replacement_initialized':
      requireOptionalEvidence(fact, {});
      requireInitialized(observation);
      requireFreshLifecycle(fact);
      if (fact.elapsed_milliseconds < retained.firstIdentityStoppedElapsed) {
        reject('Replacement identity started before prior identity teardown');
      }
      break;
    case 'replacement_ready':
      requireOptionalEvidence(fact, {});
      requireReady(observation, {
        clientInstances: 1,
        controlPlaneExchanges: 1,
        websocketConnections: 1,
        relayIds: ['relay-b'],
      });
      break;
    case 'replacement_stopped':
      requireOptionalEvidence(fact, {});
      requireObservationState(observation, 'stopped');
      exact(observation.client_instances, 1, 'replacement client instance count');
      exact(observation.websocket_connections, 1, 'replacement WebSocket connection count');
      exact(observation.active_websockets, 0, 'replacement active WebSocket count');
      exact(observation.maximum_active_websockets, 1,
        'replacement maximum active WebSocket count');
      exact(observation.relay_ids, ['relay-b'], 'replacement relay IDs');
      requireLifecycleCleanup(fact, {
        suspensions: 0,
        resumptions: 0,
        sign_outs: 1,
        disposals: 1,
      });
      break;
    default:
      reject('Chromium page-fact phase is not implemented');
  }
}

function validateSecondaryPhase(fact) {
  requirePageIdentity(fact, 1, 1, 1);
  const observation = fact.observation;
  if (fact.phase !== 'signed_out_stopped') requireNoTerminalCleanup(fact);
  switch (fact.phase) {
    case 'initial_initialized':
      requireOptionalEvidence(fact, {});
      requireInitialized(observation);
      requireFreshLifecycle(fact);
      break;
    case 'initial_ready':
      requireOptionalEvidence(fact, {});
      requireReady(observation, {
        clientInstances: 1,
        controlPlaneExchanges: 1,
        websocketConnections: 1,
        relayIds: ['relay-b'],
      });
      break;
    case 'signed_out_stopped':
      requireOptionalEvidence(fact, {});
      requireObservationState(observation, 'stopped');
      exact(observation.client_instances, 1, 'secondary client instance count');
      exact(observation.websocket_connections, 1, 'secondary WebSocket connection count');
      exact(observation.active_websockets, 0, 'secondary active WebSocket count');
      exact(observation.maximum_active_websockets, 1,
        'secondary maximum active WebSocket count');
      exact(observation.relay_ids, ['relay-b'], 'secondary relay IDs');
      requireLifecycleCleanup(fact, {
        suspensions: 0,
        resumptions: 0,
        sign_outs: 1,
        disposals: 1,
      });
      break;
    default:
      reject('Secondary page-fact phase is not implemented');
  }
}

export function createBrowserRelayPageReceiptProducer(browser) {
  validateBrowserRelayPageReceiptProfile();
  if (!Object.hasOwn(PAGE_FACT_ORDER_BY_BROWSER, browser)) {
    reject('Browser-page receipt browser is not reviewed');
  }
  const phases = PAGE_FACT_ORDER_BY_BROWSER[browser];
  let state = 'collecting';
  let nextSequence = 1;
  let lastElapsed = 0;
  let maximumActiveWebsockets = 0;
  let lastObservationByPage = new Map();
  let lastLifecycleByPage = new Map();
  let retained = {};

  function discard(nextState) {
    state = nextState;
    nextSequence = phases.length + 1;
    lastElapsed = 0;
    maximumActiveWebsockets = 0;
    lastObservationByPage.clear();
    lastObservationByPage = new Map();
    lastLifecycleByPage.clear();
    lastLifecycleByPage = new Map();
    retained = {};
  }

  function fail(message) {
    discard('failed');
    reject(message);
  }

  return Object.freeze({
    record(factValue) {
      if (state !== 'collecting') {
        reject('Browser-page receipt producer cannot accept a fact after closure');
      }
      if (nextSequence > phases.length) {
        return fail('Browser-page receipt producer received too many facts');
      }
      let fact;
      try {
        fact = validateBrowserRelayPageFact(factValue, browser, nextSequence);
        if (fact.elapsed_milliseconds < lastElapsed) {
          reject('Browser-page facts are not monotonic');
        }
        const previous = lastObservationByPage.get(fact.page_instance);
        requireCumulativeObservation(previous, fact.observation);
        const previousLifecycle = lastLifecycleByPage.get(fact.page_instance);
        requireCumulativeLifecycle(previousLifecycle, fact.lifecycle_observation);
        if (browser === 'chromium') validateChromiumPhase(fact, retained);
        else validateSecondaryPhase(fact);
        lastObservationByPage.set(fact.page_instance, fact.observation);
        lastLifecycleByPage.set(fact.page_instance, fact.lifecycle_observation);
        lastElapsed = fact.elapsed_milliseconds;
        maximumActiveWebsockets = Math.max(
          maximumActiveWebsockets,
          fact.observation.maximum_active_websockets,
        );
        nextSequence += 1;
      } catch {
        return fail(`Browser-page receipt rejected ${phases[nextSequence - 1]} and failed closed`);
      }
      return true;
    },

    close() {
      if (state !== 'collecting') reject('Browser-page receipt producer may close exactly once');
      if (nextSequence !== phases.length + 1) {
        return fail('Browser-page receipt cannot close before every reviewed fact arrived');
      }
      const counters = emptyCounters();
      counters.maximum_active_websockets = maximumActiveWebsockets;
      let receipt;
      try {
        receipt = validateSourceReceipt({
          schema: SOURCE_RECEIPT_SCHEMA,
          browser,
          source: 'browser_page',
          state: 'observed_closed',
          assertions: Object.fromEntries(
            SOURCE_ASSERTIONS[browser].browser_page.map((assertion) => [assertion, true]),
          ),
          counters,
          public_key_ids: [],
          revision_ids: [],
          stable_outcome_classes: browser === 'chromium'
            ? [...STABLE_OUTCOME_CLASSES]
            : [],
        }, browser, 'browser_page');
      } catch {
        return fail('Browser-page facts could not produce a closed source receipt');
      }
      discard('closed');
      return receipt;
    },

    abort() {
      if (state === 'closed') reject('Browser-page receipt producer cannot abort after closure');
      if (state !== 'aborted') discard('aborted');
      return true;
    },
  });
}

export function produceBrowserRelayPageReceipt(browser, factValues) {
  if (!Array.isArray(factValues)) reject('Browser-page facts must be one ordered array');
  const producer = createBrowserRelayPageReceiptProducer(browser);
  try {
    for (const fact of factValues) producer.record(fact);
    return producer.close();
  } catch (error) {
    try {
      producer.abort();
    } catch {}
    if (error instanceof StagingBrowserRelayPageReceiptError) throw error;
    return reject('Browser-page receipt production failed before closure');
  }
}
