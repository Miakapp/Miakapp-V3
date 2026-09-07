import { addAbortListener } from 'node:events';
import { env } from 'node:process';
import { isDeepStrictEqual } from 'node:util';
import {
  inprocess as playwrightInprocess,
  utils as playwrightCoreUtils,
} from 'playwright-core/lib/coreBundle';
import { debug as playwrightDebug } from 'playwright-core/lib/utilsBundle';

import {
  TARGET_URL,
  validatePageLifecycleObservation,
  validatePagePrivateInput,
  validatePageSafeObservation,
} from '../browser-relay-page/contract.mjs';
import {
  PAGE_CALL_OBSERVATION_SCHEMA,
  PAGE_FACT_ORDER_BY_BROWSER,
  PAGE_FACT_SCHEMA,
  MAXIMUM_LIFECYCLE_PAUSE_MILLISECONDS,
  validatePageCallObservation,
  validateBrowserRelayPageFact,
  validatePageLifecycleEvent,
  validatePageStateObservation,
} from '../browser-relay-page-receipt/contract.mjs';
import { createBrowserRelayPageReceiptProducer } from '../browser-relay-page-receipt/producer.mjs';
import { validatePlaywrightDiagnosticEnvironment } from '../browser-relay-runner/driver.mjs';
import {
  CHROMIUM_SCENARIO_AWAY_URL,
  CHROMIUM_SCENARIO_RESULT_SCHEMA,
  CONTROL_PHASE_ORDER,
  MAXIMUM_CHROMIUM_CLEANUP_MILLISECONDS,
  MAXIMUM_CHROMIUM_SCENARIO_MILLISECONDS,
  StagingBrowserRelayChromiumScenarioError,
  validateChromiumScenarioControlResult,
  validateChromiumScenarioResult,
} from './contract.mjs';

const DEPENDENCY_FIELDS = Object.freeze([
  'controlPhase',
  'openPage',
  'privateInputProvider',
]);
const TIMING_FIELDS = Object.freeze([
  'clearTimer',
  'clock',
  'maximumMilliseconds',
  'setTimer',
]);
const PAGE_PROJECTION_FIELDS = Object.freeze([
  'call_observation',
  'lifecycle_event',
  'lifecycle_observation',
  'observation',
  'state_observation',
]);
const PAGE_API_METHODS = Object.freeze([
  'initialize',
  'start',
  'observe',
  'observeLifecycle',
  'observeState',
  'call',
  'suspend',
  'resume',
  'stop',
]);
const WITNESS_NAME = 'miakappChromiumBfcacheWitness';
const ABORTED_GETTER = Object.getOwnPropertyDescriptor(
  AbortSignal.prototype,
  'aborted',
).get;
const MAP_SIZE_GETTER = Object.getOwnPropertyDescriptor(Map.prototype, 'size').get;
const MAP_GET = Map.prototype.get;
const MAP_HAS = Map.prototype.has;
const MAP_DELETE = Map.prototype.delete;
const MAP_SET = Map.prototype.set;
const MAP_VALUES = Map.prototype.values;
const SET_ADD = Set.prototype.add;
const SET_DELETE = Set.prototype.delete;
const SET_HAS = Set.prototype.has;
const WEAK_MAP_GET = WeakMap.prototype.get;
const WEAK_MAP_SET = WeakMap.prototype.set;
const WEAK_SET_ADD = WeakSet.prototype.add;
const WEAK_SET_HAS = WeakSet.prototype.has;
const PRIVATE_PLAYWRIGHT_INSTRUMENTATION = Object.freeze({
  onApiCallBegin() {},
  onApiCallEnd() {},
  onPage() {},
});
const SYNTHETIC_PLAYWRIGHT_BOUNDARY = Symbol('synthetic Playwright testing boundary');
const PLAYWRIGHT_DEBUG_METHODS = Object.freeze(Object.fromEntries([
  'disable',
  'enable',
  'enabled',
  'log',
].map((name) => [name, playwrightDebug[name]])));
const PLAYWRIGHT_DEBUG_LEASE_FIELDS = Object.freeze([
  'disable',
  'enable',
  'enabled',
  'inspectOpts',
  'log',
  'names',
  'namespaces',
  'skips',
]);
const PLAYWRIGHT_CORE_DEBUG_LOGGER = playwrightCoreUtils.debugLogger;
const PLAYWRIGHT_CORE_DEBUG_LOGGER_PROTOTYPE = Object.getPrototypeOf(
  PLAYWRIGHT_CORE_DEBUG_LOGGER,
);
const PLAYWRIGHT_CORE_DEBUG_LOGGER_METHODS = Object.freeze(Object.fromEntries([
  'isEnabled',
  'log',
].map((name) => [
  name,
  Object.getOwnPropertyDescriptor(
    PLAYWRIGHT_CORE_DEBUG_LOGGER_PROTOTYPE,
    name,
  )?.value,
])));
const PLAYWRIGHT_CORE_DEBUG_LOGGER_LEASE_FIELDS = Object.freeze([
  'isEnabled',
  'log',
]);
const PLAYWRIGHT_CORE_DEBUG_LOGGER_VALUES = Object.freeze({
  isEnabled() { return false; },
  log() {},
});
const NETWORK_OBSERVER_EVENTS = Object.freeze([
  'request',
  'requestfailed',
  'requestfinished',
  'response',
  'websocket',
]);
const NETWORK_SUBSCRIPTION_PROTOCOL_EVENTS = new Set([
  'request',
  'requestFailed',
  'requestFinished',
  'response',
  'webSocket',
]);
const SENSITIVE_PENDING_PROTOCOL_METHODS = new Set([
  'Browser.newBrowserCDPSession',
  'BrowserContext.newCDPSession',
  'BrowserContext.setNetworkInterceptionPatterns',
  'BrowserContext.setWebSocketInterceptionPatterns',
  'BrowserContext.updateSubscription',
  'Frame.goBack',
  'Frame.goForward',
  'Frame.goto',
  'Frame.reload',
  'Frame.setContent',
  'Page.setNetworkInterceptionPatterns',
  'Page.setWebSocketInterceptionPatterns',
  'Page.updateSubscription',
]);
let trustedChromiumScenarioActive = false;
let trustedChromiumScenarioPoisoned = false;

function reject(message = 'Staging Chromium scenario failed before a closed receipt') {
  throw new StagingBrowserRelayChromiumScenarioError(message);
}

