import {
  BROKER_PROTOCOL,
  COMPONENT_ABI,
  ContractViolation,
  LIMITS,
  isCapabilityGranted,
  isPlainRecord,
  validateEnvelope,
  validateRequirements,
  type CapabilityRequirements,
  type ComponentPointerV1,
  type Envelope,
} from '../../component-runtime/src/contract';

const BROKER_MESSAGE_KINDS = new Set([
  'runtime.bound',
  'runtime.worker_ready',
  'runtime.active',
  'runtime.pong',
  'runtime.error',
  'runtime.terminated',
  'ui.render',
  'event.subscribe',
  'event.unsubscribe',
  'event.publish',
  'call.start',
  'call.credit',
  'call.cancel',
  'log.write',
]);

/**
 * A sandboxed frame created with `allow-scripts` and without `allow-same-origin`
 * has an opaque origin, so every message it sends reports this origin. A frame
 * that reports anything else is not confined and must not be bound.
 */
const OPAQUE_ORIGIN = 'null';

const FRAME_PERMISSIONS = "camera 'none'; microphone 'none'; geolocation 'none'; "
  + "display-capture 'none'; fullscreen 'none'; payment 'none'; usb 'none'; "
  + "serial 'none'; hid 'none'; bluetooth 'none'; clipboard-read 'none'; clipboard-write 'none'";

/** The host grants nothing until a deployment declares a policy. */
export const DENY_ALL_CAPABILITIES: CapabilityRequirements = Object.freeze({
  state_read: [],
  event_subscribe: [],
  event_publish: [],
  call: [],
  presentation: [],
});

export type RuntimeLifecycle =
  | 'starting'
  | 'bound'
  | 'staging'
  | 'active'
  | 'failed'
  | 'terminated';

export interface RuntimeFailure {
  readonly code: string;
  readonly message: string;
}

export interface ComponentRuntimeHostOptions {
  /** Origin of the dedicated sandbox site, declared by the deployment. */
  readonly sandboxOrigin: string;
  /** Ceiling the deployment allows; the effective grant is this intersected with the release. */
  readonly policy?: CapabilityRequirements;
  readonly onTree: (tree: unknown, revision: number) => void;
  readonly onLifecycle: (lifecycle: RuntimeLifecycle, failure?: RuntimeFailure) => void;
  readonly initialState?: Record<string, unknown>;
  readonly stateRevision?: number;
  readonly staging?: boolean;
  readonly locale?: string;
  readonly theme?: 'light' | 'dark' | 'system';
  readonly window?: Window;
  readonly container?: HTMLElement;
  readonly readyTimeoutMs?: number;
  readonly randomId?: () => string;
}

export interface ComponentRuntimeRelease {
  readonly pointer: ComponentPointerV1;
  readonly artifact: { readonly bytes: Uint8Array };
}

export interface ComponentRuntimeSession {
  readonly lifecycle: RuntimeLifecycle;
  interact(nodeId: string, event: string, value?: unknown): void;
  dispose(): void;
}

function randomId(bytes = 24): string {
  const value = crypto.getRandomValues(new Uint8Array(bytes));
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '');
}

function isReadyAnnouncement(value: unknown, nonce: string): boolean {
  if (!isPlainRecord(value)) return false;
  const keys = Object.keys(value).sort();
  return keys.length === 3
    && keys[0] === 'nonce'
    && keys[1] === 'runtime'
    && keys[2] === 'type'
    && value.type === 'miakapp.runtime.ready'
    && value.runtime === '1'
    && value.nonce === nonce;
}

/**
 * The sandbox site is a trust boundary: it must be a bare HTTPS origin that is
 * not the origin holding the session. Serving the broker from the trusted origin
 * would put home-authored code one misconfigured header away from the session.
 */
export function assertSandboxOrigin(value: string, hostOrigin: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new ContractViolation('sandbox_origin_invalid', 'sandbox origin is not a URL');
  }
  if (parsed.protocol !== 'https:') {
    throw new ContractViolation('sandbox_origin_invalid', 'sandbox origin must be HTTPS');
  }
  if (parsed.origin !== value.replace(/\/+$/u, '')) {
    throw new ContractViolation('sandbox_origin_invalid', 'sandbox origin must carry no path, query or fragment');
  }
  if (parsed.origin === hostOrigin) {
    throw new ContractViolation('sandbox_origin_invalid', 'sandbox origin must differ from the host origin');
  }
  return parsed.origin;
}

function intersectList(required: readonly string[], allowed: readonly string[]): string[] {
  return required.filter((entry) => isCapabilityGranted(allowed, entry));
}

