import { verifyArtifactBytes } from './artifact';
import { validateGuestProgram } from './program';
import { BLOCKED_NAVIGATOR_MEMBERS, BLOCKED_WORKER_GLOBALS } from './security-profile';
import {
  BROKER_PROTOCOL,
  COMPONENT_ABI,
  ContractViolation,
  LIMITS,
  assertInstanceId,
  isCapabilityGranted,
  isPlainRecord,
  measureStructuredValue,
  validateEnvelope,
  validateRequirements,
  validateResourceName,
  validateUiTree,
  type CapabilityRequirements,
  type Envelope,
  type UiNode,
} from './contract';

const HOST_MESSAGE_KINDS = new Set([
  'runtime.load',
  'runtime.activate',
  'runtime.dispose',
  'runtime.ping',
  'ui.interaction',
  'state.snapshot',
  'state.patch',
  'state.stale',
  'event.message',
  'call.accepted',
  'call.chunk',
  'call.result',
  'call.error',
  'call.outcome_unknown',
  'lifecycle.suspend',
  'lifecycle.resume',
]);

const GUEST_MESSAGE_KINDS = new Set([
  'runtime.pong',
  'guest.ready',
  'ui.render',
  'event.subscribe',
  'event.unsubscribe',
  'event.publish',
  'call.start',
  'call.credit',
  'call.cancel',
  'log.write',
]);

const WORKER_PRELUDE = `;(() => {
  'use strict';
  const runtimeGlobal = globalThis;
  const nativePostMessage = runtimeGlobal.postMessage.bind(runtimeGlobal);
  const nativeAddEventListener = runtimeGlobal.addEventListener.bind(runtimeGlobal);
  const deny = (target, name) => {
    let owner = target;
    while (owner) {
      const descriptor = Object.getOwnPropertyDescriptor(owner, name);
      if (descriptor) {
        if (descriptor.configurable) {
          if (!Reflect.deleteProperty(owner, name)) throw new Error('Cannot remove ' + name);
        } else if ('writable' in descriptor && descriptor.writable) {
          if (!Reflect.defineProperty(owner, name, { ...descriptor, value: undefined, writable: false })) {
            throw new Error('Cannot disable ' + name);
          }
        } else if (descriptor.value !== undefined) {
          throw new Error('Cannot disable ' + name);
        }
      }
      owner = Object.getPrototypeOf(owner);
    }
    if (!Reflect.defineProperty(target, name, {
      value: undefined,
      writable: false,
      enumerable: false,
      configurable: false,
    })) throw new Error('Cannot shadow ' + name);
  };
  for (const name of ${JSON.stringify(BLOCKED_WORKER_GLOBALS)}) deny(runtimeGlobal, name);
  if (typeof navigator === 'object') {
    for (const name of ${JSON.stringify(BLOCKED_NAVIGATOR_MEMBERS)}) deny(navigator, name);
  }
  nativeAddEventListener('message', (event) => {
    const message = event.data;
    const payload = message && typeof message === 'object' ? message.payload : undefined;
    if (message && message.v === 1 && message.kind === 'runtime.probe'
      && payload && typeof payload === 'object'
      && Number.isSafeInteger(payload.challenge) && payload.challenge > 0) {
      nativePostMessage({
        v: 1,
        kind: 'runtime.pong',
        payload: { challenge: payload.challenge },
      });
    }
  });
})();\n`;

const GUEST_SCOPE_PREFIX = `;(() => {\n`;
const GUEST_SCOPE_SUFFIX = `\n})();\n`;

interface ReleaseIdentity {
  home_id: string;
  generation: number;
  release: string;
  abi: typeof COMPONENT_ABI;
  sha256: string;
  size: number;
}

interface LoadPayload {
  release: ReleaseIdentity;
  grant: CapabilityRequirements;
  initial_state: Record<string, unknown>;
  state_revision: number;
  staging: boolean;
  locale: string;
  theme: 'light' | 'dark' | 'system';
  artifact: ArrayBuffer;
}

interface InteractionTarget {
  handler: string;
  event: 'press' | 'change';
  disabled: boolean;
  type: string;
  options?: ReadonlySet<string>;
  maxLength?: number;
}

interface OutstandingCall {
  accepted: boolean;
  credit: number;
}

interface BrokerOptions {
  window?: Window;
  parent?: Window;
  workerFactory?: (url: string, options: WorkerOptions) => Worker;
  now?: () => number;
}

function fail(code: string, message: string): never {
  throw new ContractViolation(code, message);
}