function plainObject(value) {
  if (value === null || Array.isArray(value) || typeof value !== 'object') return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function exactKeys(value, keys, path) {
  let descriptors;
  try {
    const ownKeys = Reflect.ownKeys(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
    if (!plainObject(value)
      || ownKeys.some((key) => typeof key !== 'string')
      || !isDeepStrictEqual(ownKeys.sort(), [...keys].sort())
      || keys.some((key) => !descriptors[key]?.enumerable
        || !Object.hasOwn(descriptors[key], 'value'))) {
      reject(`${path} must contain exactly the reviewed direct fields`);
    }
  } catch {
    reject(`${path} must contain exactly the reviewed fields`);
  }
  return Object.freeze(Object.fromEntries(keys.map((key) => [key, descriptors[key].value])));
}

function directDataProperty(value, key, path, optional = false) {
  let descriptor;
  try {
    descriptor = Object.getOwnPropertyDescriptor(value, key);
  } catch {
    return reject(`${path} must be a direct data property`);
  }
  if (descriptor === undefined && optional) return undefined;
  if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')) {
    reject(`${path} must be a direct data property`);
  }
  return descriptor.value;
}

function createTrustedPlaywrightRuntime() {
  try {
    const playwrightDescriptor = Object.getOwnPropertyDescriptor(
      playwrightInprocess,
      'playwright',
    );
    if (playwrightDescriptor === undefined
      || typeof playwrightDescriptor.get !== 'function'
      || playwrightDescriptor.set !== undefined
      || playwrightDescriptor.configurable !== false) {
      reject('Pinned Playwright runtime export is invalid');
    }
    const playwright = Reflect.apply(
      playwrightDescriptor.get,
      playwrightInprocess,
      [],
    );
    const chromium = directDataProperty(
      playwright,
      'chromium',
      'Pinned Playwright Chromium runtime',
    );
    const connection = directDataProperty(
      chromium,
      '_connection',
      'Pinned Playwright connection',
    );
    const factories = directDataProperty(
      connection,
      '_objectFactories',
      'Pinned Playwright object factories',
    );
    const browserContextFactory = MAP_GET.call(factories, 'BrowserContext');
    const cdpSessionFactory = MAP_GET.call(factories, 'CDPSession');
    const frameFactory = MAP_GET.call(factories, 'Frame');
    const pageFactory = MAP_GET.call(factories, 'Page');
    if (typeof browserContextFactory !== 'function'
      || typeof cdpSessionFactory !== 'function'
      || typeof frameFactory !== 'function'
      || typeof pageFactory !== 'function') {
      reject('Pinned Playwright page factories are invalid');
    }
    const dummyConnection = {
      _instrumentation: PRIVATE_PLAYWRIGHT_INSTRUMENTATION,
      _objects: new Map(),
      isRemote() { return false; },
      rawBuffers() { return false; },
      sendMessageToServer() { reject('Pinned Playwright dummy channel was used'); },
    };
    const frame = Reflect.apply(frameFactory, undefined, [
      dummyConnection,
      'Frame',
      'miakapp-reviewed-frame',
      { loadStates: [], name: '', parentFrame: null, url: 'about:blank' },
    ]);
    const page = Reflect.apply(pageFactory, undefined, [
      dummyConnection,
      'Page',
      'miakapp-reviewed-page',
      { isClosed: false, mainFrame: frame._channel, viewportSize: null },
    ]);
    const remoteObject = () => ({ _object: {} });
    const browserContext = Reflect.apply(browserContextFactory, undefined, [
      dummyConnection,
      'BrowserContext',
      'miakapp-reviewed-context',
      {
        debugger: remoteObject(),
        options: { serviceWorkers: 'block' },
        requestContext: remoteObject(),
        tracing: remoteObject(),
      },
    ]);
    const cdpSession = Reflect.apply(cdpSessionFactory, undefined, [
      dummyConnection,
      'CDPSession',
      'miakapp-reviewed-cdp-session',
      {},
    ]);
    const browserContextPrototype = Object.getPrototypeOf(browserContext);
    const cdpSessionPrototype = Object.getPrototypeOf(cdpSession);
    const framePrototype = Object.getPrototypeOf(frame);
    const pagePrototype = Object.getPrototypeOf(page);
    const channelOwnerPrototype = Object.getPrototypeOf(framePrototype);
    const eventEmitterPrototype = Object.getPrototypeOf(channelOwnerPrototype);
    const channelPrototype = Object.getPrototypeOf(frame._channel);
    const connectionPrototype = Object.getPrototypeOf(connection);
    const frameMethods = Object.freeze(Object.fromEntries([
      '_navigationTimeout',
      'evaluate',
      'goto',
      'url',
    ].map((name) => {
      const descriptor = Object.getOwnPropertyDescriptor(framePrototype, name);
      if (descriptor === undefined
        || !Object.hasOwn(descriptor, 'value')
        || typeof descriptor.value !== 'function') {
        reject(`Pinned Playwright Frame.${name} identity is invalid`);
      }
      return [name, descriptor.value];
    })));
    const sendDescriptor = Object.getOwnPropertyDescriptor(
      connectionPrototype,
      'sendMessageToServer',
    );
    const rawBuffersDescriptor = Object.getOwnPropertyDescriptor(
      connectionPrototype,
      'rawBuffers',
    );
    const onmessageDescriptor = Object.getOwnPropertyDescriptor(
      connection,
      'onmessage',
    );
    const channelOwnerMethods = Object.freeze(Object.fromEntries([
      '_validatorToWireContext',
      '_wrapApiCall',
    ].map((name) => {
      const descriptor = Object.getOwnPropertyDescriptor(channelOwnerPrototype, name);
      if (descriptor === undefined
        || !Object.hasOwn(descriptor, 'value')
        || typeof descriptor.value !== 'function') {
        reject(`Pinned Playwright ChannelOwner.${name} identity is invalid`);
      }
      return [name, descriptor.value];
    })));
    const eventEmitterMethods = Object.freeze(Object.fromEntries([
      'emit',
      'listenerCount',
    ].map((name) => {
      const descriptor = Object.getOwnPropertyDescriptor(eventEmitterPrototype, name);
      if (descriptor === undefined
        || !Object.hasOwn(descriptor, 'value')
        || typeof descriptor.value !== 'function') {
        reject(`Pinned Playwright EventEmitter.${name} identity is invalid`);
      }
      return [name, descriptor.value];
    })));
    const browserContextMethods = Object.freeze(Object.fromEntries([
      'newCDPSession',
    ].map((name) => {
      const descriptor = Object.getOwnPropertyDescriptor(browserContextPrototype, name);
      if (descriptor === undefined
        || !Object.hasOwn(descriptor, 'value')
        || typeof descriptor.value !== 'function') {
        reject(`Pinned Playwright BrowserContext.${name} identity is invalid`);
      }
      return [name, descriptor.value];
    })));
    const cdpSessionMethods = Object.freeze(Object.fromEntries([
      'detach',
      'send',
    ].map((name) => {
      const descriptor = Object.getOwnPropertyDescriptor(cdpSessionPrototype, name);
      if (descriptor === undefined
        || !Object.hasOwn(descriptor, 'value')
        || typeof descriptor.value !== 'function') {
        reject(`Pinned Playwright CDPSession.${name} identity is invalid`);
      }
      return [name, descriptor.value];
    })));
    const cdpSessionEventMethods = Object.freeze(Object.fromEntries([
      'addListener',
      'off',
      'on',
      'once',
      'removeListener',
    ].map((name) => {
      const descriptor = Object.getOwnPropertyDescriptor(cdpSession, name);
      if (descriptor === undefined
        || !Object.hasOwn(descriptor, 'value')
        || typeof descriptor.value !== 'function'
        || descriptor.configurable !== true) {
        reject(`Pinned Playwright CDPSession.${name} event identity is invalid`);
      }
      return [name, Object.freeze({ descriptor, value: descriptor.value })];
    })));
    const pageMethods = Object.freeze(Object.fromEntries([
      'context',
      'goto',
      'isClosed',
      'url',
      'video',
    ].map((name) => {
      const descriptor = Object.getOwnPropertyDescriptor(pagePrototype, name);
      if (descriptor === undefined
        || !Object.hasOwn(descriptor, 'value')
        || typeof descriptor.value !== 'function') {
        reject(`Pinned Playwright Page.${name} identity is invalid`);
      }
      return [name, descriptor.value];
    })));
    if (framePrototype === null
      || pagePrototype === null
      || browserContextPrototype === null
      || cdpSessionPrototype === null
      || channelOwnerPrototype === null
      || eventEmitterPrototype === null
      || Object.getPrototypeOf(channelOwnerPrototype) !== eventEmitterPrototype
      || Object.getPrototypeOf(pagePrototype) !== channelOwnerPrototype
      || Object.getPrototypeOf(browserContextPrototype) !== channelOwnerPrototype
      || Object.getPrototypeOf(cdpSessionPrototype) !== channelOwnerPrototype
      || channelPrototype === null
      || connectionPrototype === null
      || sendDescriptor === undefined
      || !Object.hasOwn(sendDescriptor, 'value')
      || typeof sendDescriptor.value !== 'function'
      || rawBuffersDescriptor === undefined
      || !Object.hasOwn(rawBuffersDescriptor, 'value')
      || typeof rawBuffersDescriptor.value !== 'function'
      || onmessageDescriptor === undefined
      || !Object.hasOwn(onmessageDescriptor, 'value')
      || typeof onmessageDescriptor.value !== 'function'
      || onmessageDescriptor.configurable !== true) {
      reject('Pinned Playwright runtime identities are invalid');
    }
    if (Object.getOwnPropertyDescriptor(channelPrototype, 'evaluateExpression')
      !== undefined) {
      reject('Pinned Playwright channel prototype is invalid');
    }
    return Object.freeze({
      browserContextConstructor: browserContext.constructor,
      browserContextFactory,
      browserContextMethods,
      browserContextPrototype,
      cdpSessionConstructor: cdpSession.constructor,
      cdpSessionFactory,
      cdpSessionEventMethods,
      cdpSessionMethods,
      cdpSessionPrototype,
      channelOwnerMethods,
      channelOwnerPrototype,
      channelPrototype,
      connection,
      connectionPrototype,
      eventEmitterMethods,
      eventEmitterPrototype,
      factories,
      frameConstructor: frame.constructor,
      frameFactory,
      frameMethods,
      framePrototype,
      pageConstructor: page.constructor,
      pageFactory,
      pageMethods,
      pagePrototype,
      onmessage: onmessageDescriptor.value,
      onmessageDescriptor,
      rawBuffers: rawBuffersDescriptor.value,
      sendMessageToServer: sendDescriptor.value,
    });
  } catch {
    return reject('Pinned Playwright runtime identities are unavailable');
  }
}

const TRUSTED_PLAYWRIGHT_RUNTIME = createTrustedPlaywrightRuntime();

function inspectTrustedChannelOwner(owner, connection, type) {
  let descriptors;
  try {
    descriptors = Object.fromEntries([
      '_connection',
      '_instrumentation',
      '_logger',
      '_type',
      '_validatorToWireContext',
      '_wrapApiCall',
    ].map((name) => [name, Object.getOwnPropertyDescriptor(owner, name)]));
  } catch {
    return reject('Chromium Playwright ChannelOwner boundary is invalid');
  }
  if (descriptors._connection === undefined
    || !Object.hasOwn(descriptors._connection, 'value')
    || descriptors._connection.value !== connection
    || descriptors._instrumentation === undefined
    || !Object.hasOwn(descriptors._instrumentation, 'value')
    || descriptors._instrumentation.value === null
    || typeof descriptors._instrumentation.value !== 'object'
    || (descriptors._logger !== undefined
      && (!Object.hasOwn(descriptors._logger, 'value')
        || descriptors._logger.value !== undefined))
    || descriptors._type === undefined
    || !Object.hasOwn(descriptors._type, 'value')
    || descriptors._type.value !== type
    || descriptors._validatorToWireContext !== undefined
    || descriptors._wrapApiCall !== undefined) {
    reject('Chromium Playwright ChannelOwner boundary is invalid');
  }
  return descriptors;
}

function restoreOwnDescriptors(owner, descriptors, names) {
  for (const name of [...names].reverse()) {
    const descriptor = descriptors[name];
    if (descriptor === undefined) {
      if (!Reflect.deleteProperty(owner, name)) return false;
    } else {
      Object.defineProperty(owner, name, descriptor);
    }
  }
  return true;
}

function installTrustedChannelOwnerLease(owner, connection, type) {
  const descriptors = inspectTrustedChannelOwner(owner, connection, type);
  const values = Object.freeze({
    _connection: connection,
    _instrumentation: PRIVATE_PLAYWRIGHT_INSTRUMENTATION,
    _logger: undefined,
    _type: type,
    _validatorToWireContext:
      TRUSTED_PLAYWRIGHT_RUNTIME.channelOwnerMethods._validatorToWireContext,
    _wrapApiCall: TRUSTED_PLAYWRIGHT_RUNTIME.channelOwnerMethods._wrapApiCall,
  });
  const names = Object.freeze(Object.keys(values));
  const installed = [];
  try {
    for (const name of names) {
      Object.defineProperty(owner, name, {
        configurable: true,
        enumerable: descriptors[name]?.enumerable ?? false,
        value: values[name],
        writable: false,
      });
      installed.push(name);
    }
  } catch {
    try { restoreOwnDescriptors(owner, descriptors, installed); } catch {}
    return reject('Chromium Playwright ChannelOwner lease could not be installed');
  }
  return { descriptors, names, owner, values };
}

function trustedChannelOwnerLeaseIntact(lease) {
  try {
    return lease.names.every((name) => {
      const descriptor = Object.getOwnPropertyDescriptor(lease.owner, name);
      return descriptor?.configurable === true
        && descriptor.enumerable === (lease.descriptors[name]?.enumerable ?? false)
        && descriptor.value === lease.values[name]
        && descriptor.writable === false;
    });
  } catch {
    return false;
  }
}

function releaseTrustedChannelOwnerLease(lease) {
  try {
    return trustedChannelOwnerLeaseIntact(lease)
      && restoreOwnDescriptors(lease.owner, lease.descriptors, lease.names);
  } catch {
    return false;
  }
}

function validatePlaywrightDiagnosticBoundary(lease) {
  try {
    const debug = env.DEBUG ?? '';
    const coreLogger = playwrightCoreUtils.debugLogger;
    const coreLoggerOwnMethods = PLAYWRIGHT_CORE_DEBUG_LOGGER_LEASE_FIELDS.map(
      (name) => Object.getOwnPropertyDescriptor(coreLogger, name),
    );
    if (typeof debug !== 'string' || debug.trim() !== ''
      || env.PWDEBUG !== undefined
      || env.DEBUG_FILE !== undefined
      || (playwrightDebug.namespaces !== undefined && playwrightDebug.namespaces !== '')
      || !Array.isArray(playwrightDebug.names) || playwrightDebug.names.length !== 0
      || !Array.isArray(playwrightDebug.skips) || playwrightDebug.skips.length !== 0
      || playwrightDebug.inspectOpts === null
      || typeof playwrightDebug.inspectOpts !== 'object'
      || Reflect.ownKeys(playwrightDebug.inspectOpts).length !== 0
      || Object.entries(PLAYWRIGHT_DEBUG_METHODS).some(
        ([name, method]) => playwrightDebug[name] !== method,
      )
      || coreLogger !== PLAYWRIGHT_CORE_DEBUG_LOGGER
      || Object.getPrototypeOf(coreLogger) !== PLAYWRIGHT_CORE_DEBUG_LOGGER_PROTOTYPE
      || Object.entries(PLAYWRIGHT_CORE_DEBUG_LOGGER_METHODS).some(
        ([name, method]) => typeof method !== 'function'
          || Object.getOwnPropertyDescriptor(
            PLAYWRIGHT_CORE_DEBUG_LOGGER_PROTOTYPE,
            name,
          )?.value !== method,
      )
      || (lease === undefined && coreLoggerOwnMethods.some(
        (descriptor) => descriptor !== undefined,
      ))
      || (lease !== undefined && PLAYWRIGHT_DEBUG_LEASE_FIELDS.some((name) => {
        const descriptor = Object.getOwnPropertyDescriptor(playwrightDebug, name);
        return descriptor?.value !== lease.values[name]
          || descriptor.configurable !== true
          || descriptor.enumerable !== lease.descriptors[name].enumerable
          || descriptor.writable !== false;
      }))
      || (lease !== undefined
        && PLAYWRIGHT_CORE_DEBUG_LOGGER_LEASE_FIELDS.some((name) => {
          const descriptor = Object.getOwnPropertyDescriptor(coreLogger, name);
          return descriptor?.value !== PLAYWRIGHT_CORE_DEBUG_LOGGER_VALUES[name]
            || descriptor.configurable !== true
            || descriptor.enumerable !== false
            || descriptor.writable !== false;
        }))
      || playwrightCoreUtils.debugMode() !== '') {
      reject('Chromium scenario diagnostic environment is invalid');
    }
    validatePlaywrightDiagnosticEnvironment();
  } catch {
    return reject('Chromium scenario diagnostic environment is invalid');
  }
}

function installPlaywrightDiagnosticLease() {
  validatePlaywrightDiagnosticBoundary();
  const descriptors = Object.fromEntries(PLAYWRIGHT_DEBUG_LEASE_FIELDS.map(
    (name) => [name, Object.getOwnPropertyDescriptor(playwrightDebug, name)],
  ));
  if (PLAYWRIGHT_DEBUG_LEASE_FIELDS.some((name) => descriptors[name] === undefined
    || !Object.hasOwn(descriptors[name], 'value')
    || descriptors[name].configurable !== true)) {
    reject('Chromium Playwright diagnostic lease boundary is invalid');
  }
  const values = Object.freeze({
    ...PLAYWRIGHT_DEBUG_METHODS,
    inspectOpts: Object.freeze({}),
    names: Object.freeze([]),
    namespaces: '',
    skips: Object.freeze([]),
  });
  const installed = [];
  const coreLoggerDescriptors = Object.fromEntries(
    PLAYWRIGHT_CORE_DEBUG_LOGGER_LEASE_FIELDS.map((name) => [
      name,
      Object.getOwnPropertyDescriptor(PLAYWRIGHT_CORE_DEBUG_LOGGER, name),
    ]),
  );
  const coreLoggerInstalled = [];
  try {
    for (const name of PLAYWRIGHT_DEBUG_LEASE_FIELDS) {
      Object.defineProperty(playwrightDebug, name, {
        configurable: true,
        enumerable: descriptors[name].enumerable,
        value: values[name],
        writable: false,
      });
      installed.push(name);
    }
    for (const name of PLAYWRIGHT_CORE_DEBUG_LOGGER_LEASE_FIELDS) {
      Object.defineProperty(PLAYWRIGHT_CORE_DEBUG_LOGGER, name, {
        configurable: true,
        enumerable: false,
        value: PLAYWRIGHT_CORE_DEBUG_LOGGER_VALUES[name],
        writable: false,
      });
      coreLoggerInstalled.push(name);
    }
  } catch {
    try { restoreOwnDescriptors(playwrightDebug, descriptors, installed); } catch {}
    try {
      restoreOwnDescriptors(
        PLAYWRIGHT_CORE_DEBUG_LOGGER,
        coreLoggerDescriptors,
        coreLoggerInstalled,
      );
    } catch {}
    return reject('Chromium Playwright diagnostic lease could not be installed');
  }
  const lease = { coreLoggerDescriptors, descriptors, values };
  validatePlaywrightDiagnosticBoundary(lease);
  return lease;
}

function releasePlaywrightDiagnosticLease(lease) {
  let intact = true;
  try {
    validatePlaywrightDiagnosticBoundary(lease);
  } catch {
    intact = false;
  }
  try {
    intact = restoreOwnDescriptors(
      PLAYWRIGHT_CORE_DEBUG_LOGGER,
      lease.coreLoggerDescriptors,
      PLAYWRIGHT_CORE_DEBUG_LOGGER_LEASE_FIELDS,
    ) && intact;
    return restoreOwnDescriptors(
      playwrightDebug,
      lease.descriptors,
      PLAYWRIGHT_DEBUG_LEASE_FIELDS,
    ) && intact;
  } catch {
    return false;
  }
}

function validateDependencies(value) {
  const dependencies = exactKeys(value, DEPENDENCY_FIELDS, 'Chromium scenario dependencies');
  for (const field of DEPENDENCY_FIELDS) {
    if (typeof dependencies[field] !== 'function') {
      reject(`Chromium scenario dependency ${field} is invalid`);
    }
  }
  return Object.freeze(Object.fromEntries(DEPENDENCY_FIELDS.map((field) => [
    field,
    Function.prototype.bind.call(dependencies[field], value),
  ])));
}

function validatePageProjectionPort(value) {
  if (value === undefined) return undefined;
  try {
    const ownKeys = Reflect.ownKeys(value);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (!plainObject(value)
      || ownKeys.some((key) => typeof key !== 'string')
      || !isDeepStrictEqual(ownKeys.sort(), ['record', 'toJSON'])
      || !descriptors.record?.enumerable
      || !Object.hasOwn(descriptors.record, 'value')
      || typeof descriptors.record.value !== 'function'
      || descriptors.toJSON?.enumerable !== false
      || !Object.hasOwn(descriptors.toJSON, 'value')
      || typeof descriptors.toJSON.value !== 'function') {
      reject('Chromium scenario page-projection port is invalid');
    }
    return Object.freeze({
      record: Function.prototype.bind.call(descriptors.record.value, value),
    });
  } catch {
    return reject('Chromium scenario page-projection port is invalid');
  }
}

function validateTiming(value) {
  const timing = exactKeys(value, TIMING_FIELDS, 'Chromium scenario timing');
  if (typeof timing.clock !== 'function'
    || typeof timing.setTimer !== 'function'
    || typeof timing.clearTimer !== 'function'
    || !Number.isSafeInteger(timing.maximumMilliseconds)
    || timing.maximumMilliseconds <= 0
    || timing.maximumMilliseconds > MAXIMUM_CHROMIUM_SCENARIO_MILLISECONDS) {
    reject('Chromium scenario timing is invalid');
  }
  return Object.freeze({
    clock: Function.prototype.bind.call(timing.clock, value),
    setTimer: Function.prototype.bind.call(timing.setTimer, value),
    clearTimer: Function.prototype.bind.call(timing.clearTimer, value),
    maximumMilliseconds: timing.maximumMilliseconds,
  });
}

function validateSignal(value) {
  if (value === undefined) return undefined;
  try {
    if (!(value instanceof AbortSignal)) reject('Chromium scenario abort signal is invalid');
    ABORTED_GETTER.call(value);
  } catch {
    reject('Chromium scenario abort signal is invalid');
  }
  return value;
}

function signalAborted(signal) {
  if (signal === undefined) return false;
  try {
    return ABORTED_GETTER.call(signal);
  } catch {
    return reject('Chromium scenario abort signal failed closed');
  }
}

function instant(clock) {
  let value;
  try {
    value = clock();
  } catch {
    return reject('Chromium scenario clock is invalid');
  }
  if (!Number.isSafeInteger(value) || value < 0) {
    reject('Chromium scenario clock is invalid');
  }
  return value;
}

function validatePage(value, pageInstance, trustedBoundary) {
  if (value === null || typeof value !== 'object'
    || typeof value.evaluate !== 'function'
    || typeof value.close !== 'function'
    || typeof value.url !== 'function'
    || typeof value.context !== 'function'
    || typeof value.video !== 'function'
    || (pageInstance === 1 && typeof value.goto !== 'function')) {
    reject('Chromium scenario page boundary is invalid');
  }
  let url;
  try {
    url = trustedBoundary === undefined
      ? value.url()
      : Reflect.apply(
        TRUSTED_PLAYWRIGHT_RUNTIME.frameMethods.url,
        trustedBoundary.frame,
        [],
      );
  } catch {
    return reject('Chromium scenario page URL is unavailable');
  }
  if (url !== TARGET_URL) reject('Chromium scenario page is outside the reviewed target');
  return value;
}

function validatePinnedPlaywrightRuntime(
  frameFactory,
  pageFactory,
  browserContextFactory = TRUSTED_PLAYWRIGHT_RUNTIME.browserContextFactory,
  cdpSessionFactory = TRUSTED_PLAYWRIGHT_RUNTIME.cdpSessionFactory,
) {
  try {
    const connection = TRUSTED_PLAYWRIGHT_RUNTIME.connection;
    const connectionPrototype = Object.getPrototypeOf(connection);
    const sendDescriptor = Object.getOwnPropertyDescriptor(
      connectionPrototype,
      'sendMessageToServer',
    );
    const rawBuffersDescriptor = Object.getOwnPropertyDescriptor(
      connectionPrototype,
      'rawBuffers',
    );
    const channelOwnerMethodsIntact = Object.entries(
      TRUSTED_PLAYWRIGHT_RUNTIME.channelOwnerMethods,
    ).every(([name, method]) => Object.getOwnPropertyDescriptor(
      TRUSTED_PLAYWRIGHT_RUNTIME.channelOwnerPrototype,
      name,
    )?.value === method);
    const eventEmitterMethodsIntact = Object.entries(
      TRUSTED_PLAYWRIGHT_RUNTIME.eventEmitterMethods,
    ).every(([name, method]) => Object.getOwnPropertyDescriptor(
      TRUSTED_PLAYWRIGHT_RUNTIME.eventEmitterPrototype,
      name,
    )?.value === method);
    const frameMethodsIntact = Object.entries(
      TRUSTED_PLAYWRIGHT_RUNTIME.frameMethods,
    ).every(([name, method]) => Object.getOwnPropertyDescriptor(
      TRUSTED_PLAYWRIGHT_RUNTIME.framePrototype,
      name,
    )?.value === method);
    const pageMethodsIntact = Object.entries(
      TRUSTED_PLAYWRIGHT_RUNTIME.pageMethods,
    ).every(([name, method]) => Object.getOwnPropertyDescriptor(
      TRUSTED_PLAYWRIGHT_RUNTIME.pagePrototype,
      name,
    )?.value === method);
    const browserContextMethodsIntact = Object.entries(
      TRUSTED_PLAYWRIGHT_RUNTIME.browserContextMethods,
    ).every(([name, method]) => Object.getOwnPropertyDescriptor(
      TRUSTED_PLAYWRIGHT_RUNTIME.browserContextPrototype,
      name,
    )?.value === method);
    const cdpSessionMethodsIntact = Object.entries(
      TRUSTED_PLAYWRIGHT_RUNTIME.cdpSessionMethods,
    ).every(([name, method]) => Object.getOwnPropertyDescriptor(
      TRUSTED_PLAYWRIGHT_RUNTIME.cdpSessionPrototype,
      name,
    )?.value === method);
    if (connectionPrototype !== TRUSTED_PLAYWRIGHT_RUNTIME.connectionPrototype
      || Object.getPrototypeOf(TRUSTED_PLAYWRIGHT_RUNTIME.framePrototype)
        !== TRUSTED_PLAYWRIGHT_RUNTIME.channelOwnerPrototype
      || Object.getPrototypeOf(TRUSTED_PLAYWRIGHT_RUNTIME.pagePrototype)
        !== TRUSTED_PLAYWRIGHT_RUNTIME.channelOwnerPrototype
      || Object.getPrototypeOf(TRUSTED_PLAYWRIGHT_RUNTIME.browserContextPrototype)
        !== TRUSTED_PLAYWRIGHT_RUNTIME.channelOwnerPrototype
      || Object.getPrototypeOf(TRUSTED_PLAYWRIGHT_RUNTIME.cdpSessionPrototype)
        !== TRUSTED_PLAYWRIGHT_RUNTIME.channelOwnerPrototype
      || Object.getPrototypeOf(TRUSTED_PLAYWRIGHT_RUNTIME.channelOwnerPrototype)
        !== TRUSTED_PLAYWRIGHT_RUNTIME.eventEmitterPrototype
      || directDataProperty(
        connection,
        '_objectFactories',
        'Pinned Playwright object factories',
      ) !== TRUSTED_PLAYWRIGHT_RUNTIME.factories
      || MAP_GET.call(TRUSTED_PLAYWRIGHT_RUNTIME.factories, 'Frame') !== frameFactory
      || MAP_GET.call(TRUSTED_PLAYWRIGHT_RUNTIME.factories, 'Page') !== pageFactory
      || MAP_GET.call(TRUSTED_PLAYWRIGHT_RUNTIME.factories, 'BrowserContext')
        !== browserContextFactory
      || MAP_GET.call(TRUSTED_PLAYWRIGHT_RUNTIME.factories, 'CDPSession')
        !== cdpSessionFactory
      || sendDescriptor?.value !== TRUSTED_PLAYWRIGHT_RUNTIME.sendMessageToServer
      || rawBuffersDescriptor?.value !== TRUSTED_PLAYWRIGHT_RUNTIME.rawBuffers
      || Object.getOwnPropertyDescriptor(
        TRUSTED_PLAYWRIGHT_RUNTIME.channelPrototype,
        'evaluateExpression',
      ) !== undefined
      || !channelOwnerMethodsIntact
      || !eventEmitterMethodsIntact
      || !frameMethodsIntact
      || !browserContextMethodsIntact
      || !cdpSessionMethodsIntact
      || !pageMethodsIntact) {
      reject('Pinned Playwright runtime identities have drifted');
    }
  } catch {
    return reject('Pinned Playwright runtime identities have drifted');
  }
}

function installPlaywrightPageFactoryLease() {
  validatePinnedPlaywrightRuntime(
    TRUSTED_PLAYWRIGHT_RUNTIME.frameFactory,
    TRUSTED_PLAYWRIGHT_RUNTIME.pageFactory,
  );
  const lease = {
    active: true,
    browserContextChannels: new WeakMap(),
    browserContexts: new WeakSet(),
    browserContextWrapper: undefined,
    faulted: false,
    frameChannels: new WeakMap(),
    frames: new WeakSet(),
    frameWrapper: undefined,
    observedPages: [],
    pageFrames: new WeakMap(),
    pageRuntimeBoundaries: new WeakMap(),
    pages: new WeakSet(),
    pageWrapper: undefined,
  };
  lease.browserContextWrapper = function reviewedBrowserContextFactory(...parameters) {
    const context = Reflect.apply(
      TRUSTED_PLAYWRIGHT_RUNTIME.browserContextFactory,
      this,
      parameters,
    );
    try {
      if (lease.active !== true
        || context === null || typeof context !== 'object'
        || Object.getPrototypeOf(context)
          !== TRUSTED_PLAYWRIGHT_RUNTIME.browserContextPrototype
        || context.constructor !== TRUSTED_PLAYWRIGHT_RUNTIME.browserContextConstructor
        || directDataProperty(
          context,
          '_connection',
          'Pinned Playwright browser context connection',
        ) !== TRUSTED_PLAYWRIGHT_RUNTIME.connection) {
        reject('Pinned Playwright browser context factory returned an invalid identity');
      }
      const channel = directDataProperty(
        context,
        '_channel',
        'Pinned Playwright browser context channel',
      );
      if (channel === null || typeof channel !== 'object'
        || Object.getPrototypeOf(channel) !== TRUSTED_PLAYWRIGHT_RUNTIME.channelPrototype
        || directDataProperty(
          channel,
          '_object',
          'Pinned Playwright browser context channel owner',
        ) !== context) {
        reject('Pinned Playwright browser context factory returned an invalid channel');
      }
      WEAK_SET_ADD.call(lease.browserContexts, context);
      WEAK_MAP_SET.call(lease.browserContextChannels, context, channel);
    } catch {
      lease.faulted = true;
    }
    return context;
  };
  lease.frameWrapper = function reviewedFrameFactory(...parameters) {
    const frame = Reflect.apply(
      TRUSTED_PLAYWRIGHT_RUNTIME.frameFactory,
      this,
      parameters,
    );
    try {
      if (lease.active !== true
        || frame === null || typeof frame !== 'object'
        || Object.getPrototypeOf(frame) !== TRUSTED_PLAYWRIGHT_RUNTIME.framePrototype) {
        reject('Pinned Playwright frame factory returned an invalid identity');
      }
      const channel = directDataProperty(
        frame,
        '_channel',
        'Pinned Playwright frame channel',
      );
      if (channel === null || typeof channel !== 'object'
        || Object.getPrototypeOf(channel) !== TRUSTED_PLAYWRIGHT_RUNTIME.channelPrototype) {
        reject('Pinned Playwright frame factory returned an invalid channel');
      }
      WEAK_SET_ADD.call(lease.frames, frame);
      WEAK_MAP_SET.call(lease.frameChannels, frame, channel);
    } catch {
      lease.faulted = true;
    }
    return frame;
  };
  lease.pageWrapper = function reviewedPageFactory(...parameters) {
    const page = Reflect.apply(
      TRUSTED_PLAYWRIGHT_RUNTIME.pageFactory,
      this,
      parameters,
    );
    let recorded = false;
    try {
      if (lease.active !== true
        || page === null || typeof page !== 'object'
        || Object.getPrototypeOf(page) !== TRUSTED_PLAYWRIGHT_RUNTIME.pagePrototype
        || page.constructor !== TRUSTED_PLAYWRIGHT_RUNTIME.pageConstructor) {
        reject('Pinned Playwright page factory returned an invalid identity');
      }
      const frame = directDataProperty(
        page,
        '_mainFrame',
        'Pinned Playwright page main frame',
      );
      const context = directDataProperty(
        page,
        '_browserContext',
        'Pinned Playwright page browser context',
      );
      const channel = directDataProperty(
        page,
        '_channel',
        'Pinned Playwright page channel',
      );
      const contextChannel = directDataProperty(
        context,
        '_channel',
        'Pinned Playwright browser context channel',
      );
      const channelDescriptor = Object.getOwnPropertyDescriptor(page, '_channel');
      const channelObjectDescriptor = Object.getOwnPropertyDescriptor(channel, '_object');
      const channelCloseDescriptor = Object.getOwnPropertyDescriptor(channel, 'close');
      const channelClose = channel.close;
      const contextChannelObjectDescriptor = Object.getOwnPropertyDescriptor(
        contextChannel,
        '_object',
      );
      const connection = directDataProperty(
        page,
        '_connection',
        'Pinned Playwright page connection',
      );
      const pageGuid = directDataProperty(page, '_guid', 'Pinned Playwright page guid');
      const frameGuid = directDataProperty(frame, '_guid', 'Pinned Playwright frame guid');
      const connectionObjects = directDataProperty(
        connection,
        '_objects',
        'Pinned Playwright connection objects',
      );
      if (Object.getPrototypeOf(frame) !== TRUSTED_PLAYWRIGHT_RUNTIME.framePrototype
        || frame.constructor !== TRUSTED_PLAYWRIGHT_RUNTIME.frameConstructor
        || Object.getPrototypeOf(context)
          !== TRUSTED_PLAYWRIGHT_RUNTIME.browserContextPrototype
        || context.constructor !== TRUSTED_PLAYWRIGHT_RUNTIME.browserContextConstructor
        || Object.getPrototypeOf(channel) !== TRUSTED_PLAYWRIGHT_RUNTIME.channelPrototype
        || Object.getPrototypeOf(contextChannel)
          !== TRUSTED_PLAYWRIGHT_RUNTIME.channelPrototype
        || directDataProperty(
          frame,
          '_connection',
          'Pinned Playwright frame connection',
        ) !== connection
        || directDataProperty(
          context,
          '_connection',
          'Pinned Playwright browser context connection',
        ) !== connection
        || connection !== TRUSTED_PLAYWRIGHT_RUNTIME.connection
        || typeof pageGuid !== 'string'
        || pageGuid === ''
        || typeof frameGuid !== 'string'
        || frameGuid === ''
        || MAP_GET.call(connectionObjects, pageGuid) !== page
        || MAP_GET.call(connectionObjects, frameGuid) !== frame
        || channelDescriptor === undefined
        || !Object.hasOwn(channelDescriptor, 'value')
        || channelDescriptor.value !== channel
        || channelObjectDescriptor === undefined
        || !Object.hasOwn(channelObjectDescriptor, 'value')
        || channelObjectDescriptor.value !== page
        || contextChannelObjectDescriptor === undefined
        || !Object.hasOwn(contextChannelObjectDescriptor, 'value')
        || contextChannelObjectDescriptor.value !== context
        || channelCloseDescriptor !== undefined
        || typeof channelClose !== 'function') {
        reject('Pinned Playwright page factory returned an invalid channel');
      }
      const runtimeBoundary = Object.freeze({
        channel,
        channelClose,
        channelDescriptor,
        channelObjectDescriptor,
        connection,
        context,
        contextChannel,
        frame,
        frameGuid,
        pageGuid,
      });
      lease.observedPages.push(Object.freeze({ boundary: runtimeBoundary, page }));
      recorded = true;
      if (!WEAK_SET_HAS.call(lease.frames, frame)
        || WEAK_MAP_GET.call(lease.frameChannels, frame)
          !== directDataProperty(frame, '_channel', 'Pinned Playwright frame channel')) {
        reject('Pinned Playwright page factory returned an unobserved frame');
      }
      if (!WEAK_SET_HAS.call(lease.browserContexts, context)
        || WEAK_MAP_GET.call(lease.browserContextChannels, context) !== contextChannel) {
        reject('Pinned Playwright page factory returned an unobserved browser context');
      }
      WEAK_SET_ADD.call(lease.pages, page);
      WEAK_MAP_SET.call(lease.pageFrames, page, frame);
      WEAK_MAP_SET.call(lease.pageRuntimeBoundaries, page, runtimeBoundary);
    } catch {
      lease.faulted = true;
      if (!recorded && page !== null && typeof page === 'object') {
        lease.observedPages.push(Object.freeze({ boundary: undefined, page }));
      }
    }
    return page;
  };
  let frameInstalled = false;
  let browserContextInstalled = false;
  try {
    MAP_SET.call(
      TRUSTED_PLAYWRIGHT_RUNTIME.factories,
      'BrowserContext',
      lease.browserContextWrapper,
    );
    browserContextInstalled = true;
    MAP_SET.call(
      TRUSTED_PLAYWRIGHT_RUNTIME.factories,
      'Frame',
      lease.frameWrapper,
    );
    frameInstalled = true;
    MAP_SET.call(
      TRUSTED_PLAYWRIGHT_RUNTIME.factories,
      'Page',
      lease.pageWrapper,
    );
    validatePinnedPlaywrightRuntime(
      lease.frameWrapper,
      lease.pageWrapper,
      lease.browserContextWrapper,
    );
    return lease;
  } catch {
    try {
      if (frameInstalled) {
        MAP_SET.call(
          TRUSTED_PLAYWRIGHT_RUNTIME.factories,
          'Frame',
          TRUSTED_PLAYWRIGHT_RUNTIME.frameFactory,
        );
      }
      if (browserContextInstalled) {
        MAP_SET.call(
          TRUSTED_PLAYWRIGHT_RUNTIME.factories,
          'BrowserContext',
          TRUSTED_PLAYWRIGHT_RUNTIME.browserContextFactory,
        );
      }
      MAP_SET.call(
        TRUSTED_PLAYWRIGHT_RUNTIME.factories,
        'Page',
        TRUSTED_PLAYWRIGHT_RUNTIME.pageFactory,
      );
    } catch {}
    return reject('Pinned Playwright page factory lease could not be installed');
  }
}

function releasePlaywrightPageFactoryLease(lease) {
  let intact = false;
  try {
    intact = lease.active === true
      && MAP_GET.call(TRUSTED_PLAYWRIGHT_RUNTIME.factories, 'BrowserContext')
        === lease.browserContextWrapper
      && MAP_GET.call(TRUSTED_PLAYWRIGHT_RUNTIME.factories, 'Frame') === lease.frameWrapper
      && MAP_GET.call(TRUSTED_PLAYWRIGHT_RUNTIME.factories, 'Page') === lease.pageWrapper;
    MAP_SET.call(
      TRUSTED_PLAYWRIGHT_RUNTIME.factories,
      'BrowserContext',
      TRUSTED_PLAYWRIGHT_RUNTIME.browserContextFactory,
    );
    MAP_SET.call(
      TRUSTED_PLAYWRIGHT_RUNTIME.factories,
      'Frame',
      TRUSTED_PLAYWRIGHT_RUNTIME.frameFactory,
    );
    MAP_SET.call(
      TRUSTED_PLAYWRIGHT_RUNTIME.factories,
      'Page',
      TRUSTED_PLAYWRIGHT_RUNTIME.pageFactory,
    );
    lease.active = false;
    validatePinnedPlaywrightRuntime(
      TRUSTED_PLAYWRIGHT_RUNTIME.frameFactory,
      TRUSTED_PLAYWRIGHT_RUNTIME.pageFactory,
    );
    return intact;
  } catch {
    return false;
  }
}

function validateNoPlaywrightNetworkObservers(page, context, connection, ownedCdpSessions) {
  try {
    const pageRoutes = directDataProperty(page, '_routes', 'Chromium page routes');
    const pageWebSocketRoutes = directDataProperty(
      page,
      '_webSocketRoutes',
      'Chromium page WebSocket routes',
    );
    const pageHarRouters = directDataProperty(page, '_harRouters', 'Chromium page HAR routers');
    const contextRoutes = directDataProperty(context, '_routes', 'Chromium context routes');
    const contextWebSocketRoutes = directDataProperty(
      context,
      '_webSocketRoutes',
      'Chromium context WebSocket routes',
    );
    const contextHarRouters = directDataProperty(
      context,
      '_harRouters',
      'Chromium context HAR routers',
    );
    if (!Array.isArray(pageRoutes) || pageRoutes.length !== 0
      || !Array.isArray(pageWebSocketRoutes) || pageWebSocketRoutes.length !== 0
      || !Array.isArray(pageHarRouters) || pageHarRouters.length !== 0
      || !Array.isArray(contextRoutes) || contextRoutes.length !== 0
      || !Array.isArray(contextWebSocketRoutes) || contextWebSocketRoutes.length !== 0
      || !Array.isArray(contextHarRouters) || contextHarRouters.length !== 0
      || NETWORK_OBSERVER_EVENTS.some((event) => (
        Reflect.apply(
          TRUSTED_PLAYWRIGHT_RUNTIME.eventEmitterMethods.listenerCount,
          page,
          [event],
        ) !== 0
        || Reflect.apply(
          TRUSTED_PLAYWRIGHT_RUNTIME.eventEmitterMethods.listenerCount,
          context,
          [event],
        ) !== 0
      ))) {
      reject('Chromium Playwright network observer boundary is active');
    }
    const connectionObjects = directDataProperty(
      connection,
      '_objects',
      'Chromium Playwright connection objects',
    );
    for (const object of MAP_VALUES.call(connectionObjects)) {
      const type = directDataProperty(
        object,
        '_type',
        'Chromium Playwright connection object type',
        true,
      );
      if (type === 'CDPSession' && !SET_HAS.call(ownedCdpSessions, object)) {
        reject('Chromium Playwright unowned CDP observer is active');
      }
    }
  } catch {
    return reject('Chromium Playwright network observer boundary is invalid or active');
  }
}

function inspectPlaywrightCaptureBoundary(
  page,
  trustedRuntime,
  ownedCdpSessions = new Set(),
) {
  try {
    const context = trustedRuntime
      ? Reflect.apply(TRUSTED_PLAYWRIGHT_RUNTIME.pageMethods.context, page, [])
      : page.context();
    if (context === null || typeof context !== 'object') {
      reject('Chromium Playwright context boundary is invalid');
    }
    const options = directDataProperty(
      context,
      '_options',
      'Chromium Playwright context options',
    );
    const tracing = directDataProperty(
      context,
      'tracing',
      'Chromium Playwright tracing boundary',
    );
    const connection = directDataProperty(
      context,
      '_connection',
      'Chromium Playwright connection boundary',
    );
    const logger = directDataProperty(
      context,
      '_logger',
      'Chromium Playwright logger boundary',
    );
    if (!plainObject(options)
      || tracing === null || typeof tracing !== 'object'
      || connection === null || typeof connection !== 'object'
      || logger !== undefined
      || (trustedRuntime && options.serviceWorkers !== 'block')
      || directDataProperty(
        tracing,
        '_isTracing',
        'Chromium Playwright tracing state',
      ) !== false
      || directDataProperty(
        connection,
        '_tracingCount',
        'Chromium Playwright connection tracing state',
      ) !== 0) {
      reject('Chromium Playwright capture boundary is active');
    }
    if (trustedRuntime) {
      validateNoPlaywrightNetworkObservers(page, context, connection, ownedCdpSessions);
    }
    const harRecorders = directDataProperty(
      tracing,
      '_harRecorders',
      'Chromium Playwright HAR boundary',
    );
    if (MAP_SIZE_GETTER.call(harRecorders) !== 0
      || directDataProperty(
        tracing,
        '_harId',
        'Chromium Playwright active HAR identifier',
        true,
      ) !== undefined
      || directDataProperty(
        options,
        'recordVideo',
        'Chromium Playwright video option',
        true,
      ) !== undefined
      || (trustedRuntime
        ? Reflect.apply(TRUSTED_PLAYWRIGHT_RUNTIME.pageMethods.video, page, [])
        : page.video()) !== null) {
      reject('Chromium Playwright capture boundary is active');
    }
    return { connection, context, options, page, tracing };
  } catch {
    return reject('Chromium Playwright capture boundary is invalid or active');
  }
}

function validateNoPendingPlaywrightCapture(connection) {
  try {
    const callbacks = directDataProperty(
      connection,
      '_callbacks',
      'Chromium Playwright pending operation boundary',
    );
    for (const callback of MAP_VALUES.call(callbacks)) {
      if (callback === null || typeof callback !== 'object') {
        reject('Chromium Playwright pending operation boundary is invalid');
      }
      const type = directDataProperty(
        callback,
        'type',
        'Chromium Playwright pending operation type',
      );
      const method = directDataProperty(
        callback,
        'method',
        'Chromium Playwright pending operation method',
      );
      if (typeof type !== 'string' || typeof method !== 'string') {
        reject('Chromium Playwright pending operation boundary is invalid');
      }
      if (type === 'Tracing'
        || SET_HAS.call(SENSITIVE_PENDING_PROTOCOL_METHODS, `${type}.${method}`)) {
        reject('Chromium Playwright sensitive transition is pending');
      }
    }
  } catch {
    return reject('Chromium Playwright capture transition is invalid or pending');
  }
}

function installPlaywrightNetworkObserverLease(owner, captureLease) {
  let descriptor;
  let events;
  try {
    descriptor = Object.getOwnPropertyDescriptor(owner, '_events');
    events = descriptor?.value;
    if (descriptor === undefined
      || !Object.hasOwn(descriptor, 'value')
      || descriptor.configurable !== true
      || events === null
      || typeof events !== 'object'
      || NETWORK_OBSERVER_EVENTS.some((event) => Reflect.apply(
        TRUSTED_PLAYWRIGHT_RUNTIME.eventEmitterMethods.listenerCount,
        owner,
        [event],
      ) !== 0)) {
      reject('Chromium Playwright network event boundary is invalid or active');
    }
  } catch {
    return reject('Chromium Playwright network event boundary is invalid or active');
  }
  const target = Object.create(
    Object.getPrototypeOf(events),
    Object.getOwnPropertyDescriptors(events),
  );
  const denied = new Set(NETWORK_OBSERVER_EVENTS);
  const proxy = new Proxy(target, {
    defineProperty(object, property, valueDescriptor) {
      if (SET_HAS.call(denied, property)) {
        captureLease.captureAttempted = true;
        reject('Chromium Playwright network listener transition was blocked');
      }
      return Reflect.defineProperty(object, property, valueDescriptor);
    },
    deleteProperty(object, property) {
      if (SET_HAS.call(denied, property)) {
        captureLease.captureAttempted = true;
        reject('Chromium Playwright network listener transition was blocked');
      }
      return Reflect.deleteProperty(object, property);
    },
    set(object, property, value) {
      if (SET_HAS.call(denied, property)) {
        captureLease.captureAttempted = true;
        reject('Chromium Playwright network listener transition was blocked');
      }
      return Reflect.set(object, property, value, object);
    },
  });
  try {
    Object.defineProperty(owner, '_events', {
      configurable: true,
      enumerable: descriptor.enumerable,
      value: proxy,
      writable: false,
    });
  } catch {
    return reject('Chromium Playwright network event lease could not be installed');
  }
  return { descriptor, owner, proxy, target };
}

function validatePlaywrightNetworkObserverLease(lease) {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(lease.owner, '_events');
    if (descriptor?.value !== lease.proxy
      || descriptor.configurable !== true
      || descriptor.enumerable !== lease.descriptor.enumerable
      || descriptor.writable !== false
      || NETWORK_OBSERVER_EVENTS.some((event) => Reflect.apply(
        TRUSTED_PLAYWRIGHT_RUNTIME.eventEmitterMethods.listenerCount,
        lease.owner,
        [event],
      ) !== 0)) {
      reject('Chromium Playwright network event lease has drifted');
    }
  } catch {
    return reject('Chromium Playwright network event lease has drifted');
  }
}

