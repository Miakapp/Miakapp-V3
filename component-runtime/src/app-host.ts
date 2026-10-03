// The trusted shell's half of `miakapp.app/1`.
//
// It creates the one visible frame a house application draws in, proves the
// frame is confined before giving it anything, hands it the verified bytes, and
// then answers it only through a private port: the granted slice of home state,
// and calls the grant names, each forwarded to a shell-owned call function.
//
// The shell decides the frame's box. Whatever the house draws stays inside it,
// so the Miakapp controls placed outside that box cannot be covered, restyled
// or removed by the house — not by CSS, z-index, fullscreen or navigation.

import {
  APP_CALL_ERRORS,
  APP_DOCUMENT_PATH,
  APP_LIMITS,
  appShellMessage,
  isAppReadyAnnouncement,
  parseAppFrameMessage,
  type AppCallError,
  type AppTheme,
} from './app-contract';
import { APP_SANDBOX_TOKENS } from './app-document';
import {
  APP_ABI,
  ContractViolation,
  isCapabilityGranted,
  measureStructuredValue,
  selectGrantedState,
  type CapabilityRequirements,
  type ComponentPointerV1,
} from './contract';

const OPAQUE_ORIGIN = 'null';

export const APP_FRAME_PERMISSIONS = "camera 'none'; microphone 'none'; geolocation 'none'; "
  + "display-capture 'none'; fullscreen 'none'; payment 'none'; usb 'none'; "
  + "serial 'none'; hid 'none'; bluetooth 'none'; clipboard-read 'none'; clipboard-write 'none'";

export type HouseAppLifecycle = 'starting' | 'loading' | 'active' | 'crashed' | 'disposed';

/**
 * Closed, shell-authored failure codes. A crash screen names one of these and
 * never anything the house wrote.
 */
export type HouseAppFailureCode =
  | 'abi_mismatch'
  | 'sandbox_origin_invalid'
  | 'sandbox_unreachable'
  | 'boot_timeout'
  | 'artifact_integrity'
  | 'artifact_load'
  | 'boot_error'
  | 'unresponsive'
  | 'navigated'
  | 'protocol_violation';

export class HouseCallError extends Error {
  readonly code: AppCallError;

  constructor(code: AppCallError) {
    super(`house call failed: ${code}`);
    this.name = 'HouseCallError';
    this.code = code;
  }
}

export interface HouseAppState {
  readonly values: Readonly<Record<string, unknown>>;
  readonly revision: number;
  readonly stale: boolean;
}

export interface HouseAppHostOptions {
  readonly sandboxOrigin: string;
  readonly container: HTMLElement;
  readonly home: { readonly id: string; readonly name: string };
  /** Accessible name of the frame, in the shell's language. */
  readonly title: string;
  readonly locale?: string;
  readonly theme?: AppTheme;
  /**
   * Optional deployment ceiling. The effective grant is the release's declared
   * requirements, narrowed by this when present. Residents' rights are still
   * enforced by the coordinator for every call; this only keeps the frame from
   * seeing or asking for what its release never declared.
   */
  readonly policy?: CapabilityRequirements;
  readonly initialState?: HouseAppState;
  readonly call: (name: string, args: unknown, options: { readonly timeoutMs: number; readonly signal: AbortSignal }) => Promise<unknown>;
  readonly onLifecycle: (lifecycle: HouseAppLifecycle, failure?: HouseAppFailureCode) => void;
  readonly onFocusShell?: () => void;
  readonly window?: Window;
  readonly frameReadyMs?: number;
  readonly bootMs?: number;
  readonly heartbeatMs?: number;
  readonly randomId?: () => string;
}

export interface HouseAppRelease {
  readonly pointer: ComponentPointerV1;
  readonly artifact: { readonly bytes: Uint8Array };
}

export interface HouseAppSession {
  readonly lifecycle: HouseAppLifecycle;
  readonly frame: HTMLIFrameElement;
  publishState(state: HouseAppState): void;
  setTheme(theme: AppTheme): void;
  dispose(): void;
}