function exactRecord(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
  label = 'payload',
): Record<string, unknown> {
  if (!isPlainRecord(value)) fail('bridge_protocol_violation', `${label} must be a plain record`);
  const allowed = new Set([...required, ...optional]);
  for (const key of required) {
    if (!Object.hasOwn(value, key)) fail('bridge_protocol_violation', `${label}.${key} is required`);
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key) || key === '__proto__' || key === 'prototype' || key === 'constructor') {
      fail('bridge_protocol_violation', `${label}.${key} is not allowed`);
    }
  }
  return value;
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    fail('bridge_protocol_violation', `${label} must be a positive safe integer`);
  }
  return value as number;
}

function boundedString(value: unknown, max: number, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || new TextEncoder().encode(value).byteLength > max) {
    fail('bridge_protocol_violation', `${label} is invalid`);
  }
  return value;
}

function bridgeResourceName(value: unknown, label: string): string {
  try {
    return validateResourceName(value, label);
  } catch (error) {
    if (error instanceof ContractViolation) fail('bridge_protocol_violation', error.message);
    throw error;
  }
}

function readNonce(windowObject: Window): string {
  const fragment = new URLSearchParams(windowObject.location.hash.slice(1));
  return assertInstanceId(fragment.get('nonce'));
}

function validateRelease(value: unknown): ReleaseIdentity {
  const record = exactRecord(value, [
    'home_id',
    'generation',
    'release',
    'abi',
    'sha256',
    'size',
  ], [], 'release');
  const abi = record.abi;
  if (abi !== COMPONENT_ABI) fail('worker_boot_failed', 'unsupported component ABI');
  const sha256 = boundedString(record.sha256, 64, 'release.sha256');
  if (!/^[A-Za-z0-9_-]{43}$/u.test(sha256)) fail('worker_boot_failed', 'invalid release digest');
  const size = positiveInteger(record.size, 'release.size');
  if (size > LIMITS.artifactBytes) fail('artifact_too_large', 'artifact exceeds the runtime limit');
  return {
    home_id: boundedString(record.home_id, 128, 'release.home_id'),
    generation: positiveInteger(record.generation, 'release.generation'),
    release: boundedString(record.release, 64, 'release.release'),
    abi,
    sha256,
    size,
  };
}

function validateState(value: unknown, grant: CapabilityRequirements): Record<string, unknown> {
  if (!isPlainRecord(value)) fail('bridge_protocol_violation', 'state must be a plain record');
  const normalized: Record<string, unknown> = Object.create(null);
  for (const [name, stateValue] of Object.entries(value)) {
    bridgeResourceName(name, 'state path');
    if (!isCapabilityGranted(grant.state_read, name)) {
      fail('capability_denied', `State path is not granted: ${name}`);
    }
    measureStructuredValue(stateValue, { allowBinary: true, maxBytes: LIMITS.envelopeBytes });
    normalized[name] = stateValue;
  }
  measureStructuredValue(normalized, { allowBinary: true, maxBytes: LIMITS.envelopeBytes });
  return normalized;
}

function validateLoadPayload(value: unknown): LoadPayload {
  const record = exactRecord(value, [
    'release',
    'grant',
    'initial_state',
    'state_revision',
    'staging',
    'locale',
    'theme',
    'artifact',
  ], [], 'runtime.load');
  let grant: CapabilityRequirements;
  try {
    grant = validateRequirements(record.grant);
  } catch (error) {
    if (error instanceof ContractViolation) {
      fail('bridge_protocol_violation', error.message);
    }
    throw error;
  }
  if (!(record.artifact instanceof ArrayBuffer)) {
    fail('bridge_protocol_violation', 'runtime.load.artifact must be an ArrayBuffer');
  }
  if (typeof record.staging !== 'boolean') fail('bridge_protocol_violation', 'staging must be boolean');
  if (record.theme !== 'light' && record.theme !== 'dark' && record.theme !== 'system') {
    fail('bridge_protocol_violation', 'theme is invalid');
  }
  return {
    release: validateRelease(record.release),
    grant,
    initial_state: validateState(record.initial_state, grant),
    state_revision: positiveInteger(record.state_revision, 'state_revision'),
    staging: record.staging,
    locale: boundedString(record.locale, 64, 'locale'),
    theme: record.theme,
    artifact: record.artifact,
  };
}