function releasePlaywrightNetworkObserverLease(lease) {
  let intact = true;
  try {
    validatePlaywrightNetworkObserverLease(lease);
  } catch {
    intact = false;
  }
  try {
    Object.defineProperty(lease.owner, '_events', {
      ...lease.descriptor,
      value: lease.target,
    });
    return intact;
  } catch {
    return false;
  }
}

function installPlaywrightCaptureLease(boundary, trustedRuntime) {
  const { connection, tracing } = boundary;
  let originalDescriptor;
  let originalOwner = connection;
  let onmessageOwnDescriptor;
  let rawBuffersOwnDescriptor;
  try {
    originalDescriptor = Object.getOwnPropertyDescriptor(
      connection,
      'sendMessageToServer',
    );
    if (originalDescriptor === undefined) {
      originalOwner = Object.getPrototypeOf(connection);
      originalDescriptor = Object.getOwnPropertyDescriptor(
        originalOwner,
        'sendMessageToServer',
      );
    }
    rawBuffersOwnDescriptor = Object.getOwnPropertyDescriptor(
      connection,
      'rawBuffers',
    );
    onmessageOwnDescriptor = Object.getOwnPropertyDescriptor(
      connection,
      'onmessage',
    );
  } catch {
    return reject('Chromium Playwright capture lease boundary is invalid');
  }
  if (originalDescriptor === undefined
    || !Object.hasOwn(originalDescriptor, 'value')
    || typeof originalDescriptor.value !== 'function'
    || (trustedRuntime
      && (connection !== TRUSTED_PLAYWRIGHT_RUNTIME.connection
        || originalOwner !== TRUSTED_PLAYWRIGHT_RUNTIME.connectionPrototype
        || originalDescriptor.value !== TRUSTED_PLAYWRIGHT_RUNTIME.sendMessageToServer
        || rawBuffersOwnDescriptor !== undefined
        || !isDeepStrictEqual(
          onmessageOwnDescriptor,
          TRUSTED_PLAYWRIGHT_RUNTIME.onmessageDescriptor,
        )))) {
    reject('Chromium Playwright capture lease boundary is invalid');
  }
  const originalOwnDescriptor = originalOwner === connection
    ? originalDescriptor
    : undefined;
  const lease = {
    active: true,
    captureAttempted: false,
    cdpCreationCapability: undefined,
    cdpFactoryLease: undefined,
    cdpLeases: new Map(),
    connection,
    originalOwnDescriptor,
    originalSend: originalDescriptor.value,
    onmessageOwnDescriptor,
    ownedCdpSessions: new Set(),
    networkObserverLeases: new Map(),
    pageFrames: new Map(),
    rawBuffersOwnDescriptor,
    tracingObjects: new Set([tracing]),
    trustedRuntime,
    wrapper: undefined,
  };
  lease.wrapper = function guardedPlaywrightSend(object, method, parameters, options) {
    if (lease.active && SET_HAS.call(lease.tracingObjects, object)) {
      lease.captureAttempted = true;
      reject('Chromium Playwright capture transition was blocked');
    }
    if (lease.active) {
      const type = directDataProperty(
        object,
        '_type',
        'Chromium Playwright protocol owner type',
        true,
      );
      const patterns = parameters?.patterns;
      const createsCdp = (type === 'BrowserContext' && method === 'newCDPSession')
        || (type === 'Browser' && method === 'newBrowserCDPSession');
      const capability = lease.cdpCreationCapability;
      if (createsCdp
        && !(type === 'BrowserContext'
          && method === 'newCDPSession'
          && capability?.active === true
          && capability.context === object
          && capability.used === false)) {
        lease.captureAttempted = true;
        reject('Chromium Playwright unowned CDP transition was blocked');
      }
      if (createsCdp && capability !== undefined) capability.used = true;
      if ((type === 'Page' || type === 'BrowserContext')
        && ((method === 'updateSubscription'
          && parameters?.enabled === true
          && SET_HAS.call(
            NETWORK_SUBSCRIPTION_PROTOCOL_EVENTS,
            parameters?.event,
          ))
          || ((method === 'setNetworkInterceptionPatterns'
              || method === 'setWebSocketInterceptionPatterns')
            && Array.isArray(patterns)
            && patterns.length !== 0))) {
        lease.captureAttempted = true;
        reject('Chromium Playwright network observer transition was blocked');
      }
    }
    return Reflect.apply(
      lease.originalSend,
      this,
      [object, method, parameters, options],
    );
  };
  let onmessageInstalled = false;
  let rawBuffersInstalled = false;
  try {
    if (trustedRuntime) {
      Object.defineProperty(connection, 'onmessage', {
        configurable: true,
        enumerable: onmessageOwnDescriptor.enumerable,
        value: TRUSTED_PLAYWRIGHT_RUNTIME.onmessage,
        writable: false,
      });
      onmessageInstalled = true;
      Object.defineProperty(connection, 'rawBuffers', {
        configurable: true,
        enumerable: false,
        value: TRUSTED_PLAYWRIGHT_RUNTIME.rawBuffers,
        writable: false,
      });
      rawBuffersInstalled = true;
    }
    Object.defineProperty(connection, 'sendMessageToServer', {
      configurable: true,
      enumerable: false,
      value: lease.wrapper,
      writable: false,
    });
  } catch {
    try {
      if (rawBuffersInstalled) Reflect.deleteProperty(connection, 'rawBuffers');
      if (onmessageInstalled) {
        Object.defineProperty(connection, 'onmessage', onmessageOwnDescriptor);
      }
    } catch {}
    return reject('Chromium Playwright capture lease could not be installed');
  }
  return lease;
}