function randomId(bytes = 24): string {
  const value = crypto.getRandomValues(new Uint8Array(bytes));
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '');
}

function assertSandboxOrigin(value: string, hostOrigin: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new ContractViolation('sandbox_origin_invalid', 'sandbox origin is not a URL');
  }
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLoopback(parsed.hostname))) {
    throw new ContractViolation('sandbox_origin_invalid', 'sandbox origin must be HTTPS');
  }
  if (parsed.origin !== value.replace(/\/+$/u, '')) {
    throw new ContractViolation('sandbox_origin_invalid', 'sandbox origin must carry no path');
  }
  if (parsed.origin === hostOrigin) {
    throw new ContractViolation('sandbox_origin_invalid', 'sandbox origin must differ from the host origin');
  }
  return parsed.origin;
}

/** Loopback HTTP is accepted only so the browser corpus can run locally. */
function isLoopback(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

/** A wildcard survives only if the ceiling names the same wildcard. */
function narrow(declared: readonly string[], ceiling: readonly string[] | undefined): string[] {
  if (ceiling === undefined) return [...declared];
  return declared.filter((entry) => {
    if (entry.endsWith('.*')) return ceiling.includes(entry);
    try {
      return isCapabilityGranted(ceiling, entry);
    } catch {
      return false;
    }
  });
}

function toCallError(error: unknown): AppCallError {
  if (error instanceof HouseCallError) return error.code;
  if (error instanceof DOMException && error.name === 'AbortError') return 'timeout';
  return 'failed';
}

/**
 * Mounts a house application. Resolves once the frame proved it is confined and
 * the port is bound; the lifecycle callback reports everything after that.
 * Rejects only when the frame could not be bound at all, after reporting the
 * same failure through `onLifecycle`.
 */
export function mountHouseApp(
  release: HouseAppRelease,
  options: HouseAppHostOptions,
): Promise<HouseAppSession> {
  const hostWindow = options.window ?? window;
  const hostDocument = hostWindow.document;
  if (release.pointer.abi !== APP_ABI) {
    options.onLifecycle('crashed', 'abi_mismatch');
    return Promise.reject(new ContractViolation('abi_mismatch', 'release is not a house application'));
  }
  let sandboxOrigin: string;
  try {
    sandboxOrigin = assertSandboxOrigin(options.sandboxOrigin, hostWindow.location.origin);
  } catch (error) {
    options.onLifecycle('crashed', 'sandbox_origin_invalid');
    return Promise.reject(error);
  }

  const newId = options.randomId ?? randomId;
  const nonce = newId();
  const grant = Object.freeze({
    state_read: Object.freeze(narrow(release.pointer.requires.state_read, options.policy?.state_read)),
    call: Object.freeze(narrow(release.pointer.requires.call, options.policy?.call)),
  });
  const heartbeatMs = options.heartbeatMs ?? APP_LIMITS.heartbeatMs;

  let lifecycle: HouseAppLifecycle = 'starting';
  let port: MessagePort | undefined;
  let readyListener: ((event: MessageEvent) => void) | undefined;
  let frameTimer: ReturnType<typeof setTimeout> | undefined;
  let bootTimer: ReturnType<typeof setTimeout> | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let pendingProbe: number | undefined;
  let nextProbe = 1;
  let missed = 0;
  let frameLoads = 0;
  let windowStart = 0;
  let windowCount = 0;
  let lastFocusRequest = 0;
  let publishedRevision = options.initialState?.revision ?? 0;
  const calls = new Map<string, AbortController>();

  const frame = hostDocument.createElement('iframe');

  const cleanup = (): void => {
    if (frameTimer) clearTimeout(frameTimer);
    if (bootTimer) clearTimeout(bootTimer);
    if (heartbeat) clearInterval(heartbeat);
    frameTimer = undefined;
    bootTimer = undefined;
    heartbeat = undefined;
    if (readyListener) hostWindow.removeEventListener('message', readyListener);
    readyListener = undefined;
    for (const controller of calls.values()) controller.abort();
    calls.clear();
    port?.close();
    port = undefined;
    // Removing the frame is what actually stops a runaway house: its document,
    // timers and workers go with it.
    frame.remove();
  };

  const settle = (next: 'crashed' | 'disposed', failure?: HouseAppFailureCode): void => {
    if (lifecycle === 'crashed' || lifecycle === 'disposed') return;
    lifecycle = next;
    cleanup();
    options.onLifecycle(next, failure);
  };

  const send = (kind: string, payload: Record<string, unknown>, transfer: Transferable[] = []): void => {
    port?.postMessage(appShellMessage(kind, payload), transfer);
  };

  const settleCall = (id: string, outcome: { ok: true; value: unknown } | { ok: false; error: AppCallError }): void => {
    if (!calls.has(id)) return;
    calls.delete(id);
    if (outcome.ok) {
      try {
        measureStructuredValue(outcome.value, { maxBytes: APP_LIMITS.messageBytes });
      } catch {
        send('call.settled', { id, ok: false, error: 'failed' });
        return;
      }
      send('call.settled', { id, ok: true, value: outcome.value ?? null });
    } else {
      send('call.settled', { id, ok: false, error: outcome.error });
    }
  };

  const startCall = (id: string, name: string, args: unknown, timeoutMs: number): void => {
    if (calls.has(id)) throw new ContractViolation('bridge_protocol_violation', 'call id reused');
    const controller = new AbortController();
    calls.set(id, controller);
    if (!isCapabilityGranted(grant.call, name)) {
      settleCall(id, { ok: false, error: 'denied' });
      return;
    }
    if (calls.size > APP_LIMITS.outstandingCalls) {
      settleCall(id, { ok: false, error: 'busy' });
      return;
    }
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let pending: Promise<unknown>;
    try {
      pending = options.call(name, args, { timeoutMs, signal: controller.signal });
    } catch (error) {
      pending = Promise.reject(error);
    }
    void pending.then(
      (value) => settleCall(id, { ok: true, value }),
      (error: unknown) => settleCall(id, {
        ok: false,
        error: controller.signal.aborted ? 'timeout' : toCallError(error),
      }),
    ).finally(() => clearTimeout(timer));
  };

  const onPortMessage = (event: MessageEvent): void => {
    if (lifecycle === 'crashed' || lifecycle === 'disposed') return;
    try {
      const now = Date.now();
      if (now - windowStart >= 1_000) {
        windowStart = now;
        windowCount = 0;
      }
      windowCount += 1;
      if (windowCount > APP_LIMITS.messagesPerSecond) {
        throw new ContractViolation('bridge_protocol_violation', 'house app exceeded its message rate');
      }
      if (event.ports.length > 0) {
        throw new ContractViolation('bridge_protocol_violation', 'house app transferred a port');
      }
      const message = parseAppFrameMessage(event.data);
      switch (message.kind) {
        case 'app.ready':
          if (lifecycle !== 'loading') return;
          if (bootTimer) clearTimeout(bootTimer);
          bootTimer = undefined;
          lifecycle = 'active';
          options.onLifecycle('active');
          break;
        case 'app.crash':
          settle('crashed', message.reason);
          break;
        case 'app.pong':
          if (message.challenge !== pendingProbe) return;
          pendingProbe = undefined;
          missed = 0;
          break;
        case 'call.start':
          if (lifecycle !== 'active' && lifecycle !== 'loading') return;
          startCall(message.id, message.name, message.args, message.timeoutMs);
          break;
        case 'shell.focus':
          // Rate-limited: a house cannot use it to keep yanking focus away.
          if (now - lastFocusRequest < 1_000) return;
          lastFocusRequest = now;
          options.onFocusShell?.();
          break;
      }
    } catch {
      settle('crashed', 'protocol_violation');
    }
  };

  const load = (): void => {
    const bytes = release.artifact.bytes.slice();
    const initial = options.initialState;
    send('app.load', {
      release: {
        home_id: release.pointer.home_id,
        release: release.pointer.release,
        sha256: release.pointer.sha256,
        size: release.pointer.size,
      },
      home: { id: options.home.id, name: options.home.name },
      locale: options.locale ?? 'en',
      theme: options.theme ?? 'system',
      grant: { state_read: [...grant.state_read], call: [...grant.call] },
      state: initial === undefined
        ? { values: {}, revision: 0, stale: true }
        : {
          values: selectGrantedState(initial.values, grant.state_read),
          revision: initial.revision,
          stale: initial.stale,
        },
      artifact: bytes.buffer,
    }, [bytes.buffer]);
    lifecycle = 'loading';
    options.onLifecycle('loading');
    bootTimer = setTimeout(() => settle('crashed', 'boot_timeout'), options.bootMs ?? APP_LIMITS.bootMs);
    heartbeat = setInterval(() => {
      if (pendingProbe !== undefined) {
        missed += 1;
        if (missed >= APP_LIMITS.missedHeartbeats) settle('crashed', 'unresponsive');
        return;
      }
      pendingProbe = nextProbe;
      nextProbe += 1;
      send('app.ping', { challenge: pendingProbe });
    }, heartbeatMs);
  };

  return new Promise<HouseAppSession>((resolve, reject) => {
    const session: HouseAppSession = {
      get lifecycle() {
        return lifecycle;
      },
      frame,
      publishState(state) {
        if (port === undefined || (lifecycle !== 'loading' && lifecycle !== 'active')) return;
        if (!Number.isSafeInteger(state.revision) || state.revision < publishedRevision) return;
        publishedRevision = state.revision;
        if (state.stale) {
          send('state.stale', { revision: state.revision });
          return;
        }
        send('state.snapshot', {
          revision: state.revision,
          values: selectGrantedState(state.values, grant.state_read),
        });
      },
      setTheme(theme) {
        send('app.theme', { theme });
      },
      dispose() {
        settle('disposed');
      },
    };

    frame.className = 'house-app-frame';
    frame.title = options.title;
    frame.setAttribute('sandbox', APP_SANDBOX_TOKENS.join(' '));
    frame.setAttribute('allow', APP_FRAME_PERMISSIONS);
    frame.setAttribute('referrerpolicy', 'no-referrer');
    frame.setAttribute('loading', 'eager');
    // A frame that loads a second document navigated away from the bootstrap.
    // Whatever it shows now is not the verified release, so it goes.
    frame.addEventListener('load', () => {
      frameLoads += 1;
      if (frameLoads > 1) settle('crashed', 'navigated');
    });
    frame.src = `${sandboxOrigin}${APP_DOCUMENT_PATH}#nonce=${nonce}`;

    frameTimer = setTimeout(() => {
      const failure = new ContractViolation('sandbox_unreachable', 'house frame did not announce readiness');
      settle('crashed', 'sandbox_unreachable');
      reject(failure);
    }, options.frameReadyMs ?? APP_LIMITS.frameReadyMs);

    readyListener = (event: MessageEvent): void => {
      if (event.source !== frame.contentWindow || !isAppReadyAnnouncement(event.data, nonce)) return;
      if (frameTimer) clearTimeout(frameTimer);
      frameTimer = undefined;
      hostWindow.removeEventListener('message', readyListener!);
      readyListener = undefined;
      if (event.origin !== OPAQUE_ORIGIN) {
        settle('crashed', 'sandbox_origin_invalid');
        reject(new ContractViolation('sandbox_origin_invalid', 'house frame is not confined to an opaque origin'));
        return;
      }
      const channel = new MessageChannel();
      port = channel.port1;
      port.addEventListener('message', onPortMessage);
      port.start();
      frame.contentWindow!.postMessage({ type: 'miakapp.app.bind', nonce }, '*', [channel.port2]);
      load();
      resolve(session);
    };

    hostWindow.addEventListener('message', readyListener);
    options.container.append(frame);
    options.onLifecycle('starting');
  });
}

export { APP_CALL_ERRORS };