function validateGuestMessage(value: unknown): { kind: string; payload: unknown } {
  const record = exactRecord(value, ['v', 'kind', 'payload'], [], 'guest message');
  if (record.v !== BROKER_PROTOCOL) fail('bridge_protocol_violation', 'guest protocol is unsupported');
  if (typeof record.kind !== 'string' || !GUEST_MESSAGE_KINDS.has(record.kind)) {
    fail('bridge_protocol_violation', `guest kind is not allowed: ${String(record.kind)}`);
  }
  measureStructuredValue(record.payload, { allowBinary: true });
  return { kind: record.kind, payload: record.payload };
}

function collectInteractionTargets(root: UiNode): Map<string, InteractionTarget> {
  const targets = new Map<string, InteractionTarget>();
  const stack = [root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    const props = node.props;
    if (node.type === 'button') {
      targets.set(node.id, {
        handler: props.handler as string,
        event: 'press',
        disabled: Boolean(props.disabled || props.pending),
        type: node.type,
      });
    } else if (node.type === 'toggle') {
      targets.set(node.id, {
        handler: props.handler as string,
        event: 'change',
        disabled: Boolean(props.disabled || props.pending),
        type: node.type,
      });
    } else if (node.type === 'input') {
      targets.set(node.id, {
        handler: props.handler as string,
        event: 'change',
        disabled: Boolean(props.disabled),
        type: node.type,
        maxLength: props.max_length as number,
      });
    } else if (node.type === 'select') {
      targets.set(node.id, {
        handler: props.handler as string,
        event: 'change',
        disabled: Boolean(props.disabled),
        type: node.type,
        options: new Set((props.options as Array<{ value: string }>).map((option) => option.value)),
      });
    }
    for (const child of node.children ?? []) stack.push(child);
  }
  return targets;
}

function errorPayload(error: unknown): { code: string; message: string } {
  if (error instanceof ContractViolation) return { code: error.code, message: error.message };
  return {
    code: 'runtime_unresponsive',
    message: error instanceof Error ? error.message : 'Unknown runtime failure',
  };
}