function inspectTrustedPlaywrightPageBoundary(
  page,
  boundary,
  creationLease,
  installedLease,
) {
  try {
    validatePinnedPlaywrightRuntime(
      TRUSTED_PLAYWRIGHT_RUNTIME.frameFactory,
      TRUSTED_PLAYWRIGHT_RUNTIME.pageFactory,
    );
    const frame = directDataProperty(
      page,
      '_mainFrame',
      'Chromium Playwright main-frame boundary',
    );
    const channel = directDataProperty(
      frame,
      '_channel',
      'Chromium Playwright frame channel',
    );
    const pageChannel = directDataProperty(
      page,
      '_channel',
      'Chromium Playwright page channel',
    );
    const creationBoundary = WEAK_MAP_GET.call(
      creationLease?.pageRuntimeBoundaries,
      page,
    );
    const contextChannel = directDataProperty(
      boundary.context,
      '_channel',
      'Chromium Playwright browser context channel',
    );
    const pageInitializer = directDataProperty(
      page,
      '_initializer',
      'Chromium Playwright page initializer',
    );
    const pageObjects = directDataProperty(
      page,
      '_objects',
      'Chromium Playwright page objects',
    );
    const pageFrames = directDataProperty(
      page,
      '_frames',
      'Chromium Playwright page frames',
    );
    const connectionObjects = directDataProperty(
      boundary.connection,
      '_objects',
      'Chromium Playwright connection objects',
    );
    const pageGuid = directDataProperty(page, '_guid', 'Chromium Playwright page guid');
    const frameGuid = directDataProperty(frame, '_guid', 'Chromium Playwright frame guid');
    const evaluateDescriptor = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(frame),
      'evaluate',
    );
    const channelDescriptor = Object.getOwnPropertyDescriptor(frame, '_channel');
    const channelObjectDescriptor = Object.getOwnPropertyDescriptor(channel, '_object');
    const pageChannelDescriptor = Object.getOwnPropertyDescriptor(page, '_channel');
    const pageChannelObjectDescriptor = Object.getOwnPropertyDescriptor(
      pageChannel,
      '_object',
    );
    const contextChannelDescriptor = Object.getOwnPropertyDescriptor(
      boundary.context,
      '_channel',
    );
    const contextChannelObjectDescriptor = Object.getOwnPropertyDescriptor(
      contextChannel,
      '_object',
    );
    const contextChannelNewCdpDescriptor = Object.getOwnPropertyDescriptor(
      contextChannel,
      'newCDPSession',
    );
    const contextChannelNewCdpSession = contextChannelNewCdpDescriptor === undefined
      ? contextChannel.newCDPSession
      : contextChannelNewCdpDescriptor.value;
    const channelGotoDescriptor = Object.getOwnPropertyDescriptor(channel, 'goto');
    const channelGoto = channelGotoDescriptor === undefined
      ? channel.goto
      : channelGotoDescriptor.value;
    if (creationLease?.active !== false
      || !WEAK_SET_HAS.call(creationLease.pages, page)
      || WEAK_MAP_GET.call(creationLease.pageFrames, page) !== frame
      || creationBoundary?.frame !== frame
      || creationBoundary.channel !== pageChannel
      || creationBoundary.connection !== boundary.connection
      || creationBoundary.pageGuid !== pageGuid
      || creationBoundary.frameGuid !== frameGuid
      || creationBoundary.context !== boundary.context
      || creationBoundary.contextChannel !== contextChannel
      || !WEAK_SET_HAS.call(creationLease.browserContexts, boundary.context)
      || WEAK_MAP_GET.call(creationLease.browserContextChannels, boundary.context)
        !== contextChannel
      || !WEAK_SET_HAS.call(creationLease.frames, frame)
      || WEAK_MAP_GET.call(creationLease.frameChannels, frame) !== channel
      || boundary.connection !== TRUSTED_PLAYWRIGHT_RUNTIME.connection
      || Object.getPrototypeOf(page) !== TRUSTED_PLAYWRIGHT_RUNTIME.pagePrototype
      || Object.getPrototypeOf(frame) !== TRUSTED_PLAYWRIGHT_RUNTIME.framePrototype
      || Object.getPrototypeOf(channel) !== TRUSTED_PLAYWRIGHT_RUNTIME.channelPrototype
      || Object.getPrototypeOf(pageChannel) !== TRUSTED_PLAYWRIGHT_RUNTIME.channelPrototype
      || Object.getPrototypeOf(boundary.context)
        !== TRUSTED_PLAYWRIGHT_RUNTIME.browserContextPrototype
      || Object.getPrototypeOf(contextChannel) !== TRUSTED_PLAYWRIGHT_RUNTIME.channelPrototype
      || page.constructor !== TRUSTED_PLAYWRIGHT_RUNTIME.pageConstructor
      || frame.constructor !== TRUSTED_PLAYWRIGHT_RUNTIME.frameConstructor
      || boundary.context.constructor
        !== TRUSTED_PLAYWRIGHT_RUNTIME.browserContextConstructor
      || directDataProperty(
        boundary.context,
        '_connection',
        'Chromium Playwright browser context connection',
      ) !== boundary.connection
      || directDataProperty(
        boundary.context,
        '_type',
        'Chromium Playwright browser context type',
      ) !== 'BrowserContext'
      || directDataProperty(page, '_connection', 'Chromium Playwright page connection')
        !== boundary.connection
      || directDataProperty(page, '_type', 'Chromium Playwright page type') !== 'Page'
      || directDataProperty(page, '_logger', 'Chromium Playwright page logger') !== undefined
      || directDataProperty(
        page,
        '_ownedContext',
        'Chromium Playwright owned page context',
        true,
      ) !== undefined
      || directDataProperty(
        page,
        '_browserContext',
        'Chromium Playwright page context',
      ) !== boundary.context
      || directDataProperty(frame, '_page', 'Chromium Playwright frame owner') !== page
      || directDataProperty(frame, '_parent', 'Chromium Playwright frame parent') !== page
      || directDataProperty(
        frame,
        '_connection',
        'Chromium Playwright frame connection',
      ) !== boundary.connection
      || directDataProperty(frame, '_type', 'Chromium Playwright frame type') !== 'Frame'
      || directDataProperty(frame, '_logger', 'Chromium Playwright frame logger') !== undefined
      || directDataProperty(
        pageInitializer,
        'mainFrame',
        'Chromium Playwright initialized main-frame channel',
      ) !== channel
      || directDataProperty(
        channel,
        '_object',
        'Chromium Playwright channel owner',
      ) !== frame
      || directDataProperty(
        pageChannel,
        '_object',
        'Chromium Playwright page channel owner',
      ) !== page
      || typeof pageGuid !== 'string'
      || pageGuid === ''
      || typeof frameGuid !== 'string'
      || frameGuid === ''
      || MAP_GET.call(connectionObjects, pageGuid) !== page
      || MAP_GET.call(connectionObjects, frameGuid) !== frame
      || MAP_GET.call(pageObjects, frameGuid) !== frame
      || !SET_HAS.call(pageFrames, frame)
      || evaluateDescriptor?.value !== TRUSTED_PLAYWRIGHT_RUNTIME.frameMethods.evaluate
      || channelDescriptor === undefined
      || !Object.hasOwn(channelDescriptor, 'value')
      || channelDescriptor.value !== channel
      || channelObjectDescriptor === undefined
      || !Object.hasOwn(channelObjectDescriptor, 'value')
      || channelObjectDescriptor.value !== frame
      || pageChannelDescriptor === undefined
      || !Object.hasOwn(pageChannelDescriptor, 'value')
      || pageChannelDescriptor.value !== pageChannel
      || pageChannelObjectDescriptor === undefined
      || !Object.hasOwn(pageChannelObjectDescriptor, 'value')
      || pageChannelObjectDescriptor.value !== page
      || contextChannelDescriptor === undefined
      || !Object.hasOwn(contextChannelDescriptor, 'value')
      || contextChannelDescriptor.value !== contextChannel
      || contextChannelObjectDescriptor === undefined
      || !Object.hasOwn(contextChannelObjectDescriptor, 'value')
      || contextChannelObjectDescriptor.value !== boundary.context
      || (installedLease === undefined
        ? contextChannelNewCdpDescriptor !== undefined
        : contextChannelNewCdpDescriptor?.value
            !== installedLease.contextChannelNewCdpSession
          || contextChannelNewCdpDescriptor.writable !== false)
      || typeof contextChannelNewCdpSession !== 'function'
      || (installedLease === undefined
        ? channelGotoDescriptor !== undefined
        : channelGotoDescriptor?.value !== installedLease.channelGoto
          || channelGotoDescriptor.writable !== false)
      || typeof channelGoto !== 'function'
      || Object.getOwnPropertyDescriptor(page, 'close') !== undefined
      || Object.getOwnPropertyDescriptor(page, 'isClosed') !== undefined) {
      reject('Chromium Playwright trusted page boundary is invalid');
    }
    return {
      channel,
      channelDescriptor,
      channelGoto,
      channelGotoDescriptor,
      channelObjectDescriptor,
      context: boundary.context,
      contextChannel,
      contextChannelDescriptor,
      contextChannelNewCdpDescriptor,
      contextChannelNewCdpSession,
      contextChannelObjectDescriptor,
      evaluate: TRUSTED_PLAYWRIGHT_RUNTIME.frameMethods.evaluate,
      frame,
      pageChannel,
      pageChannelClose: creationBoundary.channelClose,
      pageChannelDescriptor,
      pageChannelObjectDescriptor,
    };
  } catch {
    return reject('Chromium Playwright trusted page boundary is invalid');
  }
}

function installPlaywrightInstrumentationLease(boundary, lease, creationLease) {
  const { connection, page } = boundary;
  let channel;
  let channelDescriptor;
  let channelEvaluateExpression;
  let channelEvaluateExpressionDescriptor;
  let channelGoto;
  let channelGotoDescriptor;
  let channelObjectDescriptor;
  let context;
  let contextChannel;
  let contextChannelDescriptor;
  let contextChannelNewCdpDescriptor;
  let contextChannelNewCdpSession;
  let contextChannelObjectDescriptor;
  let contextOwnerLease;
  let evaluateDescriptor;
  let frame;
  let frameNavigationTimeoutDescriptor;
  let frameOwnerLease;
  let instrumentationDescriptor;
  let pageChannel;
  let pageChannelClose;
  let pageChannelCloseDescriptor;
  let pageChannelDescriptor;
  let pageChannelObjectDescriptor;
  let pageOwnerLease;
  const installedNetworkObserverLeases = [];
  try {
    if (lease.trustedRuntime) {
      ({
        channel,
        channelDescriptor,
        channelGoto,
        channelGotoDescriptor,
        channelObjectDescriptor,
        context,
        contextChannel,
        contextChannelDescriptor,
        contextChannelNewCdpDescriptor,
        contextChannelNewCdpSession,
        contextChannelObjectDescriptor,
        evaluate: evaluateDescriptor,
        frame,
        pageChannel,
        pageChannelClose,
        pageChannelDescriptor,
        pageChannelObjectDescriptor,
      } = inspectTrustedPlaywrightPageBoundary(page, boundary, creationLease));
      channelEvaluateExpressionDescriptor = Object.getOwnPropertyDescriptor(
        channel,
        'evaluateExpression',
      );
      channelEvaluateExpression = channel.evaluateExpression;
      if (channelEvaluateExpressionDescriptor !== undefined
        || typeof channelEvaluateExpression !== 'function') {
        reject('Chromium Playwright frame protocol method is invalid');
      }
      frameNavigationTimeoutDescriptor = Object.getOwnPropertyDescriptor(
        frame,
        '_navigationTimeout',
      );
      if (frameNavigationTimeoutDescriptor !== undefined) {
        reject('Chromium Playwright frame navigation boundary is invalid');
      }
      pageChannelCloseDescriptor = Object.getOwnPropertyDescriptor(
        pageChannel,
        'close',
      );
      if (pageChannelCloseDescriptor !== undefined
        || typeof pageChannelClose !== 'function') {
        reject('Chromium Playwright page close method is invalid');
      }
    } else {
      frame = directDataProperty(
        page,
        '_mainFrame',
        'Chromium Playwright main-frame boundary',
      );
    }
    if (frame === null || typeof frame !== 'object'
      || directDataProperty(frame, '_page', 'Chromium Playwright frame owner') !== page
      || directDataProperty(
        frame,
        '_connection',
        'Chromium Playwright frame connection',
      ) !== connection
      || directDataProperty(frame, '_type', 'Chromium Playwright frame type') !== 'Frame'
      || directDataProperty(frame, '_logger', 'Chromium Playwright frame logger') !== undefined) {
      reject('Chromium Playwright main-frame boundary is invalid');
    }
    instrumentationDescriptor = Object.getOwnPropertyDescriptor(
      frame,
      '_instrumentation',
    );
    if (!lease.trustedRuntime) {
      const prototype = Object.getPrototypeOf(frame);
      evaluateDescriptor = Object.getOwnPropertyDescriptor(prototype, 'evaluate')?.value;
    }
  } catch {
    return reject('Chromium Playwright instrumentation boundary is invalid');
  }
  if (lease.pageFrames.has(page)
    || instrumentationDescriptor === undefined
    || !Object.hasOwn(instrumentationDescriptor, 'value')
    || instrumentationDescriptor.value === null
    || typeof instrumentationDescriptor.value !== 'object'
    || typeof evaluateDescriptor !== 'function') {
    reject('Chromium Playwright instrumentation boundary is invalid');
  }
  let channelInstalled = false;
  let channelEvaluateExpressionInstalled = false;
  let channelGotoInstalled = false;
  let channelObjectInstalled = false;
  let instrumentationInstalled = false;
  let contextChannelNewCdpInstalled = false;
  let frameNavigationTimeoutInstalled = false;
  let pageChannelCloseInstalled = false;
  let pageChannelInstalled = false;
  let pageChannelObjectInstalled = false;
  try {
    if (lease.trustedRuntime) {
      for (const owner of [context, page]) {
        if (!lease.networkObserverLeases.has(owner)) {
          const observerLease = installPlaywrightNetworkObserverLease(owner, lease);
          lease.networkObserverLeases.set(owner, observerLease);
          installedNetworkObserverLeases.push(observerLease);
        }
      }
      frameOwnerLease = installTrustedChannelOwnerLease(frame, connection, 'Frame');
      pageOwnerLease = installTrustedChannelOwnerLease(page, connection, 'Page');
      contextOwnerLease = installTrustedChannelOwnerLease(
        context,
        connection,
        'BrowserContext',
      );
      Object.defineProperty(context, '_channel', {
        configurable: true,
        enumerable: contextChannelDescriptor.enumerable,
        value: contextChannel,
        writable: false,
      });
      Object.defineProperty(contextChannel, '_object', {
        configurable: true,
        enumerable: contextChannelObjectDescriptor.enumerable,
        value: context,
        writable: false,
      });
      Object.defineProperty(contextChannel, 'newCDPSession', {
        configurable: true,
        enumerable: false,
        value: contextChannelNewCdpSession,
        writable: false,
      });
      contextChannelNewCdpInstalled = true;
      Object.defineProperty(frame, '_channel', {
        configurable: true,
        enumerable: channelDescriptor.enumerable,
        value: channel,
        writable: false,
      });
      channelInstalled = true;
      Object.defineProperty(channel, '_object', {
        configurable: true,
        enumerable: channelObjectDescriptor.enumerable,
        value: frame,
        writable: false,
      });
      channelObjectInstalled = true;
      Object.defineProperty(channel, 'evaluateExpression', {
        configurable: true,
        enumerable: false,
        value: channelEvaluateExpression,
        writable: false,
      });
      channelEvaluateExpressionInstalled = true;
      Object.defineProperty(channel, 'goto', {
        configurable: true,
        enumerable: false,
        value: channelGoto,
        writable: false,
      });
      channelGotoInstalled = true;
      Object.defineProperty(frame, '_navigationTimeout', {
        configurable: true,
        enumerable: false,
        value: TRUSTED_PLAYWRIGHT_RUNTIME.frameMethods._navigationTimeout,
        writable: false,
      });
      frameNavigationTimeoutInstalled = true;
      Object.defineProperty(page, '_channel', {
        configurable: true,
        enumerable: pageChannelDescriptor.enumerable,
        value: pageChannel,
        writable: false,
      });
      pageChannelInstalled = true;
      Object.defineProperty(pageChannel, '_object', {
        configurable: true,
        enumerable: pageChannelObjectDescriptor.enumerable,
        value: page,
        writable: false,
      });
      pageChannelObjectInstalled = true;
      Object.defineProperty(pageChannel, 'close', {
        configurable: true,
        enumerable: false,
        value: pageChannelClose,
        writable: false,
      });
      pageChannelCloseInstalled = true;
    } else {
      Object.defineProperty(frame, '_instrumentation', {
        configurable: true,
        enumerable: false,
        value: PRIVATE_PLAYWRIGHT_INSTRUMENTATION,
        writable: false,
      });
      instrumentationInstalled = true;
    }
  } catch {
    try {
      for (const observerLease of installedNetworkObserverLeases.reverse()) {
        releasePlaywrightNetworkObserverLease(observerLease);
        lease.networkObserverLeases.delete(observerLease.owner);
      }
      if (frameNavigationTimeoutInstalled) {
        Reflect.deleteProperty(frame, '_navigationTimeout');
      }
      if (channelGotoInstalled) Reflect.deleteProperty(channel, 'goto');
      if (pageChannelCloseInstalled) Reflect.deleteProperty(pageChannel, 'close');
      if (pageChannelObjectInstalled) {
        Object.defineProperty(pageChannel, '_object', pageChannelObjectDescriptor);
      }
      if (pageChannelInstalled) {
        Object.defineProperty(page, '_channel', pageChannelDescriptor);
      }
      if (channelEvaluateExpressionInstalled) {
        Reflect.deleteProperty(channel, 'evaluateExpression');
      }
      if (channelObjectInstalled) {
        Object.defineProperty(channel, '_object', channelObjectDescriptor);
      }
      if (channelInstalled) Object.defineProperty(frame, '_channel', channelDescriptor);
      if (contextChannelObjectDescriptor !== undefined) {
        Object.defineProperty(contextChannel, '_object', contextChannelObjectDescriptor);
      }
      if (contextChannelNewCdpInstalled) {
        Reflect.deleteProperty(contextChannel, 'newCDPSession');
      }
      if (contextChannelDescriptor !== undefined) {
        Object.defineProperty(context, '_channel', contextChannelDescriptor);
      }
      if (contextOwnerLease !== undefined) releaseTrustedChannelOwnerLease(contextOwnerLease);
      if (pageOwnerLease !== undefined) releaseTrustedChannelOwnerLease(pageOwnerLease);
      if (frameOwnerLease !== undefined) releaseTrustedChannelOwnerLease(frameOwnerLease);
      if (instrumentationInstalled) {
        Object.defineProperty(frame, '_instrumentation', instrumentationDescriptor);
      }
    } catch {}
    return reject('Chromium Playwright instrumentation lease could not be installed');
  }
  lease.pageFrames.set(page, {
    channel,
    channelDescriptor,
    channelEvaluateExpression,
    channelEvaluateExpressionDescriptor,
    channelGoto,
    channelGotoDescriptor,
    channelObjectDescriptor,
    creationLease,
    context,
    contextChannel,
    contextChannelDescriptor,
    contextChannelNewCdpDescriptor,
    contextChannelNewCdpSession,
    contextChannelObjectDescriptor,
    contextOwnerLease,
    evaluate: evaluateDescriptor,
    frame,
    frameNavigationTimeoutDescriptor,
    frameOwnerLease,
    instrumentationDescriptor,
    page,
    pageChannel,
    pageChannelClose,
    pageChannelCloseDescriptor,
    pageChannelDescriptor,
    pageChannelObjectDescriptor,
    pageOwnerLease,
  });
}

function validatePlaywrightInstrumentationLease(page, boundary, lease) {
  const protectedFrame = lease.pageFrames.get(page);
  let channelDescriptor;
  let channelEvaluateExpressionDescriptor;
  let channelGotoDescriptor;
  let channelObjectDescriptor;
  let contextChannelDescriptor;
  let contextChannelNewCdpDescriptor;
  let contextChannelObjectDescriptor;
  let currentFrame;
  let evaluateDescriptor;
  let frameNavigationTimeoutDescriptor;
  let instrumentationDescriptor;
  let pageChannelCloseDescriptor;
  let pageChannelDescriptor;
  let pageChannelObjectDescriptor;
  try {
    currentFrame = directDataProperty(
      page,
      '_mainFrame',
      'Chromium Playwright main-frame boundary',
    );
    instrumentationDescriptor = Object.getOwnPropertyDescriptor(
      protectedFrame?.frame,
      '_instrumentation',
    );
    evaluateDescriptor = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(protectedFrame?.frame),
      'evaluate',
    );
    frameNavigationTimeoutDescriptor = Object.getOwnPropertyDescriptor(
      protectedFrame?.frame,
      '_navigationTimeout',
    );
    if (lease.trustedRuntime) {
      const trusted = inspectTrustedPlaywrightPageBoundary(
        page,
        boundary,
        protectedFrame?.creationLease,
        protectedFrame,
      );
      if (trusted.frame !== protectedFrame?.frame
        || trusted.channel !== protectedFrame?.channel
        || trusted.pageChannel !== protectedFrame?.pageChannel
        || trusted.context !== protectedFrame?.context
        || trusted.contextChannel !== protectedFrame?.contextChannel
        || trusted.pageChannelClose !== protectedFrame?.pageChannelClose) {
        reject('Chromium Playwright trusted page boundary has drifted');
      }
      channelDescriptor = Object.getOwnPropertyDescriptor(
        protectedFrame.frame,
        '_channel',
      );
      channelObjectDescriptor = Object.getOwnPropertyDescriptor(
        protectedFrame.channel,
        '_object',
      );
      channelEvaluateExpressionDescriptor = Object.getOwnPropertyDescriptor(
        protectedFrame.channel,
        'evaluateExpression',
      );
      channelGotoDescriptor = Object.getOwnPropertyDescriptor(
        protectedFrame.channel,
        'goto',
      );
      pageChannelDescriptor = Object.getOwnPropertyDescriptor(page, '_channel');
      pageChannelObjectDescriptor = Object.getOwnPropertyDescriptor(
        protectedFrame.pageChannel,
        '_object',
      );
      pageChannelCloseDescriptor = Object.getOwnPropertyDescriptor(
        protectedFrame.pageChannel,
        'close',
      );
      contextChannelDescriptor = Object.getOwnPropertyDescriptor(
        protectedFrame.context,
        '_channel',
      );
      contextChannelObjectDescriptor = Object.getOwnPropertyDescriptor(
        protectedFrame.contextChannel,
        '_object',
      );
      contextChannelNewCdpDescriptor = Object.getOwnPropertyDescriptor(
        protectedFrame.contextChannel,
        'newCDPSession',
      );
    }
  } catch {
    return reject('Chromium Playwright instrumentation lease is invalid');
  }
  if (protectedFrame === undefined
    || currentFrame !== protectedFrame.frame
    || directDataProperty(
      protectedFrame.frame,
      '_page',
      'Chromium Playwright frame owner',
    ) !== page
    || directDataProperty(
      protectedFrame.frame,
      '_connection',
      'Chromium Playwright frame connection',
    ) !== boundary.connection
    || directDataProperty(
      protectedFrame.frame,
      '_logger',
      'Chromium Playwright frame logger',
    ) !== undefined
    || instrumentationDescriptor?.value !== PRIVATE_PLAYWRIGHT_INSTRUMENTATION
    || (!lease.trustedRuntime
      && (instrumentationDescriptor.configurable !== true
        || instrumentationDescriptor.enumerable !== false
        || instrumentationDescriptor.writable !== false))
    || evaluateDescriptor?.value !== protectedFrame.evaluate
    || (lease.trustedRuntime
      && (!trustedChannelOwnerLeaseIntact(protectedFrame.frameOwnerLease)
        || !trustedChannelOwnerLeaseIntact(protectedFrame.pageOwnerLease)
        || !trustedChannelOwnerLeaseIntact(protectedFrame.contextOwnerLease)
        || contextChannelDescriptor?.value !== protectedFrame.contextChannel
        || contextChannelDescriptor.configurable !== true
        || contextChannelDescriptor.writable !== false
        || contextChannelObjectDescriptor?.value !== protectedFrame.context
        || contextChannelObjectDescriptor.configurable !== true
        || contextChannelObjectDescriptor.writable !== false
        || contextChannelNewCdpDescriptor?.value
          !== protectedFrame.contextChannelNewCdpSession
        || contextChannelNewCdpDescriptor.configurable !== true
        || contextChannelNewCdpDescriptor.enumerable !== false
        || contextChannelNewCdpDescriptor.writable !== false
        || frameNavigationTimeoutDescriptor?.value
          !== TRUSTED_PLAYWRIGHT_RUNTIME.frameMethods._navigationTimeout
        || frameNavigationTimeoutDescriptor.configurable !== true
        || frameNavigationTimeoutDescriptor.enumerable !== false
        || frameNavigationTimeoutDescriptor.writable !== false
        || channelDescriptor?.value !== protectedFrame.channel
        || channelDescriptor.configurable !== true
        || channelDescriptor.writable !== false
        || channelEvaluateExpressionDescriptor?.value
          !== protectedFrame.channelEvaluateExpression
        || channelEvaluateExpressionDescriptor.configurable !== true
        || channelEvaluateExpressionDescriptor.enumerable !== false
        || channelEvaluateExpressionDescriptor.writable !== false
        || channelGotoDescriptor?.value !== protectedFrame.channelGoto
        || channelGotoDescriptor.configurable !== true
        || channelGotoDescriptor.enumerable !== false
        || channelGotoDescriptor.writable !== false
        || channelObjectDescriptor?.value !== protectedFrame.frame
        || channelObjectDescriptor.configurable !== true
        || channelObjectDescriptor.writable !== false
        || pageChannelDescriptor?.value !== protectedFrame.pageChannel
        || pageChannelDescriptor.configurable !== true
        || pageChannelDescriptor.writable !== false
        || pageChannelObjectDescriptor?.value !== page
        || pageChannelObjectDescriptor.configurable !== true
        || pageChannelObjectDescriptor.writable !== false
        || pageChannelCloseDescriptor?.value !== protectedFrame.pageChannelClose
        || pageChannelCloseDescriptor.configurable !== true
        || pageChannelCloseDescriptor.enumerable !== false
        || pageChannelCloseDescriptor.writable !== false))) {
    reject('Chromium Playwright instrumentation lease has drifted');
  }
  return protectedFrame;
}