/**
 * The grant never exceeds what the deployment allows, and never exceeds what the
 * release declared it needs. A release that widens its requirements after the
 * policy was written gains nothing.
 */
export function intersectCapabilities(
  required: CapabilityRequirements,
  policy: CapabilityRequirements,
): CapabilityRequirements {
  return validateRequirements({
    state_read: intersectList(required.state_read, policy.state_read),
    event_subscribe: intersectList(required.event_subscribe, policy.event_subscribe),
    event_publish: intersectList(required.event_publish, policy.event_publish),
    call: intersectList(required.call, policy.call),
    presentation: intersectList(required.presentation, policy.presentation),
  });
}

export function mountComponentRuntime(
  release: ComponentRuntimeRelease,
  options: ComponentRuntimeHostOptions,
): Promise<ComponentRuntimeSession> {
  const hostWindow = options.window ?? window;
  const hostDocument = hostWindow.document;
  const container = options.container ?? hostDocument.body;
  const newId = options.randomId ?? randomId;
  const readyTimeoutMs = options.readyTimeoutMs ?? LIMITS.workerBootMs;
  const sandboxOrigin = assertSandboxOrigin(options.sandboxOrigin, hostWindow.location.origin);
  const grant = intersectCapabilities(release.pointer.requires, options.policy ?? DENY_ALL_CAPABILITIES);

  const instance = newId();
  const nonce = newId();
  const epoch = 1;
  let outgoingSeq = 1;
  let expectedBrokerSeq = 1;
  let renderRevision = 0;
  let lifecycle: RuntimeLifecycle = 'starting';
  let port: MessagePort | undefined;
  let frame: HTMLIFrameElement | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let readyTimer: ReturnType<typeof setTimeout> | undefined;
  let pendingProbe: number | undefined;
  let nextProbe = 1;
  let missedHeartbeats = 0;
  let readyListener: ((event: MessageEvent) => void) | undefined;
  let disposed = false;

  const cleanup = (): void => {
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = undefined;
    if (readyTimer) clearTimeout(readyTimer);
    readyTimer = undefined;
    if (readyListener) hostWindow.removeEventListener('message', readyListener);
    readyListener = undefined;
    port?.close();
    port = undefined;
    frame?.remove();
    frame = undefined;
  };

  const settle = (next: RuntimeLifecycle, failure?: RuntimeFailure): void => {
    if (disposed) return;
    disposed = true;
    lifecycle = next;
    cleanup();
    options.onLifecycle(next, failure);
  };

  const fail = (error: unknown): void => {
    const failure: RuntimeFailure = error instanceof ContractViolation
      ? { code: error.code, message: error.message }
      : {
        code: 'bridge_protocol_violation',
        message: error instanceof Error ? error.message : 'Unknown runtime failure',
      };
    settle('failed', failure);
  };

  const send = (kind: string, payload: unknown, transfer: Transferable[] = []): void => {
    if (!port || disposed) return;
    const envelope: Envelope = {
      v: BROKER_PROTOCOL,
      instance,
      epoch,
      seq: outgoingSeq,
      kind,
      payload,
    };
    outgoingSeq += 1;
    port.postMessage(envelope, transfer);
  };

  const enter = (next: RuntimeLifecycle): void => {
    lifecycle = next;
    options.onLifecycle(next);
  };

  const load = (): void => {
    const bytes = release.artifact.bytes.slice();
    send('runtime.load', {
      release: {
        home_id: release.pointer.home_id,
        generation: release.pointer.generation,
        release: release.pointer.release,
        abi: COMPONENT_ABI,
        sha256: release.pointer.sha256,
        size: release.pointer.size,
      },
      grant,
      initial_state: options.initialState ?? {},
      state_revision: options.stateRevision ?? 1,
      staging: options.staging ?? false,
      locale: options.locale ?? 'en',
      theme: options.theme ?? 'system',
      artifact: bytes.buffer,
    }, [bytes.buffer]);

    heartbeat = setInterval(() => {
      if (!port || (lifecycle !== 'staging' && lifecycle !== 'active')) return;
      if (pendingProbe !== undefined) {
        missedHeartbeats += 1;
        if (missedHeartbeats >= LIMITS.missedHeartbeats) {
          fail(new ContractViolation('runtime_unresponsive', 'runtime broker missed heartbeat acknowledgements'));
        }
        return;
      }
      pendingProbe = nextProbe;
      nextProbe += 1;
      send('runtime.ping', { challenge: pendingProbe });
    }, LIMITS.heartbeatMs);
  };

  const handleBrokerMessage = (event: MessageEvent): void => {
    try {
      if (event.ports.length > 0) {
        throw new ContractViolation('bridge_protocol_violation', 'broker transferred a port');
      }
      const envelope = validateEnvelope(event.data, {
        instance,
        epoch,
        expectedSeq: expectedBrokerSeq,
        allowedKinds: BROKER_MESSAGE_KINDS,
        allowBinary: true,
      });
      expectedBrokerSeq += 1;
      const payload = envelope.payload as Record<string, unknown>;
      switch (envelope.kind) {
        case 'runtime.bound':
          enter('bound');
          load();
          break;
        case 'runtime.worker_ready':
          enter('staging');
          break;
        case 'ui.render': {
          const revision = payload.render_revision;
          if (!Number.isSafeInteger(revision) || (revision as number) !== renderRevision + 1) {
            throw new ContractViolation('render_invalid', 'host render revision is invalid');
          }
          renderRevision = revision as number;
          options.onTree(payload.tree, renderRevision);
          if (lifecycle === 'staging') send('runtime.activate', {});
          break;
        }
        case 'runtime.active':
          enter('active');
          break;
        case 'runtime.pong': {
          if (!isPlainRecord(payload)
            || Object.keys(payload).length !== 1
            || !Number.isSafeInteger(payload.challenge)
            || payload.challenge !== pendingProbe) {
            throw new ContractViolation('bridge_protocol_violation', 'broker heartbeat acknowledgement is invalid');
          }
          pendingProbe = undefined;
          missedHeartbeats = 0;
          break;
        }
        case 'call.start':
          throw new ContractViolation('capability_denied', 'host has no call broker for this release');
        case 'event.publish':
          throw new ContractViolation('capability_denied', 'host has no event sink for this release');
        case 'event.subscribe':
        case 'event.unsubscribe':
        case 'call.credit':
        case 'call.cancel':
        case 'log.write':
          break;
        case 'runtime.error':
          settle('failed', {
            code: String(payload.code ?? 'runtime_unresponsive'),
            message: String(payload.message ?? 'The component runtime failed'),
          });
          break;
        case 'runtime.terminated':
          settle('terminated');
          break;
        default:
          break;
      }
    } catch (error) {
      fail(error);
    }
  };

  return new Promise<ComponentRuntimeSession>((resolve, reject) => {
    const session: ComponentRuntimeSession = {
      get lifecycle() {
        return lifecycle;
      },
      interact(nodeId, event, value) {
        if (lifecycle !== 'active' && lifecycle !== 'staging') return;
        send('ui.interaction', {
          render_revision: renderRevision,
          node_id: nodeId,
          event,
          ...(value === undefined ? {} : { value }),
        });
      },
      dispose() {
        if (disposed) return;
        send('runtime.dispose', {});
        settle('terminated');
      },
    };

    const element = hostDocument.createElement('iframe');
    element.hidden = true;
    element.tabIndex = -1;
    element.setAttribute('aria-hidden', 'true');
    element.setAttribute('sandbox', 'allow-scripts');
    element.setAttribute('referrerpolicy', 'no-referrer');
    element.setAttribute('allow', FRAME_PERMISSIONS);
    element.src = `${sandboxOrigin}/sandbox.html#nonce=${nonce}`;
    frame = element;

    readyTimer = setTimeout(() => {
      const failure = new ContractViolation('ready_timeout', 'sandbox frame did not announce readiness');
      fail(failure);
      reject(failure);
    }, readyTimeoutMs);

    readyListener = (event: MessageEvent): void => {
      if (event.source !== element.contentWindow) return;
      if (!isReadyAnnouncement(event.data, nonce)) return;
      if (event.origin !== OPAQUE_ORIGIN) {
        const failure = new ContractViolation('sandbox_origin_invalid', 'sandbox frame is not confined to an opaque origin');
        fail(failure);
        reject(failure);
        return;
      }
      if (readyTimer) clearTimeout(readyTimer);
      readyTimer = undefined;
      hostWindow.removeEventListener('message', readyListener!);
      readyListener = undefined;

      const channel = new MessageChannel();
      const bound = channel.port1;
      port = bound;
      bound.addEventListener('message', (message) => {
        if (port === bound) handleBrokerMessage(message);
      });
      bound.start();
      element.contentWindow!.postMessage({
        type: 'miakapp.runtime.bind',
        runtime: '1',
        nonce,
        instance,
        epoch,
      }, '*', [channel.port2]);
      resolve(session);
    };

    hostWindow.addEventListener('message', readyListener);
    container.append(element);
  });
}