export function startRuntimeBroker(options: BrokerOptions = {}): () => void {
  const windowObject = options.window ?? window;
  const parentObject = options.parent ?? windowObject.parent;
  const makeWorker = options.workerFactory ?? ((url, workerOptions) => new Worker(url, workerOptions));
  const now = options.now ?? (() => performance.now());
  const nonce = readNonce(windowObject);

  let hostPort: MessagePort | undefined;
  let worker: Worker | undefined;
  let workerUrl: string | undefined;
  let instance = '';
  let epoch = 0;
  let expectedHostSeq = 1;
  let outgoingHostSeq = 1;
  let release: ReleaseIdentity | undefined;
  let grant: CapabilityRequirements | undefined;
  let initialState: Record<string, unknown> | undefined;
  let locale = '';
  let theme: LoadPayload['theme'] = 'system';
  let stateRevision = 0;
  let stateStale = false;
  let staging = true;
  let active = false;
  let suspended = false;
  let closed = false;
  let loadStarted = false;
  let launchGeneration = 0;
  let guestReady = false;
  let renderRevision = 0;
  let interactionTargets = new Map<string, InteractionTarget>();
  let bootTimer: ReturnType<typeof setTimeout> | undefined;
  let renderTimer: ReturnType<typeof setTimeout> | undefined;
  let workerHeartbeat: ReturnType<typeof setInterval> | undefined;
  let pendingProbe: number | undefined;
  let missedWorkerHeartbeats = 0;
  let nextProbe = 1;
  const guestMessageTimes: number[] = [];
  const renderTimes: number[] = [];
  const subscriptions = new Set<string>();
  const outstandingCalls = new Map<number, OutstandingCall>();
  const seenOperationIds = new Set<number>();
  let bindListener: ((event: MessageEvent) => void) | undefined;

  const sendHost = (kind: string, payload: unknown): void => {
    if (!hostPort || closed) return;
    const envelope: Envelope = {
      v: BROKER_PROTOCOL,
      instance,
      epoch,
      seq: outgoingHostSeq,
      kind,
      payload,
    };
    outgoingHostSeq += 1;
    hostPort.postMessage(envelope);
  };

  const cleanup = (): void => {
    if (bootTimer) clearTimeout(bootTimer);
    if (renderTimer) clearTimeout(renderTimer);
    if (workerHeartbeat) clearInterval(workerHeartbeat);
    workerHeartbeat = undefined;
    pendingProbe = undefined;
    if (worker) worker.terminate();
    worker = undefined;
    if (workerUrl) URL.revokeObjectURL(workerUrl);
    workerUrl = undefined;
    hostPort?.close();
    hostPort = undefined;
    interactionTargets.clear();
    subscriptions.clear();
    outstandingCalls.clear();
    seenOperationIds.clear();
    if (bindListener) windowObject.removeEventListener('message', bindListener);
    bindListener = undefined;
  };

  const terminate = (error?: unknown): void => {
    if (closed) return;
    if (error) sendHost('runtime.error', errorPayload(error));
    sendHost('runtime.terminated', { reason: error ? errorPayload(error).code : 'disposed' });
    closed = true;
    launchGeneration += 1;
    cleanup();
  };

  const enforceRate = (times: number[], limit: number, label: string): void => {
    const current = now();
    while (times.length > 0 && times[0]! <= current - 1_000) times.shift();
    times.push(current);
    if (times.length > limit) fail('bridge_protocol_violation', `${label} rate exceeded`);
  };

  const sendGuest = (kind: string, payload: unknown): void => {
    if (!worker || closed) return;
    worker.postMessage({ v: BROKER_PROTOCOL, kind, payload });
  };

  const stopWorkerWatchdog = (): void => {
    if (workerHeartbeat) clearInterval(workerHeartbeat);
    workerHeartbeat = undefined;
    pendingProbe = undefined;
    missedWorkerHeartbeats = 0;
  };

  const sendWorkerProbe = (): void => {
    if (!worker || closed || suspended) return;
    pendingProbe = nextProbe;
    nextProbe += 1;
    sendGuest('runtime.probe', { challenge: pendingProbe });
  };

  const startWorkerWatchdog = (): void => {
    if (workerHeartbeat || closed || suspended) return;
    sendWorkerProbe();
    workerHeartbeat = setInterval(() => {
      if (pendingProbe !== undefined) {
        missedWorkerHeartbeats += 1;
        if (missedWorkerHeartbeats >= LIMITS.workerMissedHeartbeats) {
          terminate(new ContractViolation('runtime_unresponsive', 'guest Worker missed heartbeat acknowledgements'));
        }
        return;
      }
      sendWorkerProbe();
    }, LIMITS.workerHeartbeatMs);
  };

  const handleRender = (payload: unknown): void => {
    enforceRate(renderTimes, LIMITS.rendersPerSecond, 'render');
    const record = exactRecord(payload, ['revision', 'tree'], [], 'ui.render');
    const revision = positiveInteger(record.revision, 'ui.render.revision');
    if (revision !== renderRevision + 1) fail('render_invalid', 'render revision is not contiguous');
    const mediaHandles = new Set(
      (grant?.presentation ?? []).filter((pattern) => pattern.startsWith('media.') && !pattern.endsWith('.*')),
    );
    let tree: UiNode;
    try {
      tree = validateUiTree(record.tree, { mediaHandles });
    } catch (error) {
      if (error instanceof ContractViolation && error.code === 'capability_denied') throw error;
      fail('render_invalid', error instanceof Error ? error.message : 'semantic tree is invalid');
    }
    renderRevision = revision;
    interactionTargets = collectInteractionTargets(tree);
    if (renderTimer) clearTimeout(renderTimer);
    sendHost('ui.render', { render_revision: revision, tree });
  };

  const validateGrantedName = (
    payload: unknown,
    kind: keyof Pick<CapabilityRequirements, 'event_subscribe' | 'event_publish' | 'call'>,
    label: string,
  ): { record: Record<string, unknown>; name: string } => {
    const record = isPlainRecord(payload) ? payload : fail('bridge_protocol_violation', `${label} must be a record`);
    const name = bridgeResourceName(record.name, `${label}.name`);
    if (!grant || !isCapabilityGranted(grant[kind], name)) {
      fail('capability_denied', `${label} is not granted: ${name}`);
    }
    return { record, name };
  };

  const handleGuestMessage = (event: MessageEvent): void => {
    try {
      if (event.ports.length > 0) fail('bridge_protocol_violation', 'guest transferred a MessagePort');
      enforceRate(guestMessageTimes, LIMITS.guestMessagesPerSecond, 'guest message');
      const message = validateGuestMessage(event.data);
      if (message.kind === 'runtime.pong') {
        if (!guestReady || pendingProbe === undefined) {
          fail('bridge_protocol_violation', 'unexpected Worker heartbeat acknowledgement');
        }
        const pong = exactRecord(message.payload, ['challenge'], [], 'runtime.pong');
        if (positiveInteger(pong.challenge, 'runtime.pong.challenge') !== pendingProbe) {
          fail('bridge_protocol_violation', 'Worker heartbeat challenge does not match');
        }
        pendingProbe = undefined;
        missedWorkerHeartbeats = 0;
        return;
      }
      if (!guestReady) {
        if (message.kind !== 'guest.ready') fail('worker_boot_failed', 'guest sent data before ready');
        const ready = exactRecord(message.payload, ['abi'], [], 'guest.ready');
        if (ready.abi !== COMPONENT_ABI) fail('worker_boot_failed', 'guest ABI does not match');
        guestReady = true;
        if (bootTimer) clearTimeout(bootTimer);
        sendGuest('guest.boot', {
          home_id: release!.home_id,
          generation: release!.generation,
          release: release!.release,
          abi: COMPONENT_ABI,
          grant,
          staging,
          locale,
          theme,
        });
        sendGuest('state.snapshot', {
          revision: stateRevision,
          values: initialState,
        });
        renderTimer = setTimeout(() => terminate(new ContractViolation('worker_boot_failed', 'first render timed out')), LIMITS.firstRenderMs);
        startWorkerWatchdog();
        sendHost('runtime.worker_ready', { abi: COMPONENT_ABI });
        return;
      }

      switch (message.kind) {
        case 'ui.render':
          handleRender(message.payload);
          break;
        case 'event.subscribe':
        case 'event.unsubscribe': {
          const record = exactRecord(message.payload, ['name'], [], message.kind);
          const checked = validateGrantedName(record, 'event_subscribe', message.kind);
          if (message.kind === 'event.subscribe') subscriptions.add(checked.name);
          else subscriptions.delete(checked.name);
          sendHost(message.kind, { name: checked.name });
          break;
        }
        case 'event.publish': {
          if (!active || staging || suspended) fail('capability_denied', 'runtime cannot publish events in its current state');
          const record = exactRecord(message.payload, ['name', 'data'], [], 'event.publish');
          const checked = validateGrantedName(record, 'event_publish', 'event.publish');
          measureStructuredValue(record.data, { allowBinary: true });
          sendHost('event.publish', { name: checked.name, data: record.data });
          break;
        }
        case 'call.start': {
          if (!active || staging || suspended) fail('capability_denied', 'runtime cannot start calls in its current state');
          const record = exactRecord(message.payload, ['operation_id', 'name', 'args'], ['deadline_ms'], 'call.start');
          const checked = validateGrantedName(record, 'call', 'call.start');
          const operationId = positiveInteger(record.operation_id, 'call.start.operation_id');
          if (seenOperationIds.has(operationId)) fail('bridge_protocol_violation', 'operation_id was already used in this epoch');
          if (outstandingCalls.size >= LIMITS.outstandingCalls) {
            fail('bridge_protocol_violation', 'too many calls are in flight');
          }
          let deadlineMs: number | undefined;
          if (record.deadline_ms !== undefined) {
            deadlineMs = positiveInteger(record.deadline_ms, 'call.start.deadline_ms');
            if (deadlineMs > LIMITS.callDeadlineMs) fail('bridge_protocol_violation', 'call deadline exceeds the limit');
          }
          measureStructuredValue(record.args, { allowBinary: true });
          seenOperationIds.add(operationId);
          outstandingCalls.set(operationId, { accepted: false, credit: 0 });
          sendHost('call.start', {
            operation_id: operationId,
            name: checked.name,
            args: record.args,
            ...(deadlineMs === undefined ? {} : { deadline_ms: deadlineMs }),
          });
          break;
        }
        case 'call.credit':
        case 'call.cancel': {
          if (!active || staging || suspended) fail('capability_denied', 'runtime cannot control calls in its current state');
          const record = exactRecord(message.payload, ['operation_id'], message.kind === 'call.credit' ? ['credit'] : [], message.kind);
          const operationId = positiveInteger(record.operation_id, `${message.kind}.operation_id`);
          const operation = outstandingCalls.get(operationId);
          if (!operation) fail('bridge_protocol_violation', `${message.kind} names an unknown operation`);
          let credit: number | undefined;
          if (message.kind === 'call.credit') {
            credit = positiveInteger(record.credit, 'call.credit.credit');
            if (credit > LIMITS.callCredit || operation.credit + credit > LIMITS.callCredit) {
              fail('bridge_protocol_violation', 'call credit exceeds the limit');
            }
            operation.credit += credit;
          }
          sendHost(message.kind, {
            operation_id: operationId,
            ...(credit === undefined ? {} : { credit }),
          });
          break;
        }
        case 'log.write': {
          const record = exactRecord(message.payload, ['level', 'message'], [], 'log.write');
          if (!['debug', 'info', 'warn', 'error'].includes(String(record.level))) {
            fail('bridge_protocol_violation', 'log level is invalid');
          }
          sendHost('log.write', {
            level: record.level,
            message: boundedString(record.message, 2_048, 'log.write.message'),
          });
          break;
        }
        default:
          fail('bridge_protocol_violation', `guest message is not implemented: ${message.kind}`);
      }
    } catch (error) {
      terminate(error);
    }
  };

  const launchWorker = async (payload: LoadPayload, generation: number): Promise<void> => {
    const bytes = new Uint8Array(payload.artifact);
    await verifyArtifactBytes(payload.release, bytes);
    if (closed || generation !== launchGeneration) return;
    validateGuestProgram(bytes);
    release = payload.release;
    grant = payload.grant;
    initialState = payload.initial_state;
    locale = payload.locale;
    theme = payload.theme;
    stateRevision = payload.state_revision;
    stateStale = false;
    staging = payload.staging;
    const blob = new Blob([
      WORKER_PRELUDE,
      GUEST_SCOPE_PREFIX,
      bytes,
      GUEST_SCOPE_SUFFIX,
    ], { type: 'text/javascript' });
    workerUrl = URL.createObjectURL(blob);
    worker = makeWorker(workerUrl, {
      type: 'classic',
      name: `miakapp-${release.generation}`.slice(0, 64),
    });
    worker.addEventListener('message', handleGuestMessage);
    worker.addEventListener('messageerror', () => terminate(new ContractViolation('bridge_protocol_violation', 'guest message could not be cloned')));
    worker.addEventListener('error', (event) => {
      event.preventDefault();
      terminate(new ContractViolation('worker_boot_failed', 'guest Worker raised an error'));
    });
    bootTimer = setTimeout(() => terminate(new ContractViolation('worker_boot_failed', 'guest ready timed out')), LIMITS.workerBootMs);
  };

  const validateInteraction = (value: unknown): Record<string, unknown> => {
    const record = exactRecord(value, ['render_revision', 'node_id', 'event'], ['value'], 'ui.interaction');
    if (record.render_revision !== renderRevision) fail('render_invalid', 'interaction uses a stale render');
    const nodeId = boundedString(record.node_id, 64, 'ui.interaction.node_id');
    const target = interactionTargets.get(nodeId);
    if (!target || target.disabled || record.event !== target.event) {
      fail('render_invalid', 'interaction target is not active');
    }
    let valuePayload: unknown;
    if (target.type === 'button') {
      if (Object.hasOwn(record, 'value')) fail('render_invalid', 'button interaction cannot carry a value');
    } else if (target.type === 'toggle') {
      if (typeof record.value !== 'boolean') fail('render_invalid', 'toggle interaction value must be boolean');
      valuePayload = record.value;
    } else if (target.type === 'input') {
      if (typeof record.value !== 'string' || record.value.length > (target.maxLength ?? 0)
        || new TextEncoder().encode(record.value).byteLength > LIMITS.inputBytes) {
        fail('render_invalid', 'input interaction value is invalid');
      }
      valuePayload = record.value;
    } else if (target.type === 'select') {
      if (typeof record.value !== 'string' || !target.options?.has(record.value)) {
        fail('render_invalid', 'select interaction value is invalid');
      }
      valuePayload = record.value;
    }
    return {
      render_revision: renderRevision,
      node_id: nodeId,
      handler: target.handler,
      event: target.event,
      ...(valuePayload === undefined ? {} : { value: valuePayload }),
    };
  };

  const handleHostMessage = (event: MessageEvent): void => {
    try {
      if (event.ports.length > 0) fail('bridge_protocol_violation', 'unexpected transferred port');
      const envelope = validateEnvelope(event.data, {
        instance,
        epoch,
        expectedSeq: expectedHostSeq,
        allowedKinds: HOST_MESSAGE_KINDS,
        allowBinary: true,
        maxBytes: event.data?.kind === 'runtime.load'
          ? LIMITS.artifactBytes + LIMITS.envelopeBytes
          : LIMITS.envelopeBytes,
      });
      expectedHostSeq += 1;
      if (envelope.kind === 'runtime.load') {
        if (loadStarted) fail('bridge_protocol_violation', 'runtime.load may occur only once');
        const payload = validateLoadPayload(envelope.payload);
        loadStarted = true;
        launchGeneration += 1;
        const generation = launchGeneration;
        void launchWorker(payload, generation).catch(terminate);
        return;
      }
      if (envelope.kind === 'runtime.dispose') {
        sendGuest('lifecycle.dispose', {});
        terminate();
        return;
      }
      if (!worker || !guestReady) fail('bridge_protocol_violation', 'Worker is not ready');
      switch (envelope.kind) {
        case 'runtime.activate':
          if (renderRevision === 0) fail('bridge_protocol_violation', 'cannot activate before a render');
          staging = false;
          active = true;
          suspended = false;
          sendGuest('lifecycle.resume', { active: true, epoch });
          sendHost('runtime.active', { render_revision: renderRevision });
          break;
        case 'runtime.ping':
          sendHost('runtime.pong', envelope.payload);
          break;
        case 'ui.interaction':
          if (!active || staging || suspended) fail('capability_denied', 'runtime is not active');
          sendGuest('ui.interaction', validateInteraction(envelope.payload));
          break;
        case 'state.snapshot': {
          const record = exactRecord(envelope.payload, ['revision', 'values'], [], 'state.snapshot');
          const revision = positiveInteger(record.revision, 'state.snapshot.revision');
          if (revision < stateRevision) fail('bridge_protocol_violation', 'state snapshot revision moved backward');
          const values = validateState(record.values, grant!);
          stateRevision = revision;
          stateStale = false;
          sendGuest('state.snapshot', {
            revision,
            values,
          });
          break;
        }
        case 'state.patch': {
          const record = exactRecord(envelope.payload, ['base_revision', 'revision', 'mutations'], [], 'state.patch');
          const baseRevision = positiveInteger(record.base_revision, 'state.patch.base_revision');
          const revision = positiveInteger(record.revision, 'state.patch.revision');
          if (baseRevision !== stateRevision || revision !== baseRevision + 1) {
            stateStale = true;
            sendGuest('state.stale', { revision: stateRevision, reason: 'revision_gap' });
            break;
          }
          if (!Array.isArray(record.mutations)) fail('bridge_protocol_violation', 'state.patch.mutations must be an array');
          const mutations = record.mutations.map((mutation, index) => {
            const item = exactRecord(mutation, ['path', 'op'], ['value'], `state.patch.mutations[${index}]`);
            const path = bridgeResourceName(item.path, `state.patch.mutations[${index}].path`);
            if (!grant || !isCapabilityGranted(grant.state_read, path)) {
              fail('capability_denied', `State path is not granted: ${path}`);
            }
            if (item.op !== 'set' && item.op !== 'delete') {
              fail('bridge_protocol_violation', 'state mutation operation is invalid');
            }
            if (item.op === 'set') {
              if (!Object.hasOwn(item, 'value')) fail('bridge_protocol_violation', 'set mutation requires a value');
              measureStructuredValue(item.value, { allowBinary: true });
              return { path, op: 'set', value: item.value };
            }
            if (Object.hasOwn(item, 'value')) fail('bridge_protocol_violation', 'delete mutation forbids a value');
            return { path, op: 'delete' };
          });
          if (stateStale) break;
          stateRevision = revision;
          sendGuest('state.patch', { base_revision: baseRevision, revision, mutations });
          break;
        }
        case 'state.stale': {
          const record = exactRecord(envelope.payload, ['revision', 'reason'], [], 'state.stale');
          stateStale = true;
          sendGuest('state.stale', {
            revision: positiveInteger(record.revision, 'state.stale.revision'),
            reason: boundedString(record.reason, 256, 'state.stale.reason'),
          });
          break;
        }
        case 'event.message': {
          const record = exactRecord(envelope.payload, ['name', 'data'], [], 'event.message');
          const checked = validateGrantedName(record, 'event_subscribe', 'event.message');
          if (!subscriptions.has(checked.name)) fail('capability_denied', 'event topic is not subscribed');
          measureStructuredValue(record.data, { allowBinary: true });
          sendGuest('event.message', { name: checked.name, data: record.data });
          break;
        }
        case 'call.accepted': {
          const record = exactRecord(envelope.payload, ['operation_id'], [], 'call.accepted');
          const operationId = positiveInteger(record.operation_id, 'call.accepted.operation_id');
          const operation = outstandingCalls.get(operationId);
          if (!operation || operation.accepted) fail('bridge_protocol_violation', 'call acceptance is not correlated');
          operation.accepted = true;
          sendGuest('call.accepted', { operation_id: operationId });
          break;
        }
        case 'call.chunk': {
          const record = exactRecord(envelope.payload, ['operation_id', 'value'], [], 'call.chunk');
          const operationId = positiveInteger(record.operation_id, 'call.chunk.operation_id');
          const operation = outstandingCalls.get(operationId);
          if (!operation?.accepted || operation.credit <= 0) {
            fail('bridge_protocol_violation', 'call chunk has no correlated credit');
          }
          measureStructuredValue(record.value, { allowBinary: true });
          operation.credit -= 1;
          sendGuest('call.chunk', { operation_id: operationId, value: record.value });
          break;
        }
        case 'call.result': {
          const record = exactRecord(envelope.payload, ['operation_id', 'value'], [], 'call.result');
          const operationId = positiveInteger(record.operation_id, 'call.result.operation_id');
          if (!outstandingCalls.has(operationId)) fail('bridge_protocol_violation', 'call result is not correlated');
          measureStructuredValue(record.value, { allowBinary: true });
          outstandingCalls.delete(operationId);
          sendGuest('call.result', { operation_id: operationId, value: record.value });
          break;
        }
        case 'call.error': {
          const record = exactRecord(envelope.payload, ['operation_id', 'code', 'message'], ['retryable', 'details'], 'call.error');
          const operationId = positiveInteger(record.operation_id, 'call.error.operation_id');
          if (!outstandingCalls.has(operationId)) fail('bridge_protocol_violation', 'call error is not correlated');
          if (record.retryable !== undefined && typeof record.retryable !== 'boolean') {
            fail('bridge_protocol_violation', 'call.error.retryable must be boolean');
          }
          if (record.details !== undefined) measureStructuredValue(record.details, { allowBinary: true });
          outstandingCalls.delete(operationId);
          sendGuest('call.error', {
            operation_id: operationId,
            code: boundedString(record.code, 128, 'call.error.code'),
            message: boundedString(record.message, 2_048, 'call.error.message'),
            ...(record.retryable === undefined ? {} : { retryable: record.retryable }),
            ...(record.details === undefined ? {} : { details: record.details }),
          });
          break;
        }
        case 'call.outcome_unknown': {
          const record = exactRecord(envelope.payload, ['operation_id'], ['message'], 'call.outcome_unknown');
          const operationId = positiveInteger(record.operation_id, 'call.outcome_unknown.operation_id');
          if (!outstandingCalls.has(operationId)) fail('bridge_protocol_violation', 'call outcome is not correlated');
          outstandingCalls.delete(operationId);
          sendGuest('call.outcome_unknown', {
            operation_id: operationId,
            ...(record.message === undefined
              ? {}
              : { message: boundedString(record.message, 2_048, 'call.outcome_unknown.message') }),
          });
          break;
        }
        case 'lifecycle.suspend':
          if (!active || suspended) fail('bridge_protocol_violation', 'runtime cannot be suspended now');
          suspended = true;
          stopWorkerWatchdog();
          sendGuest('lifecycle.suspend', {});
          break;
        case 'lifecycle.resume':
          if (!active || !suspended) fail('bridge_protocol_violation', 'runtime cannot be resumed now');
          suspended = false;
          sendGuest('lifecycle.resume', { active: true, epoch });
          startWorkerWatchdog();
          break;
        default:
          fail('bridge_protocol_violation', `host message is not implemented: ${envelope.kind}`);
      }
    } catch (error) {
      terminate(error);
    }
  };

  const bind = (event: MessageEvent): void => {
    try {
      if (closed) return;
      if (event.source !== parentObject) return;
      const message = exactRecord(event.data, ['type', 'runtime', 'nonce', 'instance', 'epoch'], [], 'bind');
      if (message.type !== 'miakapp.runtime.bind' || message.runtime !== '1' || message.nonce !== nonce) return;
      if (hostPort || event.ports.length !== 1) fail('runtime_handshake_failed', 'invalid broker port binding');
      instance = assertInstanceId(message.instance);
      epoch = positiveInteger(message.epoch, 'bind.epoch');
      const boundPort = event.ports[0];
      if (!boundPort) fail('runtime_handshake_failed', 'broker port is missing');
      hostPort = boundPort;
      boundPort.addEventListener('message', handleHostMessage);
      boundPort.addEventListener('messageerror', () => terminate(new ContractViolation('bridge_protocol_violation', 'host message could not be cloned')));
      boundPort.start();
      windowObject.removeEventListener('message', bind);
      sendHost('runtime.bound', { runtime: '1' });
    } catch (error) {
      terminate(error);
    }
  };

  windowObject.addEventListener('message', bind);
  bindListener = bind;
  parentObject.postMessage({
    type: 'miakapp.runtime.ready',
    runtime: '1',
    nonce,
  }, '*');

  return () => terminate();
}

if (typeof window !== 'undefined' && window.parent !== window) {
  startRuntimeBroker();
}