function validatePlaywrightCaptureLease(lease, allowLatchedAttempt = false) {
  let descriptor;
  let onmessageDescriptor;
  let rawBuffersDescriptor;
  try {
    descriptor = Object.getOwnPropertyDescriptor(
      lease.connection,
      'sendMessageToServer',
    );
    rawBuffersDescriptor = Object.getOwnPropertyDescriptor(
      lease.connection,
      'rawBuffers',
    );
    onmessageDescriptor = Object.getOwnPropertyDescriptor(
      lease.connection,
      'onmessage',
    );
  } catch {
    return reject('Chromium Playwright capture lease boundary is invalid');
  }
  if (lease.active !== true
    || (!allowLatchedAttempt && lease.captureAttempted !== false)
    || descriptor?.value !== lease.wrapper
    || descriptor.configurable !== true
    || descriptor.enumerable !== false
    || descriptor.writable !== false) {
    reject('Chromium Playwright capture lease has drifted');
  }
  if (lease.trustedRuntime) {
    validatePinnedPlaywrightRuntime(
      TRUSTED_PLAYWRIGHT_RUNTIME.frameFactory,
      TRUSTED_PLAYWRIGHT_RUNTIME.pageFactory,
      TRUSTED_PLAYWRIGHT_RUNTIME.browserContextFactory,
      lease.cdpFactoryLease?.active === true
        ? lease.cdpFactoryLease.wrapper
        : TRUSTED_PLAYWRIGHT_RUNTIME.cdpSessionFactory,
    );
    if (lease.connection !== TRUSTED_PLAYWRIGHT_RUNTIME.connection
      || lease.originalOwnDescriptor !== undefined
      || lease.originalSend !== TRUSTED_PLAYWRIGHT_RUNTIME.sendMessageToServer
      || lease.rawBuffersOwnDescriptor !== undefined
      || !isDeepStrictEqual(
        lease.onmessageOwnDescriptor,
        TRUSTED_PLAYWRIGHT_RUNTIME.onmessageDescriptor,
      )
      || onmessageDescriptor?.value !== TRUSTED_PLAYWRIGHT_RUNTIME.onmessage
      || onmessageDescriptor.configurable !== true
      || onmessageDescriptor.enumerable
        !== TRUSTED_PLAYWRIGHT_RUNTIME.onmessageDescriptor.enumerable
      || onmessageDescriptor.writable !== false
      || rawBuffersDescriptor?.value !== TRUSTED_PLAYWRIGHT_RUNTIME.rawBuffers
      || rawBuffersDescriptor.configurable !== true
      || rawBuffersDescriptor.enumerable !== false
      || rawBuffersDescriptor.writable !== false) {
      reject('Chromium Playwright trusted capture lease has drifted');
    }
  }
  validateNoPendingPlaywrightCapture(lease.connection);
}

function validatePlaywrightCaptureBoundary(page, captureLeases) {
  let lease;
  for (const candidate of MAP_VALUES.call(captureLeases)) {
    if (candidate.pageFrames.has(page)) {
      if (lease !== undefined) reject('Chromium Playwright page has multiple capture leases');
      lease = candidate;
    }
  }
  if (lease === undefined) reject('Chromium Playwright capture lease is absent');
  const boundary = inspectPlaywrightCaptureBoundary(
    page,
    lease.trustedRuntime,
    lease.ownedCdpSessions,
  );
  if (boundary.connection !== lease.connection
    || !SET_HAS.call(lease.tracingObjects, boundary.tracing)) {
    reject('Chromium Playwright capture lease is absent');
  }
  validatePlaywrightCaptureLease(lease);
  validatePlaywrightInstrumentationLease(page, boundary, lease);
  for (const observerLease of MAP_VALUES.call(lease.networkObserverLeases)) {
    validatePlaywrightNetworkObserverLease(observerLease);
  }
  return boundary;
}

function acquirePlaywrightCaptureLease(
  page,
  captureLeases,
  trustedRuntime,
  creationLease,
) {
  const boundary = inspectPlaywrightCaptureBoundary(page, trustedRuntime);
  let lease = captureLeases.get(boundary.connection);
  if (lease === undefined) {
    if (trustedRuntime) {
      validatePinnedPlaywrightRuntime(
        TRUSTED_PLAYWRIGHT_RUNTIME.frameFactory,
        TRUSTED_PLAYWRIGHT_RUNTIME.pageFactory,
      );
    }
    validateNoPendingPlaywrightCapture(boundary.connection);
    lease = installPlaywrightCaptureLease(boundary, trustedRuntime);
    captureLeases.set(boundary.connection, lease);
  } else {
    if (lease.trustedRuntime !== trustedRuntime) {
      reject('Chromium Playwright capture lease mode has drifted');
    }
    SET_ADD.call(lease.tracingObjects, boundary.tracing);
  }
  installPlaywrightInstrumentationLease(boundary, lease, creationLease);
  validatePlaywrightCaptureBoundary(page, captureLeases);
}

function releasePlaywrightCaptureLease(lease) {
  try {
    if (lease.cdpFactoryLease !== undefined
      || lease.cdpCreationCapability !== undefined
      || MAP_SIZE_GETTER.call(lease.cdpLeases) !== 0) return false;
    const descriptor = Object.getOwnPropertyDescriptor(
      lease.connection,
      'sendMessageToServer',
    );
    if (descriptor?.value !== lease.wrapper) return false;
    if (lease.trustedRuntime) {
      const onmessageDescriptor = Object.getOwnPropertyDescriptor(
        lease.connection,
        'onmessage',
      );
      const rawBuffersDescriptor = Object.getOwnPropertyDescriptor(
        lease.connection,
        'rawBuffers',
      );
      if (onmessageDescriptor?.value !== TRUSTED_PLAYWRIGHT_RUNTIME.onmessage
        || onmessageDescriptor.writable !== false
        || rawBuffersDescriptor?.value !== TRUSTED_PLAYWRIGHT_RUNTIME.rawBuffers
        || rawBuffersDescriptor.writable !== false) return false;
    }
    for (const protectedFrame of lease.pageFrames.values()) {
      const instrumentationDescriptor = Object.getOwnPropertyDescriptor(
        protectedFrame.frame,
        '_instrumentation',
      );
      if (instrumentationDescriptor?.value !== PRIVATE_PLAYWRIGHT_INSTRUMENTATION) {
        return false;
      }
      if (lease.trustedRuntime) {
        const channelDescriptor = Object.getOwnPropertyDescriptor(
          protectedFrame.frame,
          '_channel',
        );
        const channelObjectDescriptor = Object.getOwnPropertyDescriptor(
          protectedFrame.channel,
          '_object',
        );
        const channelEvaluateExpressionDescriptor = Object.getOwnPropertyDescriptor(
          protectedFrame.channel,
          'evaluateExpression',
        );
        const channelGotoDescriptor = Object.getOwnPropertyDescriptor(
          protectedFrame.channel,
          'goto',
        );
        const contextChannelDescriptor = Object.getOwnPropertyDescriptor(
          protectedFrame.context,
          '_channel',
        );
        const contextChannelObjectDescriptor = Object.getOwnPropertyDescriptor(
          protectedFrame.contextChannel,
          '_object',
        );
        const contextChannelNewCdpDescriptor = Object.getOwnPropertyDescriptor(
          protectedFrame.contextChannel,
          'newCDPSession',
        );
        const frameNavigationTimeoutDescriptor = Object.getOwnPropertyDescriptor(
          protectedFrame.frame,
          '_navigationTimeout',
        );
        const pageChannelDescriptor = Object.getOwnPropertyDescriptor(
          protectedFrame.page,
          '_channel',
        );
        const pageChannelObjectDescriptor = Object.getOwnPropertyDescriptor(
          protectedFrame.pageChannel,
          '_object',
        );
        const pageChannelCloseDescriptor = Object.getOwnPropertyDescriptor(
          protectedFrame.pageChannel,
          'close',
        );
        if (!trustedChannelOwnerLeaseIntact(protectedFrame.frameOwnerLease)
          || !trustedChannelOwnerLeaseIntact(protectedFrame.pageOwnerLease)
          || !trustedChannelOwnerLeaseIntact(protectedFrame.contextOwnerLease)
          || contextChannelDescriptor?.value !== protectedFrame.contextChannel
          || contextChannelDescriptor.writable !== false
          || contextChannelObjectDescriptor?.value !== protectedFrame.context
          || contextChannelObjectDescriptor.writable !== false
          || contextChannelNewCdpDescriptor?.value
            !== protectedFrame.contextChannelNewCdpSession
          || contextChannelNewCdpDescriptor.writable !== false
          || frameNavigationTimeoutDescriptor?.value
            !== TRUSTED_PLAYWRIGHT_RUNTIME.frameMethods._navigationTimeout
          || frameNavigationTimeoutDescriptor.writable !== false
          || channelDescriptor?.value !== protectedFrame.channel
          || channelDescriptor.writable !== false
          || channelEvaluateExpressionDescriptor?.value
            !== protectedFrame.channelEvaluateExpression
          || channelEvaluateExpressionDescriptor.writable !== false
          || channelGotoDescriptor?.value !== protectedFrame.channelGoto
          || channelGotoDescriptor.writable !== false
          || channelObjectDescriptor?.value !== protectedFrame.frame
          || channelObjectDescriptor.writable !== false
          || pageChannelDescriptor?.value !== protectedFrame.pageChannel
          || pageChannelDescriptor.writable !== false
          || pageChannelObjectDescriptor?.value !== protectedFrame.page
          || pageChannelObjectDescriptor.writable !== false
          || pageChannelCloseDescriptor?.value !== protectedFrame.pageChannelClose
          || pageChannelCloseDescriptor.writable !== false) {
          return false;
        }
      }
    }
    for (const protectedFrame of lease.pageFrames.values()) {
      if (lease.trustedRuntime) {
        if (!Reflect.deleteProperty(
          protectedFrame.pageChannel,
          'close',
        )) return false;
        Object.defineProperty(
          protectedFrame.pageChannel,
          '_object',
          protectedFrame.pageChannelObjectDescriptor,
        );
        Object.defineProperty(
          protectedFrame.pageChannelObjectDescriptor.value,
          '_channel',
          protectedFrame.pageChannelDescriptor,
        );
        if (!Reflect.deleteProperty(
          protectedFrame.channel,
          'evaluateExpression',
        )) return false;
        if (!Reflect.deleteProperty(protectedFrame.channel, 'goto')) return false;
        if (!Reflect.deleteProperty(
          protectedFrame.frame,
          '_navigationTimeout',
        )) return false;
        Object.defineProperty(
          protectedFrame.channel,
          '_object',
          protectedFrame.channelObjectDescriptor,
        );
        Object.defineProperty(
          protectedFrame.frame,
          '_channel',
          protectedFrame.channelDescriptor,
        );
        Object.defineProperty(
          protectedFrame.contextChannel,
          '_object',
          protectedFrame.contextChannelObjectDescriptor,
        );
        if (!Reflect.deleteProperty(
          protectedFrame.contextChannel,
          'newCDPSession',
        )) return false;
        Object.defineProperty(
          protectedFrame.context,
          '_channel',
          protectedFrame.contextChannelDescriptor,
        );
        if (!releaseTrustedChannelOwnerLease(protectedFrame.contextOwnerLease)) return false;
        if (!releaseTrustedChannelOwnerLease(protectedFrame.pageOwnerLease)) return false;
        if (!releaseTrustedChannelOwnerLease(protectedFrame.frameOwnerLease)) return false;
      } else {
        Object.defineProperty(
          protectedFrame.frame,
          '_instrumentation',
          protectedFrame.instrumentationDescriptor,
        );
      }
    }
    for (const observerLease of MAP_VALUES.call(lease.networkObserverLeases)) {
      if (!releasePlaywrightNetworkObserverLease(observerLease)) return false;
    }
    lease.networkObserverLeases.clear();
    if (lease.originalOwnDescriptor === undefined) {
      if (!Reflect.deleteProperty(lease.connection, 'sendMessageToServer')) return false;
    } else {
      Object.defineProperty(
        lease.connection,
        'sendMessageToServer',
        lease.originalOwnDescriptor,
      );
    }
    if (lease.trustedRuntime) {
      if (lease.rawBuffersOwnDescriptor === undefined) {
        if (!Reflect.deleteProperty(lease.connection, 'rawBuffers')) return false;
      } else {
        Object.defineProperty(
          lease.connection,
          'rawBuffers',
          lease.rawBuffersOwnDescriptor,
        );
      }
      Object.defineProperty(
        lease.connection,
        'onmessage',
        lease.onmessageOwnDescriptor,
      );
    }
    lease.active = false;
    return true;
  } catch {
    return false;
  }
}

function evaluateWithPlaywrightInstrumentationLease(
  page,
  pageFunction,
  parameters,
  captureLeases,
  validateDiagnostics,
) {
  const boundary = validatePlaywrightCaptureBoundary(page, captureLeases);
  const lease = captureLeases.get(boundary.connection);
  const protectedFrame = validatePlaywrightInstrumentationLease(page, boundary, lease);
  validateDiagnostics();
  return Reflect.apply(
    protectedFrame.evaluate,
    protectedFrame.frame,
    [pageFunction, parameters],
  );
}

function pageUrlWithPlaywrightInstrumentationLease(
  page,
  captureLeases,
  trustedRuntime,
) {
  if (!trustedRuntime) return page.url();
  const boundary = validatePlaywrightCaptureBoundary(page, captureLeases);
  const captureLease = captureLeases.get(boundary.connection);
  const protectedFrame = validatePlaywrightInstrumentationLease(
    page,
    boundary,
    captureLease,
  );
  return Reflect.apply(
    TRUSTED_PLAYWRIGHT_RUNTIME.frameMethods.url,
    protectedFrame.frame,
    [],
  );
}

function gotoWithPlaywrightInstrumentationLease(
  page,
  url,
  options,
  captureLeases,
  trustedRuntime,
  validateDiagnostics,
) {
  if (!trustedRuntime) return page.goto(url, options);
  const boundary = validatePlaywrightCaptureBoundary(page, captureLeases);
  const captureLease = captureLeases.get(boundary.connection);
  const protectedFrame = validatePlaywrightInstrumentationLease(
    page,
    boundary,
    captureLease,
  );
  validateDiagnostics();
  return Reflect.apply(
    TRUSTED_PLAYWRIGHT_RUNTIME.frameMethods.goto,
    protectedFrame.frame,
    [url, options],
  );
}

function validateCdpSession(value) {
  if (value === null || typeof value !== 'object'
    || typeof value.send !== 'function'
    || typeof value.on !== 'function'
    || typeof value.off !== 'function'
    || typeof value.detach !== 'function') {
    reject('Chromium scenario CDP boundary is invalid');
  }
  return value;
}

function installTrustedCdpRuntimeLease(cdp, context, captureLease) {
  let channel;
  let channelDetach;
  let channelDetachDescriptor;
  let channelDescriptor;
  let channelObjectDescriptor;
  let channelSend;
  let channelSendDescriptor;
  let emitDescriptor;
  let eventDescriptors;
  let guid;
  let guidDescriptor;
  let ownerLease;
  let parentDescriptor;
  try {
    channel = directDataProperty(cdp, '_channel', 'Chromium CDP channel');
    guid = directDataProperty(cdp, '_guid', 'Chromium CDP guid');
    channelDescriptor = Object.getOwnPropertyDescriptor(cdp, '_channel');
    parentDescriptor = Object.getOwnPropertyDescriptor(cdp, '_parent');
    guidDescriptor = Object.getOwnPropertyDescriptor(cdp, '_guid');
    channelObjectDescriptor = Object.getOwnPropertyDescriptor(channel, '_object');
    channelSendDescriptor = Object.getOwnPropertyDescriptor(channel, 'send');
    channelDetachDescriptor = Object.getOwnPropertyDescriptor(channel, 'detach');
    channelSend = channel.send;
    channelDetach = channel.detach;
    emitDescriptor = Object.getOwnPropertyDescriptor(cdp, 'emit');
    eventDescriptors = Object.fromEntries(
      Object.keys(TRUSTED_PLAYWRIGHT_RUNTIME.cdpSessionEventMethods).map((name) => [
        name,
        Object.getOwnPropertyDescriptor(cdp, name),
      ]),
    );
    const connectionObjects = directDataProperty(
      captureLease.connection,
      '_objects',
      'Chromium Playwright connection objects',
    );
    const contextObjects = directDataProperty(
      context,
      '_objects',
      'Chromium Playwright context objects',
    );
    if (captureLease.trustedRuntime !== true
      || cdp === null || typeof cdp !== 'object'
      || Object.getPrototypeOf(cdp) !== TRUSTED_PLAYWRIGHT_RUNTIME.cdpSessionPrototype
      || cdp.constructor !== TRUSTED_PLAYWRIGHT_RUNTIME.cdpSessionConstructor
      || directDataProperty(cdp, '_connection', 'Chromium CDP connection')
        !== captureLease.connection
      || directDataProperty(cdp, '_type', 'Chromium CDP type') !== 'CDPSession'
      || parentDescriptor?.value !== context
      || typeof guid !== 'string' || guid === ''
      || guidDescriptor?.value !== guid
      || MAP_GET.call(connectionObjects, guid) !== cdp
      || MAP_GET.call(contextObjects, guid) !== cdp
      || channel === null || typeof channel !== 'object'
      || Object.getPrototypeOf(channel) !== TRUSTED_PLAYWRIGHT_RUNTIME.channelPrototype
      || channelDescriptor?.value !== channel
      || channelObjectDescriptor?.value !== cdp
      || channelSendDescriptor !== undefined
      || channelDetachDescriptor !== undefined
      || typeof channelSend !== 'function'
      || typeof channelDetach !== 'function'
      || emitDescriptor !== undefined
      || Object.entries(TRUSTED_PLAYWRIGHT_RUNTIME.cdpSessionEventMethods).some(
        ([name, expected]) => !isDeepStrictEqual(eventDescriptors[name], expected.descriptor),
      )) {
      reject('Chromium trusted CDP factory returned an invalid identity');
    }
  } catch {
    return reject('Chromium trusted CDP factory returned an invalid identity');
  }
  const descriptors = {
    ...eventDescriptors,
    _channel: channelDescriptor,
    _guid: guidDescriptor,
    _parent: parentDescriptor,
    emit: emitDescriptor,
  };
  const channelDescriptors = {
    _object: channelObjectDescriptor,
    detach: channelDetachDescriptor,
    send: channelSendDescriptor,
  };
  const installedOwnerFields = [];
  const installedChannelFields = [];
  try {
    ownerLease = installTrustedChannelOwnerLease(
      cdp,
      captureLease.connection,
      'CDPSession',
    );
    for (const [name, value] of [
      ['_channel', channel],
      ['_guid', guid],
      ['_parent', context],
      ['emit', TRUSTED_PLAYWRIGHT_RUNTIME.eventEmitterMethods.emit],
      ...Object.entries(TRUSTED_PLAYWRIGHT_RUNTIME.cdpSessionEventMethods)
        .map(([name, expected]) => [name, expected.value]),
    ]) {
      Object.defineProperty(cdp, name, {
        configurable: true,
        enumerable: descriptors[name]?.enumerable ?? false,
        value,
        writable: false,
      });
      installedOwnerFields.push(name);
    }
    for (const [name, value] of [
      ['_object', cdp],
      ['detach', channelDetach],
      ['send', channelSend],
    ]) {
      Object.defineProperty(channel, name, {
        configurable: true,
        enumerable: channelDescriptors[name]?.enumerable ?? false,
        value,
        writable: false,
      });
      installedChannelFields.push(name);
    }
  } catch {
    try {
      restoreOwnDescriptors(channel, channelDescriptors, installedChannelFields);
      restoreOwnDescriptors(cdp, descriptors, installedOwnerFields);
      if (ownerLease !== undefined) releaseTrustedChannelOwnerLease(ownerLease);
    } catch {}
    return reject('Chromium trusted CDP lease could not be installed');
  }
  const lease = {
    active: true,
    captureLease,
    cdp,
    channel,
    channelDescriptors,
    channelDetach,
    channelSend,
    context,
    descriptors,
    detachTask: undefined,
    guid,
    installedChannelFields: Object.freeze(installedChannelFields),
    installedOwnerFields: Object.freeze(installedOwnerFields),
    ownerLease,
  };
  MAP_SET.call(captureLease.cdpLeases, cdp, lease);
  SET_ADD.call(captureLease.ownedCdpSessions, cdp);
  return lease;
}

function validateTrustedCdpRuntimeLease(lease, detached = false) {
  try {
    const connectionObjects = directDataProperty(
      lease.captureLease.connection,
      '_objects',
      'Chromium Playwright connection objects',
    );
    const contextObjects = directDataProperty(
      lease.context,
      '_objects',
      'Chromium Playwright context objects',
    );
    const expectedPresence = detached ? false : true;
    if (lease.active !== true
      || !trustedChannelOwnerLeaseIntact(lease.ownerLease)
      || Object.getPrototypeOf(lease.cdp) !== TRUSTED_PLAYWRIGHT_RUNTIME.cdpSessionPrototype
      || lease.cdp.constructor !== TRUSTED_PLAYWRIGHT_RUNTIME.cdpSessionConstructor
      || directDataProperty(lease.cdp, '_connection', 'Chromium CDP connection')
        !== lease.captureLease.connection
      || directDataProperty(lease.cdp, '_type', 'Chromium CDP type') !== 'CDPSession'
      || directDataProperty(lease.cdp, '_channel', 'Chromium CDP channel') !== lease.channel
      || directDataProperty(lease.cdp, '_parent', 'Chromium CDP parent') !== lease.context
      || directDataProperty(lease.cdp, '_guid', 'Chromium CDP guid') !== lease.guid
      || MAP_HAS.call(connectionObjects, lease.guid) !== expectedPresence
      || MAP_HAS.call(contextObjects, lease.guid) !== expectedPresence
      || Object.getOwnPropertyDescriptor(lease.channel, '_object')?.value !== lease.cdp
      || Object.getOwnPropertyDescriptor(lease.channel, 'send')?.value !== lease.channelSend
      || Object.getOwnPropertyDescriptor(lease.channel, 'send')?.writable !== false
      || Object.getOwnPropertyDescriptor(lease.channel, 'detach')?.value
        !== lease.channelDetach
      || Object.getOwnPropertyDescriptor(lease.channel, 'detach')?.writable !== false
      || Object.getOwnPropertyDescriptor(lease.cdp, 'emit')?.value
        !== TRUSTED_PLAYWRIGHT_RUNTIME.eventEmitterMethods.emit
      || Object.getOwnPropertyDescriptor(lease.cdp, 'emit')?.writable !== false
      || Object.entries(TRUSTED_PLAYWRIGHT_RUNTIME.cdpSessionEventMethods).some(
        ([name, expected]) => {
          const descriptor = Object.getOwnPropertyDescriptor(lease.cdp, name);
          return descriptor?.value !== expected.value || descriptor.writable !== false;
        }
      )) {
      reject('Chromium trusted CDP lease has drifted');
    }
  } catch {
    return reject('Chromium trusted CDP lease has drifted');
  }
  return lease;
}

function releaseTrustedCdpRuntimeLease(lease, detached) {
  let intact = true;
  try {
    validateTrustedCdpRuntimeLease(lease, detached);
  } catch {
    intact = false;
  }
  try {
    intact = restoreOwnDescriptors(
      lease.channel,
      lease.channelDescriptors,
      lease.installedChannelFields,
    ) && intact;
    intact = restoreOwnDescriptors(
      lease.cdp,
      lease.descriptors,
      lease.installedOwnerFields,
    ) && intact;
    intact = releaseTrustedChannelOwnerLease(lease.ownerLease) && intact;
    lease.active = false;
    MAP_DELETE.call(lease.captureLease.cdpLeases, lease.cdp);
    SET_DELETE.call(lease.captureLease.ownedCdpSessions, lease.cdp);
    return intact;
  } catch {
    return false;
  }
}

function installPlaywrightCdpFactoryLease(protectedFrame, captureLease) {
  validatePlaywrightCaptureLease(captureLease);
  if (captureLease.cdpFactoryLease !== undefined) {
    reject('Chromium CDP factory lease is already active');
  }
  const lease = {
    active: true,
    boundary: undefined,
    captureLease,
    context: protectedFrame.context,
    faulted: false,
    observedCdpSessions: [],
    wrapper: undefined,
  };
  lease.wrapper = function reviewedCdpSessionFactory(...parameters) {
    const cdp = Reflect.apply(
      TRUSTED_PLAYWRIGHT_RUNTIME.cdpSessionFactory,
      this,
      parameters,
    );
    let recorded = false;
    try {
      const context = directDataProperty(cdp, '_parent', 'Chromium CDP parent');
      const boundary = installTrustedCdpRuntimeLease(
        cdp,
        context,
        captureLease,
      );
      lease.observedCdpSessions.push(Object.freeze({ boundary, cdp }));
      recorded = true;
      if (lease.active !== true
        || lease.boundary !== undefined
        || parameters[0] !== lease.context
        || context !== lease.context) {
        lease.faulted = true;
      } else {
        lease.boundary = boundary;
      }
    } catch {
      lease.faulted = true;
      if (!recorded && cdp !== null && typeof cdp === 'object') {
        lease.observedCdpSessions.push(Object.freeze({ boundary: undefined, cdp }));
      }
    }
    return cdp;
  };
  captureLease.cdpFactoryLease = lease;
  try {
    MAP_SET.call(
      TRUSTED_PLAYWRIGHT_RUNTIME.factories,
      'CDPSession',
      lease.wrapper,
    );
    validatePinnedPlaywrightRuntime(
      TRUSTED_PLAYWRIGHT_RUNTIME.frameFactory,
      TRUSTED_PLAYWRIGHT_RUNTIME.pageFactory,
      TRUSTED_PLAYWRIGHT_RUNTIME.browserContextFactory,
      lease.wrapper,
    );
    return lease;
  } catch {
    try {
      MAP_SET.call(
        TRUSTED_PLAYWRIGHT_RUNTIME.factories,
        'CDPSession',
        TRUSTED_PLAYWRIGHT_RUNTIME.cdpSessionFactory,
      );
      captureLease.cdpFactoryLease = undefined;
      lease.active = false;
    } catch {}
    return reject('Chromium CDP factory lease could not be installed');
  }
}

function releasePlaywrightCdpFactoryLease(lease) {
  let intact = false;
  try {
    intact = lease.active === true
      && lease.captureLease.cdpFactoryLease === lease
      && MAP_GET.call(TRUSTED_PLAYWRIGHT_RUNTIME.factories, 'CDPSession')
        === lease.wrapper;
    MAP_SET.call(
      TRUSTED_PLAYWRIGHT_RUNTIME.factories,
      'CDPSession',
      TRUSTED_PLAYWRIGHT_RUNTIME.cdpSessionFactory,
    );
    lease.captureLease.cdpFactoryLease = undefined;
    lease.active = false;
    validatePinnedPlaywrightRuntime(
      TRUSTED_PLAYWRIGHT_RUNTIME.frameFactory,
      TRUSTED_PLAYWRIGHT_RUNTIME.pageFactory,
    );
    return intact;
  } catch {
    return false;
  }
}

function findTrustedCdpLease(cdp, captureLeases) {
  let found;
  for (const captureLease of MAP_VALUES.call(captureLeases)) {
    const candidate = MAP_GET.call(captureLease.cdpLeases, cdp);
    if (candidate !== undefined) {
      if (found !== undefined) reject('Chromium CDP has multiple runtime leases');
      found = candidate;
    }
  }
  if (found === undefined) reject('Chromium trusted CDP lease is absent');
  return found;
}

function trustedCdpLease(cdp, captureLeases) {
  const found = findTrustedCdpLease(cdp, captureLeases);
  if (found.detachTask !== undefined) {
    reject('Chromium trusted CDP detachment is active');
  }
  return validateTrustedCdpRuntimeLease(found);
}

function sendCdp(cdp, method, parameters, captureLeases, trustedRuntime) {
  if (!trustedRuntime) return cdp.send(method, parameters);
  const lease = trustedCdpLease(cdp, captureLeases);
  return Reflect.apply(
    TRUSTED_PLAYWRIGHT_RUNTIME.cdpSessionMethods.send,
    lease.cdp,
    [method, parameters],
  );
}

function addCdpListener(cdp, name, listener, captureLeases, trustedRuntime) {
  if (!trustedRuntime) return cdp.on(name, listener);
  const lease = trustedCdpLease(cdp, captureLeases);
  return Reflect.apply(
    TRUSTED_PLAYWRIGHT_RUNTIME.cdpSessionEventMethods.on.value,
    lease.cdp,
    [name, listener],
  );
}

function removeCdpListener(cdp, name, listener, captureLeases, trustedRuntime) {
  if (!trustedRuntime) return cdp.off(name, listener);
  const lease = trustedCdpLease(cdp, captureLeases);
  return Reflect.apply(
    TRUSTED_PLAYWRIGHT_RUNTIME.cdpSessionEventMethods.off.value,
    lease.cdp,
    [name, listener],
  );
}

function abortable(value, signal) {
  return new Promise((resolve, rejectAbort) => {
    let subscription;
    let detached = false;
    const detach = () => {
      if (detached) return;
      detached = true;
      try { subscription?.[Symbol.dispose](); } catch {}
    };
    const abort = () => {
      detach();
      rejectAbort(new StagingBrowserRelayChromiumScenarioError(
        'Chromium scenario operation was cancelled',
      ));
    };
    try {
      subscription = addAbortListener(signal, abort);
      if (detached) subscription?.[Symbol.dispose]?.();
    } catch {
      rejectAbort(new StagingBrowserRelayChromiumScenarioError(
        'Chromium scenario cancellation boundary failed',
      ));
      return;
    }
    Promise.resolve(value).then(
      (result) => { detach(); resolve(result); },
      (error) => { detach(); rejectAbort(error); },
    );
  });
}

async function bounded(value, milliseconds, timing) {
  let timer;
  let timerCreated = false;
  try {
    return await Promise.race([
      Promise.resolve(value),
      new Promise((_, rejectDeadline) => {
        try {
          timer = timing.setTimer(
            () => rejectDeadline(new StagingBrowserRelayChromiumScenarioError(
              'Chromium scenario bounded operation expired',
            )),
            milliseconds,
          );
          timerCreated = true;
        } catch {
          rejectDeadline(new StagingBrowserRelayChromiumScenarioError(
            'Chromium scenario bounded timer failed',
          ));
        }
      }),
    ]);
  } finally {
    if (timerCreated) {
      try { timing.clearTimer(timer); } catch {
        reject('Chromium scenario bounded timer cleanup failed');
      }
    }
  }
}

async function drainActiveTasks(tasks, timing) {
  if (tasks.size === 0) return true;
  try {
    await bounded(
      Promise.allSettled([...tasks]),
      MAXIMUM_CHROMIUM_CLEANUP_MILLISECONDS,
      timing,
    );
    return tasks.size === 0;
  } catch {
    return false;
  }
}

function validateCheckpoint(raw, action) {
  const result = exactKeys(
    raw,
    ['state', 'observation', 'lifecycle_observation', 'action_result'],
    'Chromium page action result',
  );
  if (result.state !== 'completed') reject('Chromium page action did not complete');
  const checkpoint = {
    observation: validatePageSafeObservation(result.observation),
    lifecycle: validatePageLifecycleObservation(result.lifecycle_observation),
    actionResult: result.action_result,
  };
  if (checkpoint.observation.browser !== 'chromium'
    || checkpoint.lifecycle.browser !== 'chromium') {
    reject('Chromium page action returned another browser');
  }
  if (action === 'observeState') {
    checkpoint.actionResult = validatePageStateObservation(checkpoint.actionResult);
  } else if (action === 'callApplied') {
    checkpoint.actionResult = validatePageCallObservation(checkpoint.actionResult);
  } else if (action === 'callFailed') {
    if (!isDeepStrictEqual(checkpoint.actionResult, {
      schema: PAGE_CALL_OBSERVATION_SCHEMA,
      state: 'failed',
      outcome: 'failed',
    })) reject('Chromium page call did not produce the reviewed failed outcome');
  } else if (action === 'callUncertain') {
    if (!isDeepStrictEqual(checkpoint.actionResult, {
      schema: PAGE_CALL_OBSERVATION_SCHEMA,
      state: 'failed',
      outcome: 'outcome_unknown',
    })) reject('Chromium page call did not produce the reviewed uncertain outcome');
  } else if (checkpoint.actionResult !== null) {
    reject('Chromium page action returned unreviewed evidence');
  }
  return Object.freeze(checkpoint);
}

async function invokePage(
  page,
  action,
  argument,
  signal,
  track,
  captureLeases,
  validateDiagnostics,
) {
  const captureBoundary = validatePlaywrightCaptureBoundary(page, captureLeases);
  const captureLease = captureLeases.get(captureBoundary.connection);
  let url;
  try {
    url = pageUrlWithPlaywrightInstrumentationLease(
      page,
      captureLeases,
      captureLease.trustedRuntime,
    );
  } catch {
    return reject('Chromium scenario page URL is unavailable');
  }
  if (url !== TARGET_URL) reject('Chromium scenario page left the reviewed target');
  let raw;
  try {
    raw = await abortable(track(evaluateWithPlaywrightInstrumentationLease(
      page,
      async ({
        expectedTargetUrl,
        pageApiMethods,
        selectedAction,
        selectedArgument,
      }) => {
        if (globalThis.location?.href !== expectedTargetUrl) return { state: 'failed' };
        const api = globalThis.miakappBrowserRelayPage;
        if (api === null || typeof api !== 'object'
          || pageApiMethods.some((method) => typeof api[method] !== 'function')) {
          return { state: 'failed' };
        }
        try {
          let actionResult = null;
          if (selectedAction === 'initialize') await api.initialize(selectedArgument);
          else if (selectedAction === 'start') await api.start();
          else if (selectedAction === 'observe') {}
          else if (selectedAction === 'observeState') {
            actionResult = api.observeState(selectedArgument);
          } else if (selectedAction === 'callApplied'
            || selectedAction === 'callFailed'
            || selectedAction === 'callUncertain') {
            actionResult = await api.call(selectedArgument);
          } else if (selectedAction === 'stop') await api.stop();
          else return { state: 'failed' };
          return {
            state: 'completed',
            observation: api.observe(),
            lifecycle_observation: api.observeLifecycle(),
            action_result: actionResult,
          };
        } catch {
          return { state: 'failed' };
        }
      },
      {
        expectedTargetUrl: TARGET_URL,
        pageApiMethods: PAGE_API_METHODS,
        selectedAction: action,
        selectedArgument: argument,
      },
      captureLeases,
      validateDiagnostics,
    )), signal);
  } catch {
    return reject('Chromium page action failed at the closed boundary');
  }
  return validateCheckpoint(raw, action);
}

async function installBfcacheWitness(
  page,
  signal,
  track,
  captureLeases,
  validateDiagnostics,
) {
  let installed;
  try {
    installed = await abortable(track(evaluateWithPlaywrightInstrumentationLease(page, ({
      expectedTargetUrl,
      pageApiMethods,
      witnessName,
    }) => {
      if (globalThis.location?.href !== expectedTargetUrl
        || Object.hasOwn(globalThis, witnessName)) return false;
      const api = globalThis.miakappBrowserRelayPage;
      if (api === null || typeof api !== 'object'
        || pageApiMethods.some((method) => typeof api[method] !== 'function')) return false;
      const slots = Object.create(null);
      const waits = Object.create(null);
      const resolves = Object.create(null);
      const counts = Object.create(null);
      let failed = false;
      let hiddenObserved = false;
      let resolveHidden;
      const hidden = new Promise((resolve) => { resolveHidden = resolve; });
      for (const type of ['pagehide', 'pageshow']) {
        counts[type] = 0;
        waits[type] = new Promise((resolve) => { resolves[type] = resolve; });
      }
      const complete = (type, event, operation) => {
        const dispatchVisibilityState = document.visibilityState;
        counts[type] += 1;
        if (counts[type] !== 1 || event?.isTrusted !== true || event.persisted !== true
          || dispatchVisibilityState !== 'visible') {
          failed = true;
          resolves[type]();
          return;
        }
        Promise.resolve(operation()).then(async () => {
          if (type === 'pagehide') await hidden;
          const visibilityState = document.visibilityState;
          if ((type === 'pagehide' && (!hiddenObserved || visibilityState !== 'hidden'))
            || (type === 'pageshow' && visibilityState !== 'visible')) {
            failed = true;
            return;
          }
          slots[type] = Object.freeze({
            event: Object.freeze({
              schema: 'miakapp.staging-browser-relay-page-lifecycle-event/2',
              type,
              dispatch_visibility_state: dispatchVisibilityState,
              completed_visibility_state: visibilityState,
              persisted: true,
            }),
            observation: api.observe(),
            lifecycle_observation: api.observeLifecycle(),
          });
        }, () => { failed = true; }).finally(() => resolves[type]());
      };
      globalThis.addEventListener('visibilitychange', (event) => {
        if (event?.isTrusted === true && document.visibilityState === 'hidden') {
          hiddenObserved = true;
          resolveHidden();
        }
      });
      globalThis.addEventListener('pagehide', (event) => {
        complete('pagehide', event, () => (
          api.observe().state === 'suspended' ? undefined : api.suspend()
        ));
      });
      globalThis.addEventListener('pageshow', (event) => {
        complete('pageshow', event, () => (
          api.observe().state === 'ready' ? undefined : api.resume()
        ));
      });
      const witness = Object.freeze({
        async read() {
          await Promise.all([waits.pagehide, waits.pageshow]);
          if (failed || counts.pagehide !== 1 || counts.pageshow !== 1
            || slots.pagehide === undefined || slots.pageshow === undefined) {
            return { state: 'failed' };
          }
          return {
            state: 'completed',
            pagehide: slots.pagehide,
            pageshow: slots.pageshow,
          };
        },
      });
      Object.defineProperty(globalThis, witnessName, {
        configurable: false,
        enumerable: false,
        writable: false,
        value: witness,
      });
      return Object.getOwnPropertyDescriptor(globalThis, witnessName)?.enumerable === false;
    }, {
      expectedTargetUrl: TARGET_URL,
      pageApiMethods: PAGE_API_METHODS,
      witnessName: WITNESS_NAME,
    }, captureLeases, validateDiagnostics)), signal);
  } catch {
    return reject('Chromium BFCache page witness installation failed');
  }
  if (installed !== true) reject('Chromium BFCache page witness was not installed safely');
}

function runtimeExpression(operation, argument) {
  return `(${async ({ expectedTargetUrl, pageApiMethods, selectedOperation, selectedArgument, witnessName }) => {
    if (globalThis.location?.href !== expectedTargetUrl) return { state: 'failed' };
    const api = globalThis.miakappBrowserRelayPage;
    if (api === null || typeof api !== 'object'
      || pageApiMethods.some((method) => typeof api[method] !== 'function')) {
      return { state: 'failed' };
    }
    try {
      if (selectedOperation === 'witness') {
        const witness = globalThis[witnessName];
        if (witness === null || typeof witness !== 'object'
          || typeof witness.read !== 'function') return { state: 'failed' };
        return witness.read();
      }
      let actionResult = null;
      if (selectedOperation === 'observeState') {
        actionResult = api.observeState(selectedArgument);
      } else if (selectedOperation === 'stop') {
        await api.stop();
      } else return { state: 'failed' };
      return {
        state: 'completed',
        observation: api.observe(),
        lifecycle_observation: api.observeLifecycle(),
        action_result: actionResult,
      };
    } catch {
      return { state: 'failed' };
    }
  }})(${JSON.stringify({
    expectedTargetUrl: TARGET_URL,
    pageApiMethods: PAGE_API_METHODS,
    selectedOperation: operation,
    selectedArgument: argument,
    witnessName: WITNESS_NAME,
  })})`;
}

async function evaluateRestored(
  cdp,
  operation,
  argument,
  signal,
  track,
  captureLeases,
  trustedRuntime,
) {
  let response;
  try {
    response = await abortable(track(sendCdp(cdp, 'Runtime.evaluate', {
      expression: runtimeExpression(operation, argument),
      awaitPromise: true,
      returnByValue: true,
    }, captureLeases, trustedRuntime)), signal);
  } catch {
    return reject('Chromium restored-page evaluation failed');
  }
  if (!plainObject(response) || response.exceptionDetails !== undefined
    || !plainObject(response.result) || !Object.hasOwn(response.result, 'value')) {
    reject('Chromium restored-page evaluation returned an invalid boundary');
  }
  return response.result.value;
}

function validateWitnessCheckpoint(value, type) {
  const checkpoint = exactKeys(
    value,
    ['event', 'observation', 'lifecycle_observation'],
    `Chromium ${type} witness`,
  );
  const event = validatePageLifecycleEvent(checkpoint.event);
  if (event.type !== type) reject(`Chromium ${type} witness event has drifted`);
  const observation = validatePageSafeObservation(checkpoint.observation);
  const lifecycle = validatePageLifecycleObservation(checkpoint.lifecycle_observation);
  if (observation.browser !== 'chromium' || lifecycle.browser !== 'chromium') {
    reject(`Chromium ${type} witness returned another browser`);
  }
  return Object.freeze({ event, observation, lifecycle });
}

async function createCdpSession(
  page,
  signal,
  timing,
  ensureActive,
  track,
  trackLateCleanup,
  registerLateCdp,
  markLateCdpDetached,
  captureLeases,
  trustedRuntime,
) {
  let context;
  let cdp;
  let cdpCandidate;
  let creation;
  let factoryBoundary;
  try {
    if (trustedRuntime) {
      const boundary = validatePlaywrightCaptureBoundary(page, captureLeases);
      const captureLease = captureLeases.get(boundary.connection);
      const protectedFrame = validatePlaywrightInstrumentationLease(
        page,
        boundary,
        captureLease,
      );
      context = protectedFrame.context;
      const factoryLease = installPlaywrightCdpFactoryLease(
        protectedFrame,
        captureLease,
      );
      const capability = {
        active: true,
        context,
        used: false,
      };
      captureLease.cdpCreationCapability = capability;
      let nativeCreation;
      try {
        nativeCreation = Reflect.apply(
          TRUSTED_PLAYWRIGHT_RUNTIME.browserContextMethods.newCDPSession,
          context,
          [page],
        );
        if (capability.used !== true) {
          reject('Chromium CDP protocol capability was not consumed');
        }
      } catch (error) {
        if (!releasePlaywrightCdpFactoryLease(factoryLease)) {
          trustedChromiumScenarioPoisoned = true;
        }
        throw error;
      } finally {
        capability.active = false;
        captureLease.cdpCreationCapability = undefined;
      }
      creation = track(Promise.resolve(nativeCreation).then(
        (value) => {
          const observedCdpSessions = Object.freeze([
            ...factoryLease.observedCdpSessions,
          ]);
          factoryBoundary = factoryLease.boundary;
          const factoryReleased = releasePlaywrightCdpFactoryLease(factoryLease);
          const exclusiveProvenance = factoryLease.faulted === false
            && observedCdpSessions.length === 1
            && observedCdpSessions[0].cdp === value
            && observedCdpSessions[0].boundary === factoryBoundary
            && factoryBoundary?.cdp === value;
          if (!exclusiveProvenance) {
            for (const { cdp: observedCdp } of observedCdpSessions) {
              registerLateCdp(observedCdp);
            }
          }
          if (!factoryReleased) {
            trustedChromiumScenarioPoisoned = true;
            reject('Chromium CDP factory cleanup did not converge');
          }
          if (!exclusiveProvenance) {
            reject('Chromium CDP factory provenance is invalid');
          }
          return value;
        },
        (error) => {
          for (const { cdp: observedCdp } of factoryLease.observedCdpSessions) {
            registerLateCdp(observedCdp);
          }
          if (!releasePlaywrightCdpFactoryLease(factoryLease)) {
            trustedChromiumScenarioPoisoned = true;
            reject('Chromium CDP factory cleanup did not converge');
          }
          throw error;
        },
      ));
    } else {
      context = page.context();
      if (context === null || typeof context !== 'object'
        || typeof context.newCDPSession !== 'function') {
        reject('Chromium browser context boundary is invalid');
      }
      creation = track(context.newCDPSession(page));
    }
    cdpCandidate = await abortable(creation, signal);
    cdp = validateCdpSession(cdpCandidate);
    if (trustedRuntime && factoryBoundary?.cdp !== cdp) {
      reject('Chromium CDP factory provenance is absent');
    }
    ensureActive();
    await abortable(track(sendCdp(
      cdp,
      'Page.enable',
      undefined,
      captureLeases,
      trustedRuntime,
    )), signal);
  } catch {
    if (cdp !== undefined || cdpCandidate !== undefined) {
      const failedCdp = cdp ?? cdpCandidate;
      registerLateCdp(failedCdp);
      if (await detachCdp(failedCdp, timing, captureLeases, trustedRuntime)
        || await detachCdp(failedCdp, timing, captureLeases, trustedRuntime)) {
        markLateCdpDetached(failedCdp);
      } else {
        return reject('Chromium failed CDP cleanup did not converge');
      }
    } else if (creation !== undefined) {
      trackLateCleanup(creation.then(
        async (lateCdp) => {
          registerLateCdp(lateCdp);
          if (await detachCdp(lateCdp, timing, captureLeases, trustedRuntime)
            || await detachCdp(lateCdp, timing, captureLeases, trustedRuntime)) {
            markLateCdpDetached(lateCdp);
            return true;
          }
          return reject('Chromium late CDP cleanup did not converge');
        },
        () => true,
      ));
    }
    return reject('Chromium CDP session could not be established');
  }
  return cdp;
}

async function proveBfcache(
  page,
  cdp,
  signal,
  timing,
  ensureActive,
  track,
  captureLeases,
  trustedRuntime,
  validateDiagnostics,
) {
  let frameTree;
  let history;
  try {
    [frameTree, history] = await Promise.all([
      abortable(track(sendCdp(
        cdp, 'Page.getFrameTree', undefined, captureLeases, trustedRuntime,
      )), signal),
      abortable(track(sendCdp(
        cdp, 'Page.getNavigationHistory', undefined, captureLeases, trustedRuntime,
      )), signal),
    ]);
  } catch {
    return reject('Chromium history boundary could not be read');
  }
  const mainFrame = frameTree?.frameTree?.frame;
  if (!plainObject(mainFrame) || typeof mainFrame.id !== 'string'
    || mainFrame.url !== TARGET_URL
    || !plainObject(history)
    || !Number.isSafeInteger(history.currentIndex)
    || !Array.isArray(history.entries)) {
    reject('Chromium target history boundary is invalid');
  }
  const targetEntries = history.entries.filter((entry) => entry?.url === TARGET_URL);
  const targetEntry = history.entries[history.currentIndex];
  if (targetEntries.length !== 1 || targetEntry !== targetEntries[0]
    || !Number.isSafeInteger(targetEntry.id)) {
    reject('Chromium target history entry is not unique and current');
  }

  const pagehideElapsed = ensureActive();
  let restoreRequested = false;
  let restoreCount = 0;
  let restoreFailure;
  let resolveRestore;
  let rejectRestore;
  const restore = new Promise((resolve, rejectProof) => {
    resolveRestore = resolve;
    rejectRestore = rejectProof;
  });
  restore.catch(() => undefined);
  const frameNavigated = (event) => {
    if (!restoreRequested || event?.frame?.id !== mainFrame.id) return;
    restoreCount += 1;
    if (event.frame.url !== TARGET_URL
      || event.type !== 'BackForwardCacheRestore'
      || restoreCount !== 1) {
      restoreFailure = new StagingBrowserRelayChromiumScenarioError(
        'Chromium did not perform the reviewed BFCache restore',
      );
      rejectRestore(restoreFailure);
      return;
    }
    resolveRestore(true);
  };
  const bfcacheNotUsed = () => {
    if (restoreRequested) {
      restoreFailure = new StagingBrowserRelayChromiumScenarioError(
        'Chromium rejected the reviewed BFCache restore',
      );
      rejectRestore(restoreFailure);
    }
  };
  let frameListenerInstalled = false;
  let rejectionListenerInstalled = false;
  try {
    addCdpListener(
      cdp, 'Page.frameNavigated', frameNavigated, captureLeases, trustedRuntime,
    );
    frameListenerInstalled = true;
    addCdpListener(
      cdp,
      'Page.backForwardCacheNotUsed',
      bfcacheNotUsed,
      captureLeases,
      trustedRuntime,
    );
    rejectionListenerInstalled = true;
    await abortable(track(gotoWithPlaywrightInstrumentationLease(
      page,
      CHROMIUM_SCENARIO_AWAY_URL,
      {
      waitUntil: 'domcontentloaded',
      timeout: MAXIMUM_LIFECYCLE_PAUSE_MILLISECONDS,
      },
      captureLeases,
      trustedRuntime,
      validateDiagnostics,
    )), signal);
    let awayUrl;
    try {
      awayUrl = pageUrlWithPlaywrightInstrumentationLease(
        page,
        captureLeases,
        trustedRuntime,
      );
    } catch {
      return reject('Chromium away page URL is unavailable');
    }
    if (awayUrl !== CHROMIUM_SCENARIO_AWAY_URL) {
      reject('Chromium outbound navigation left the reviewed destination');
    }
    let awayHistory;
    try {
      awayHistory = await abortable(
        track(sendCdp(
          cdp,
          'Page.getNavigationHistory',
          undefined,
          captureLeases,
          trustedRuntime,
        )),
        signal,
      );
    } catch {
      return reject('Chromium away history boundary could not be read');
    }
    if (!plainObject(awayHistory) || !Array.isArray(awayHistory.entries)
      || !Number.isSafeInteger(awayHistory.currentIndex)
      || awayHistory.entries[awayHistory.currentIndex]?.url !== CHROMIUM_SCENARIO_AWAY_URL
      || awayHistory.entries.filter((entry) => entry?.id === targetEntry.id
        && entry?.url === TARGET_URL).length !== 1) {
      reject('Chromium away history did not retain the reviewed target');
    }
    restoreRequested = true;
    await abortable(
      track(sendCdp(
        cdp,
        'Page.navigateToHistoryEntry',
        { entryId: targetEntry.id },
        captureLeases,
        trustedRuntime,
      )),
      signal,
    );
    await bounded(abortable(restore, signal), MAXIMUM_LIFECYCLE_PAUSE_MILLISECONDS, timing);
    await Promise.resolve();
    const rawWitness = await bounded(
      evaluateRestored(
        cdp,
        'witness',
        null,
        signal,
        track,
        captureLeases,
        trustedRuntime,
      ),
      MAXIMUM_LIFECYCLE_PAUSE_MILLISECONDS,
      timing,
    );
    const witness = exactKeys(
      rawWitness,
      ['state', 'pagehide', 'pageshow'],
      'Chromium BFCache witness result',
    );
    if (witness.state !== 'completed') reject('Chromium BFCache page witness did not complete');
    const restoredHistory = await abortable(
      track(sendCdp(
        cdp,
        'Page.getNavigationHistory',
        undefined,
        captureLeases,
        trustedRuntime,
      )),
      signal,
    );
    if (!plainObject(restoredHistory)
      || !Number.isSafeInteger(restoredHistory.currentIndex)
      || !Array.isArray(restoredHistory.entries)
      || restoredHistory.entries[restoredHistory.currentIndex]?.id !== targetEntry.id
      || restoredHistory.entries[restoredHistory.currentIndex]?.url !== TARGET_URL) {
      reject('Chromium restored history boundary is invalid');
    }
    await Promise.resolve();
    if (restoreFailure !== undefined || restoreCount !== 1) {
      reject('Chromium BFCache restore evidence became contradictory');
    }
    return Object.freeze({
      pagehide: validateWitnessCheckpoint(witness.pagehide, 'pagehide'),
      pageshow: validateWitnessCheckpoint(witness.pageshow, 'pageshow'),
      pagehideElapsed,
    });
  } catch {
    return reject('Chromium native BFCache proof failed closed');
  } finally {
    if (frameListenerInstalled) {
      try {
        removeCdpListener(
          cdp,
          'Page.frameNavigated',
          frameNavigated,
          captureLeases,
          trustedRuntime,
        );
      } catch {}
    }
    if (rejectionListenerInstalled) {
      try {
        removeCdpListener(
          cdp,
          'Page.backForwardCacheNotUsed',
          bfcacheNotUsed,
          captureLeases,
          trustedRuntime,
        );
      } catch {}
    }
  }
}

async function detachCdp(cdp, timing, captureLeases, trustedRuntime = false) {
  if (cdp === undefined) return true;
  let trustedLease;
  try {
    const operation = trustedRuntime
      ? (() => {
        trustedLease = findTrustedCdpLease(cdp, captureLeases);
        if (trustedLease.detachTask === undefined) {
          validateTrustedCdpRuntimeLease(trustedLease);
          trustedLease.detachTask = Promise.resolve().then(() => Reflect.apply(
            TRUSTED_PLAYWRIGHT_RUNTIME.cdpSessionMethods.detach,
            trustedLease.cdp,
            [],
          ));
          trustedLease.detachTask.catch(() => undefined);
        }
        return trustedLease.detachTask;
      })()
      : cdp.detach();
    await bounded(Promise.resolve(operation),
      MAXIMUM_CHROMIUM_CLEANUP_MILLISECONDS, timing);
    if (trustedRuntime) {
      validateTrustedCdpRuntimeLease(trustedLease, true);
      if (!releaseTrustedCdpRuntimeLease(trustedLease, true)) {
        trustedChromiumScenarioPoisoned = true;
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

function trustedPageClosureVerified(page, boundary) {
  try {
    const connectionObjects = directDataProperty(
      boundary.connection,
      '_objects',
      'Chromium Playwright connection objects',
    );
    return Reflect.apply(TRUSTED_PLAYWRIGHT_RUNTIME.pageMethods.isClosed, page, []) === true
      && !MAP_HAS.call(connectionObjects, boundary.pageGuid)
      && !MAP_HAS.call(connectionObjects, boundary.frameGuid);
  } catch {
    return false;
  }
}

function installTrustedCloseConnectionLease(boundary, captureLease) {
  const { connection } = boundary;
  if (captureLease !== undefined) {
    if (captureLease.connection !== connection || captureLease.trustedRuntime !== true) {
      reject('Chromium Playwright close connection lease is invalid');
    }
    validatePlaywrightCaptureLease(captureLease, true);
    return undefined;
  }
  validatePinnedPlaywrightRuntime(
    TRUSTED_PLAYWRIGHT_RUNTIME.frameFactory,
    TRUSTED_PLAYWRIGHT_RUNTIME.pageFactory,
  );
  const descriptors = {
    onmessage: Object.getOwnPropertyDescriptor(connection, 'onmessage'),
    rawBuffers: Object.getOwnPropertyDescriptor(connection, 'rawBuffers'),
    sendMessageToServer: Object.getOwnPropertyDescriptor(connection, 'sendMessageToServer'),
  };
  if (connection !== TRUSTED_PLAYWRIGHT_RUNTIME.connection
    || descriptors.onmessage?.configurable !== true
    || descriptors.rawBuffers !== undefined
    || descriptors.sendMessageToServer !== undefined) {
    reject('Chromium Playwright close connection boundary is invalid');
  }
  let rawBuffersInstalled = false;
  let onmessageInstalled = false;
  try {
    Object.defineProperty(connection, 'onmessage', {
      configurable: true,
      enumerable: TRUSTED_PLAYWRIGHT_RUNTIME.onmessageDescriptor.enumerable,
      value: TRUSTED_PLAYWRIGHT_RUNTIME.onmessage,
      writable: false,
    });
    onmessageInstalled = true;
    Object.defineProperty(connection, 'rawBuffers', {
      configurable: true,
      enumerable: false,
      value: TRUSTED_PLAYWRIGHT_RUNTIME.rawBuffers,
      writable: false,
    });
    rawBuffersInstalled = true;
    Object.defineProperty(connection, 'sendMessageToServer', {
      configurable: true,
      enumerable: false,
      value: TRUSTED_PLAYWRIGHT_RUNTIME.sendMessageToServer,
      writable: false,
    });
  } catch {
    try {
      Reflect.deleteProperty(connection, 'sendMessageToServer');
      if (rawBuffersInstalled) Reflect.deleteProperty(connection, 'rawBuffers');
      if (onmessageInstalled) {
        Object.defineProperty(connection, 'onmessage', descriptors.onmessage);
      }
    } catch {}
    return reject('Chromium Playwright close connection lease could not be installed');
  }
  return { connection, descriptors };
}

function releaseTrustedCloseConnectionLease(lease) {
  if (lease === undefined) return true;
  try {
    const rawBuffersDescriptor = Object.getOwnPropertyDescriptor(
      lease.connection,
      'rawBuffers',
    );
    const onmessageDescriptor = Object.getOwnPropertyDescriptor(
      lease.connection,
      'onmessage',
    );
    const sendDescriptor = Object.getOwnPropertyDescriptor(
      lease.connection,
      'sendMessageToServer',
    );
    if (onmessageDescriptor?.value !== TRUSTED_PLAYWRIGHT_RUNTIME.onmessage
      || onmessageDescriptor.writable !== false
      || rawBuffersDescriptor?.value !== TRUSTED_PLAYWRIGHT_RUNTIME.rawBuffers
      || rawBuffersDescriptor.writable !== false
      || sendDescriptor?.value !== TRUSTED_PLAYWRIGHT_RUNTIME.sendMessageToServer
      || sendDescriptor.writable !== false) return false;
    return restoreOwnDescriptors(
      lease.connection,
      lease.descriptors,
      ['onmessage', 'rawBuffers', 'sendMessageToServer'],
    );
  } catch {
    return false;
  }
}

function installTrustedPageCloseLease(page, boundary, captureLease) {
  validatePinnedPlaywrightRuntime(
    TRUSTED_PLAYWRIGHT_RUNTIME.frameFactory,
    TRUSTED_PLAYWRIGHT_RUNTIME.pageFactory,
  );
  const connectionLease = installTrustedCloseConnectionLease(boundary, captureLease);
  const protectedFrame = captureLease?.pageFrames.get(page);
  if (protectedFrame !== undefined) {
    if (protectedFrame.page !== page
      || protectedFrame.frame !== boundary.frame
      || protectedFrame.pageChannel !== boundary.channel
      || protectedFrame.pageChannelClose !== boundary.channelClose
      || !trustedChannelOwnerLeaseIntact(protectedFrame.pageOwnerLease)
      || Object.getOwnPropertyDescriptor(page, '_channel')?.value !== boundary.channel
      || Object.getOwnPropertyDescriptor(boundary.channel, '_object')?.value !== page
      || Object.getOwnPropertyDescriptor(boundary.channel, 'close')?.value
        !== boundary.channelClose) {
      reject('Chromium Playwright protected page close boundary is invalid');
    }
    return { connectionLease, temporary: false };
  }

  const connectionObjects = directDataProperty(
    boundary.connection,
    '_objects',
    'Chromium Playwright connection objects',
  );
  if (Object.getPrototypeOf(page) !== TRUSTED_PLAYWRIGHT_RUNTIME.pagePrototype
    || page.constructor !== TRUSTED_PLAYWRIGHT_RUNTIME.pageConstructor
    || boundary.connection !== TRUSTED_PLAYWRIGHT_RUNTIME.connection
    || directDataProperty(page, '_connection', 'Chromium Playwright page connection')
      !== boundary.connection
    || directDataProperty(page, '_guid', 'Chromium Playwright page guid')
      !== boundary.pageGuid
    || directDataProperty(boundary.frame, '_guid', 'Chromium Playwright frame guid')
      !== boundary.frameGuid
    || directDataProperty(page, '_mainFrame', 'Chromium Playwright main frame')
      !== boundary.frame
    || Object.getPrototypeOf(boundary.channel)
      !== TRUSTED_PLAYWRIGHT_RUNTIME.channelPrototype
    || MAP_GET.call(connectionObjects, boundary.pageGuid) !== page
    || MAP_GET.call(connectionObjects, boundary.frameGuid) !== boundary.frame) {
    reject('Chromium Playwright page close boundary is invalid');
  }

  const descriptors = {
    _channel: Object.getOwnPropertyDescriptor(page, '_channel'),
    _object: Object.getOwnPropertyDescriptor(boundary.channel, '_object'),
    _ownedContext: Object.getOwnPropertyDescriptor(page, '_ownedContext'),
    close: Object.getOwnPropertyDescriptor(boundary.channel, 'close'),
  };
  let ownerLease;
  const installed = [];
  try {
    ownerLease = installTrustedChannelOwnerLease(page, boundary.connection, 'Page');
    Object.defineProperty(page, '_ownedContext', {
      configurable: true,
      enumerable: descriptors._ownedContext?.enumerable ?? false,
      value: undefined,
      writable: false,
    });
    installed.push('_ownedContext');
    Object.defineProperty(page, '_channel', {
      configurable: true,
      enumerable: descriptors._channel?.enumerable ?? false,
      value: boundary.channel,
      writable: false,
    });
    installed.push('_channel');
    Object.defineProperty(boundary.channel, '_object', {
      configurable: true,
      enumerable: descriptors._object?.enumerable ?? false,
      value: page,
      writable: false,
    });
    installed.push('_object');
    Object.defineProperty(boundary.channel, 'close', {
      configurable: true,
      enumerable: false,
      value: boundary.channelClose,
      writable: false,
    });
    installed.push('close');
  } catch {
    try {
      restoreOwnDescriptors(boundary.channel, descriptors, installed.filter(
        (name) => name === '_object' || name === 'close',
      ));
      restoreOwnDescriptors(page, descriptors, installed.filter(
        (name) => name === '_channel' || name === '_ownedContext',
      ));
      if (ownerLease !== undefined) releaseTrustedChannelOwnerLease(ownerLease);
      releaseTrustedCloseConnectionLease(connectionLease);
    } catch {}
    return reject('Chromium Playwright page close lease could not be installed');
  }
  return {
    boundary,
    connectionLease,
    descriptors,
    ownerLease,
    temporary: true,
  };
}

function releaseTrustedPageCloseLease(lease) {
  if (lease === undefined) return true;
  let intact = true;
  try {
    if (lease.temporary) {
      const { boundary, descriptors, ownerLease } = lease;
      intact = trustedChannelOwnerLeaseIntact(ownerLease)
        && Object.getOwnPropertyDescriptor(boundary.channel, 'close')?.value
          === boundary.channelClose
        && Object.getOwnPropertyDescriptor(boundary.channel, '_object')?.value
          === ownerLease.owner
        && Object.getOwnPropertyDescriptor(ownerLease.owner, '_channel')?.value
          === boundary.channel
        && Object.getOwnPropertyDescriptor(ownerLease.owner, '_ownedContext')?.value
          === undefined;
      intact = restoreOwnDescriptors(boundary.channel, descriptors, ['_object', 'close'])
        && intact;
      intact = restoreOwnDescriptors(
        ownerLease.owner,
        descriptors,
        ['_ownedContext', '_channel'],
      ) && intact;
      intact = releaseTrustedChannelOwnerLease(ownerLease) && intact;
    }
    return releaseTrustedCloseConnectionLease(lease.connectionLease) && intact;
  } catch {
    return false;
  }
}

async function closePage(page, timing, trustedBoundary, captureLeases) {
  if (page === undefined) return true;
  if (trustedBoundary !== undefined && trustedPageClosureVerified(page, trustedBoundary)) {
    return true;
  }
  let closeLease;
  let closed = false;
  try {
    if (trustedBoundary !== undefined) {
      closeLease = installTrustedPageCloseLease(
        page,
        trustedBoundary,
        captureLeases.get(trustedBoundary.connection),
      );
    }
    await bounded(Promise.resolve().then(() => (trustedBoundary === undefined
      ? page.close({ runBeforeUnload: false })
      : trustedBoundary.channelClose({ reason: undefined }))),
      MAXIMUM_CHROMIUM_CLEANUP_MILLISECONDS, timing);
    closed = trustedBoundary === undefined
      ? true
      : trustedPageClosureVerified(page, trustedBoundary);
  } catch {
    closed = false;
  }
  return releaseTrustedPageCloseLease(closeLease) && closed;
}

async function runBrowserRelayChromiumScenarioImplementation(
  dependenciesValue,
  optionsValue,
  playwrightBoundary,
  playwrightDiagnosticLease,
) {
  validatePlaywrightDiagnosticBoundary(playwrightDiagnosticLease);
  const dependencies = validateDependencies(dependenciesValue);
  const trustedPlaywrightRuntime = playwrightBoundary !== SYNTHETIC_PLAYWRIGHT_BOUNDARY;
  let optionKeys;
  let options;
  try {
    optionKeys = Reflect.ownKeys(optionsValue);
    if (optionKeys.some((key) => typeof key !== 'string')) {
      reject('Chromium scenario options must contain the reviewed fields');
    }
    optionKeys.sort();
    const optionFields = isDeepStrictEqual(optionKeys, ['signal', 'timing'])
      ? ['signal', 'timing']
      : ['pageProjectionPort', 'signal', 'timing'];
    options = exactKeys(optionsValue, optionFields, 'Chromium scenario options');
  } catch (error) {
    if (error instanceof StagingBrowserRelayChromiumScenarioError) throw error;
    return reject('Chromium scenario options must contain the reviewed fields');
  }
  const pageProjectionPort = validatePageProjectionPort(options.pageProjectionPort);
  const externalSignal = validateSignal(options.signal);
  const timing = validateTiming(options.timing);
  const controller = new AbortController();
  const pages = [];
  const ownedPages = new Set();
  const closedPages = new Set();
  const closeTasks = new Map();
  const activeBrowserTasks = new Set();
  const captureLeases = new Map();
  const trustedPageRuntimeBoundaries = new WeakMap();
  const lateCdpSessions = new Set();
  const detachedLateCdpSessions = new Set();
  let lateCleanupFailed = false;
  let cdp;
  let cdpDetached = false;
  let producer;
  let producerTerminal = false;
  let privateInput;
  let controlIndex = 0;
  let lastInstant;
  let deadlineTimer;
  let deadlineTimerCreated = false;
  let externalAbortSubscription;
  const startedAt = instant(timing.clock);
  lastInstant = startedAt;
  const validateDiagnostics = () => validatePlaywrightDiagnosticBoundary(
    playwrightDiagnosticLease,
  );

  const requestAbort = () => {
    if (!controller.signal.aborted) {
      try {
        controller.abort(new StagingBrowserRelayChromiumScenarioError(
          'Chromium scenario was cancelled',
        ));
      } catch {}
    }
  };
  const track = (value) => {
    const task = Promise.resolve(value);
    activeBrowserTasks.add(task);
    task.then(
      () => activeBrowserTasks.delete(task),
      () => activeBrowserTasks.delete(task),
    );
    return task;
  };
  const trackLateCleanup = (value) => {
    const task = track(value);
    task.then(undefined, () => { lateCleanupFailed = true; });
    return task;
  };
  const ensureActive = () => {
    if (controller.signal.aborted || signalAborted(externalSignal)) {
      requestAbort();
      reject('Chromium scenario is outside its reviewed lifetime');
    }
    const now = instant(timing.clock);
    if (now < lastInstant) reject('Chromium scenario clock moved backwards');
    lastInstant = now;
    const elapsed = now - startedAt;
    if (elapsed > timing.maximumMilliseconds) {
      requestAbort();
      reject('Chromium scenario exceeded its reviewed lifetime');
    }
    return elapsed;
  };
  const closeOwnedPage = async (page) => {
    if (page === undefined || closedPages.has(page)) return true;
    let task = closeTasks.get(page);
    if (task === undefined) {
      task = closePage(
        page,
        timing,
        WEAK_MAP_GET.call(trustedPageRuntimeBoundaries, page),
        captureLeases,
      );
      closeTasks.set(page, task);
    }
    const closed = await task;
    if (closeTasks.get(page) === task) closeTasks.delete(page);
    if (closed) closedPages.add(page);
    return closed;
  };
  const retryCloseOwnedPage = async (page) => (
    await closeOwnedPage(page) || closeOwnedPage(page)
  );
  const retryDetachOwnedCdp = async () => {
    if (cdpDetached || cdp === undefined) return true;
    if (await detachCdp(cdp, timing, captureLeases, trustedPlaywrightRuntime)
      || await detachCdp(cdp, timing, captureLeases, trustedPlaywrightRuntime)) {
      cdpDetached = true;
      return true;
    }
    return false;
  };
  const retryDetachLateCdp = async (lateCdp) => {
    if (detachedLateCdpSessions.has(lateCdp)) return true;
    if (await detachCdp(
      lateCdp, timing, captureLeases, trustedPlaywrightRuntime,
    ) || await detachCdp(
      lateCdp, timing, captureLeases, trustedPlaywrightRuntime,
    )) {
      detachedLateCdpSessions.add(lateCdp);
      return true;
    }
    return false;
  };
  const ownObservedPages = (observedPages) => {
    for (const { boundary, page } of observedPages) {
      if (boundary !== undefined) {
        WEAK_MAP_SET.call(trustedPageRuntimeBoundaries, page, boundary);
      }
      if (!ownedPages.has(page)) {
        ownedPages.add(page);
        pages.push(page);
      }
    }
  };
  const closeObservedPages = async (observedPages) => {
    ownObservedPages(observedPages);
    let converged = true;
    for (const { page } of observedPages) {
      if (!await retryCloseOwnedPage(page)) converged = false;
    }
    if (!converged) reject('Chromium observed page cleanup did not converge');
    return true;
  };
  const acquirePage = async (pageInstance) => {
    let page;
    let acquisition;
    let acquisitionFailed = false;
    let creationLease;
    let pageAlreadyOwned = false;
    let settlement;
    let trustedBoundary;
    ensureActive();
    if (trustedPlaywrightRuntime) {
      creationLease = installPlaywrightPageFactoryLease();
    }
    try {
      let opened;
      try {
        opened = dependencies.openPage(pageInstance, controller.signal);
      } catch {
        opened = Promise.reject();
      }
      acquisition = track(Promise.resolve(opened).then(
        (acquiredPage) => {
          const boundary = trustedPlaywrightRuntime
            ? WEAK_MAP_GET.call(creationLease.pageRuntimeBoundaries, acquiredPage)
            : undefined;
          const factoryFaulted = creationLease?.faulted === true;
          let observedPages = creationLease === undefined
            ? Object.freeze([Object.freeze({ boundary, page: acquiredPage })])
            : Object.freeze([...creationLease.observedPages]);
          if (creationLease !== undefined
            && !observedPages.some(({ page: observedPage }) => observedPage === acquiredPage)) {
            observedPages = Object.freeze([
              ...observedPages,
              Object.freeze({ boundary, page: acquiredPage }),
            ]);
          }
          const factoryReleased = creationLease === undefined
            || releasePlaywrightPageFactoryLease(creationLease);
          if (!factoryReleased) {
            trustedChromiumScenarioPoisoned = true;
          }
          return Object.freeze({
            boundary,
            factoryFaulted,
            factoryReleased,
            observedPages,
            page: acquiredPage,
            state: 'fulfilled',
          });
        },
        () => {
          const factoryFaulted = creationLease?.faulted === true;
          const observedPages = creationLease === undefined
            ? Object.freeze([])
            : Object.freeze([...creationLease.observedPages]);
          const factoryReleased = creationLease === undefined
            || releasePlaywrightPageFactoryLease(creationLease);
          if (!factoryReleased) {
            trustedChromiumScenarioPoisoned = true;
          }
          return Object.freeze({
            boundary: undefined,
            factoryFaulted,
            factoryReleased,
            observedPages,
            page: undefined,
            state: 'rejected',
          });
        },
      ));
      settlement = await abortable(
        acquisition,
        controller.signal,
      );
      pageAlreadyOwned = settlement.state === 'fulfilled'
        && ownedPages.has(settlement.page);
      ownObservedPages(settlement.observedPages);
      if (settlement.factoryFaulted
        || settlement.factoryReleased !== true
        || settlement.state !== 'fulfilled') {
        reject('Chromium scenario page provider did not complete');
      }
      ({ boundary: trustedBoundary, page } = settlement);
      if (trustedPlaywrightRuntime
        && (settlement.observedPages.length !== 1
          || settlement.observedPages[0].page !== page
          || settlement.observedPages[0].boundary !== trustedBoundary)) {
        reject('Chromium Playwright page factory provenance is not exclusive');
      }
    } catch {
      if (acquisition !== undefined) {
        trackLateCleanup(acquisition.then(
          ({ observedPages }) => closeObservedPages(observedPages),
          () => reject('Chromium page acquisition settlement was lost'),
        ));
      }
      acquisitionFailed = true;
      if (acquisition === undefined && creationLease !== undefined) {
        if (!releasePlaywrightPageFactoryLease(creationLease)) {
          trustedChromiumScenarioPoisoned = true;
          reject('Chromium Playwright page factory lease drifted');
        }
      }
    }
    if (acquisitionFailed) reject('Chromium scenario page acquisition failed');
    if (pageAlreadyOwned) {
      reject('Chromium scenario page provider reused an owned page');
    }
    if (trustedPlaywrightRuntime && trustedBoundary === undefined) {
      reject('Chromium Playwright page factory provenance is absent');
    }
    if (controller.signal.aborted || signalAborted(externalSignal)) {
      await closeOwnedPage(page);
      reject('Chromium scenario page arrived after cancellation');
    }
    validatePage(page, pageInstance, trustedBoundary);
    acquirePlaywrightCaptureLease(
      page,
      captureLeases,
      trustedPlaywrightRuntime,
      creationLease,
    );
    return page;
  };
  const control = async (phase) => {
    if (CONTROL_PHASE_ORDER[controlIndex] !== phase) {
      reject('Chromium scenario control order has drifted');
    }
    let value;
    ensureActive();
    try {
      value = await abortable(
        track(dependencies.controlPhase(phase, controller.signal)),
        controller.signal,
      );
    } catch {
      return reject('Chromium scenario controller failed at the closed boundary');
    }
    ensureActive();
    validateDiagnostics();
    controlIndex += 1;
    return validateChromiumScenarioControlResult(phase, value);
  };
  const input = async (identityGeneration, page) => {
    let value;
    ensureActive();
    validatePlaywrightCaptureBoundary(page, captureLeases);
    try {
      value = await abortable(
        track(dependencies.privateInputProvider(
          'chromium',
          identityGeneration,
          controller.signal,
        )),
        controller.signal,
      );
    } catch {
      return reject('Chromium scenario private input acquisition failed');
    }
    ensureActive();
    validateDiagnostics();
    const reviewed = validatePagePrivateInput(value);
    if (reviewed.browser !== 'chromium') {
      reject('Chromium scenario private input returned another browser');
    }
    validatePlaywrightCaptureBoundary(page, captureLeases);
    return reviewed;
  };
  const invoke = (page, action, argument) => invokePage(
    page,
    action,
    argument,
    controller.signal,
    track,
    captureLeases,
    validateDiagnostics,
  );
  const validateCaptureLeases = () => {
    for (const lease of captureLeases.values()) {
      validatePlaywrightCaptureLease(lease);
    }
  };
  const record = async (sequence, checkpoint, extras = {}, elapsedOverride) => {
    const elapsed = elapsedOverride ?? ensureActive();
    const fact = validateBrowserRelayPageFact(Object.freeze({
      schema: PAGE_FACT_SCHEMA,
      browser: 'chromium',
      sequence,
      phase: PAGE_FACT_ORDER_BY_BROWSER.chromium[sequence - 1],
      page_instance: sequence <= 15 ? 1 : 2,
      input_generation: sequence <= 15 ? 1 : 2,
      identity_generation: sequence <= 15 ? 1 : 2,
      elapsed_milliseconds: elapsed,
      observation: checkpoint.observation,
      lifecycle_observation: checkpoint.lifecycle,
      state_observation: extras.state ?? null,
      call_observation: extras.call ?? null,
      lifecycle_event: extras.event ?? null,
    }), 'chromium', sequence);
    producer.record(fact);
    if (pageProjectionPort === undefined) return;
    const projection = Object.freeze(Object.fromEntries(
      PAGE_PROJECTION_FIELDS.map((field) => [field, fact[field]]),
    ));
    let accepted;
    try {
      accepted = await abortable(
        track(pageProjectionPort.record(projection, controller.signal)),
        controller.signal,
      );
    } catch {
      return reject('Chromium scenario page projection failed closed');
    }
    ensureActive();
    validateDiagnostics();
    if (accepted !== true) {
      reject('Chromium scenario page projection was not accepted');
    }
  };

  try {
    if (externalSignal !== undefined) {
      try {
        externalAbortSubscription = addAbortListener(externalSignal, requestAbort);
      } catch {
        reject('Chromium scenario external cancellation boundary failed');
      }
    }
    if (signalAborted(externalSignal)) requestAbort();
    try {
      deadlineTimer = timing.setTimer(requestAbort, timing.maximumMilliseconds);
      deadlineTimerCreated = true;
    } catch {
      requestAbort();
      reject('Chromium scenario deadline could not be installed');
    }
    ensureActive();
    const first = await acquirePage(1);
    ensureActive();
    producer = createBrowserRelayPageReceiptProducer('chromium');
    privateInput = await input(1, first);
    let checkpoint = await invoke(first, 'initialize', privateInput);
    privateInput = undefined;
    await record(1, checkpoint);
    checkpoint = await invoke(first, 'start', null);
    await record(2, checkpoint);
    await installBfcacheWitness(
      first,
      controller.signal,
      track,
      captureLeases,
      validateDiagnostics,
    );

    const authoritative = await control('authoritative_state');
    checkpoint = await invoke(first, 'observeState', authoritative.state_expectation);
    await record(3, checkpoint, { state: checkpoint.actionResult });
    const patched = await control('patched_state');
    checkpoint = await invoke(first, 'observeState', patched.state_expectation);
    await record(4, checkpoint, { state: checkpoint.actionResult });
    const initialCall = await control('initial_call');
    checkpoint = await invoke(first, 'callApplied', initialCall.call_target);
    await record(5, checkpoint, { call: checkpoint.actionResult });

    await control('same_relay_reauthenticated');
    checkpoint = await invoke(first, 'observe', null);
    await record(6, checkpoint);
    await control('relay_handoff_stale');
    checkpoint = await invoke(first, 'observeState', patched.state_expectation);
    await record(7, checkpoint, { state: checkpoint.actionResult });
    await control('relay_b_ready');
    checkpoint = await invoke(first, 'observe', null);
    await record(8, checkpoint);
    const relayB = await control('relay_b_state');
    checkpoint = await invoke(first, 'observeState', relayB.state_expectation);
    await record(9, checkpoint, { state: checkpoint.actionResult });
    const relayBCall = await control('relay_b_call');
    checkpoint = await invoke(first, 'callApplied', relayBCall.call_target);
    await record(10, checkpoint, { call: checkpoint.actionResult });

    const failedCall = await control('failed_call');
    await invoke(first, 'callFailed', failedCall.call_target);
    const uncertainCall = await control('uncertain_call');
    await invoke(first, 'callUncertain', uncertainCall.call_target);
    checkpoint = await invoke(first, 'observeState', relayB.state_expectation);
    await record(11, checkpoint, { state: checkpoint.actionResult });
    const recovered = await control('relay_b_recovered');
    checkpoint = await invoke(first, 'observeState', recovered.state_expectation);
    await record(12, checkpoint, { state: checkpoint.actionResult });

    cdp = await createCdpSession(
      first,
      controller.signal,
      timing,
      ensureActive,
      track,
      trackLateCleanup,
      (lateCdp) => lateCdpSessions.add(lateCdp),
      (lateCdp) => detachedLateCdpSessions.add(lateCdp),
      captureLeases,
      trustedPlaywrightRuntime,
    );
    const bfcache = await proveBfcache(
      first,
      cdp,
      controller.signal,
      timing,
      ensureActive,
      track,
      captureLeases,
      trustedPlaywrightRuntime,
      validateDiagnostics,
    );
    await record(
      13,
      bfcache.pagehide,
      { event: bfcache.pagehide.event },
      bfcache.pagehideElapsed,
    );
    const restoredState = validateCheckpoint(
      await evaluateRestored(
        cdp,
        'observeState',
        recovered.state_expectation,
        controller.signal,
        track,
        captureLeases,
        trustedPlaywrightRuntime,
      ),
      'observeState',
    );
    await record(14, restoredState, {
      state: restoredState.actionResult,
      event: bfcache.pageshow.event,
    });
    checkpoint = validateCheckpoint(
      await evaluateRestored(
        cdp,
        'stop',
        null,
        controller.signal,
        track,
        captureLeases,
        trustedPlaywrightRuntime,
      ),
      'stop',
    );
    await record(15, checkpoint);
    if (!await detachCdp(
      cdp,
      timing,
      captureLeases,
      trustedPlaywrightRuntime,
    )) reject('Chromium CDP cleanup did not converge');
    cdpDetached = true;
    if (!await closeOwnedPage(first)) reject('Chromium first page cleanup did not converge');

    const second = await acquirePage(2);
    privateInput = await input(2, second);
    checkpoint = await invoke(second, 'initialize', privateInput);
    privateInput = undefined;
    await record(16, checkpoint);
    checkpoint = await invoke(second, 'start', null);
    await record(17, checkpoint);
    checkpoint = await invoke(second, 'stop', null);
    await record(18, checkpoint);
    if (!await closeOwnedPage(second)) reject('Chromium replacement page cleanup did not converge');
    validateCaptureLeases();
    if (controlIndex !== CONTROL_PHASE_ORDER.length) {
      reject('Chromium scenario controller did not complete every reviewed phase');
    }
    const receipt = producer.close();
    producerTerminal = true;
    ensureActive();
    return validateChromiumScenarioResult({
      schema: CHROMIUM_SCENARIO_RESULT_SCHEMA,
      browser: 'chromium',
      state: 'receipt_closed',
      private_inputs_requested: 2,
      page_instances: 2,
      native_bfcache_restores: 1,
      receipt,
    });
  } catch {
    requestAbort();
    if (producer !== undefined && !producerTerminal) {
      try { producer.abort(); } catch {}
      producerTerminal = true;
    }
    return reject('Staging Chromium scenario failed before a closed receipt');
  } finally {
    requestAbort();
    privateInput = undefined;
    let cleanupConverged = true;
    if (deadlineTimerCreated) {
      try { timing.clearTimer(deadlineTimer); } catch { cleanupConverged = false; }
    }
    if (externalAbortSubscription !== undefined) {
      try {
        const dispose = externalAbortSubscription[Symbol.dispose];
        if (typeof dispose !== 'function') cleanupConverged = false;
        else dispose.call(externalAbortSubscription);
      } catch { cleanupConverged = false; }
      externalAbortSubscription = undefined;
    }
    await retryDetachOwnedCdp();
    for (const lateCdp of lateCdpSessions) {
      await retryDetachLateCdp(lateCdp);
    }
    for (const page of pages) {
      await retryCloseOwnedPage(page);
    }
    if (!await drainActiveTasks(activeBrowserTasks, timing)) cleanupConverged = false;
    if (!await retryDetachOwnedCdp()) cleanupConverged = false;
    for (const lateCdp of lateCdpSessions) {
      if (!await retryDetachLateCdp(lateCdp)) cleanupConverged = false;
    }
    for (const page of pages) {
      if (!await retryCloseOwnedPage(page)) cleanupConverged = false;
    }
    if (cleanupConverged) {
      for (const lease of captureLeases.values()) {
        if (!releasePlaywrightCaptureLease(lease)) cleanupConverged = false;
      }
    }
    if (lateCleanupFailed) cleanupConverged = false;
    if (producer !== undefined && !producerTerminal) {
      try { producer.abort(); } catch { cleanupConverged = false; }
      producerTerminal = true;
    }
    if (!cleanupConverged) {
      if (trustedPlaywrightRuntime) trustedChromiumScenarioPoisoned = true;
      reject('Chromium scenario cleanup did not converge');
    }
  }
}

export async function runBrowserRelayChromiumScenarioInternal(dependencies, options) {
  if (trustedChromiumScenarioPoisoned) {
    return reject('The trusted Chromium scenario runtime is unavailable');
  }
  if (trustedChromiumScenarioActive) {
    return reject('A trusted Chromium scenario is already active');
  }
  trustedChromiumScenarioActive = true;
  let diagnosticLease;
  try {
    diagnosticLease = installPlaywrightDiagnosticLease();
    return await runBrowserRelayChromiumScenarioImplementation(
      dependencies,
      options,
      undefined,
      diagnosticLease,
    );
  } finally {
    const released = diagnosticLease === undefined
      ? true
      : releasePlaywrightDiagnosticLease(diagnosticLease);
    trustedChromiumScenarioActive = false;
    if (!released) {
      trustedChromiumScenarioPoisoned = true;
      reject('Chromium Playwright diagnostic cleanup did not converge');
    }
  }
}

export function runBrowserRelayChromiumScenarioInternalForTesting(
  dependencies,
  options,
) {
  return runBrowserRelayChromiumScenarioImplementation(
    dependencies,
    options,
    SYNTHETIC_PLAYWRIGHT_BOUNDARY,
    undefined,
  );
}
