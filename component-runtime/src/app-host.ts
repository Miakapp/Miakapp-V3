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
  type AppBarButton,
  type AppCallError,
  type AppShareRequest,
  type AppShareResult,
  type AppTheme,
} from './app-contract';
import { APP_SANDBOX_TOKENS } from './app-document';
import {
  APP_ABI,
  ContractViolation,
  isCapabilityGranted,
  isPatternCovered,
  measureStructuredValue,
  selectGrantedState,
  type CapabilityRequirements,
  type ComponentPointerV1,
} from './contract';

const OPAQUE_ORIGIN = 'null';

/** How long a frame that fired an extra `load` has to prove it is still the verified release. */
const APP_NAVIGATION_PROBE_MS = 2_000;

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
  /** Cancels pending readiness as well as an already-bound session. */
  readonly signal?: AbortSignal;
  readonly sandboxOrigin: string;
  readonly container: HTMLElement;
  readonly home: { readonly id: string; readonly name: string };
  /** Accessible name of the frame, in the shell's language. */
  readonly title: string;
  readonly locale?: string;
  readonly theme?: AppTheme;
  /** What the home's link carried (`?…`, `#…`), handed to the app as `miakapp.link`. */
  readonly link?: { readonly params: Readonly<Record<string, string>>; readonly hash: string };
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
  /** The buttons the home wants in the Miakapp bar, already validated. */
  readonly onBarButtons?: (buttons: readonly AppBarButton[]) => void;
  /**
   * Shares or copies for the home. Runs only while the shell window still has
   * the transient activation of the resident's tap in the frame. Defaults to
   * `shareFromShell` (Web Share, then the clipboard).
   */
  readonly share?: (request: AppShareRequest, hostWindow: Window) => Promise<AppShareResult>;
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
  /** Tells the home which of its bar buttons was tapped; `null` is the home tab. */
  selectBarButton(id: string | null): void;
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

/** A declared entry survives only if the ceiling covers all it would admit. */
function narrow(declared: readonly string[], ceiling: readonly string[] | undefined): string[] {
  if (ceiling === undefined) return [...declared];
  return declared.filter((entry) => {
    try {
      return isPatternCovered(ceiling, entry);
    } catch {
      return false;
    }
  });
}

/** Longest a share sheet may stay open before another request is accepted. */
const SHARE_PENDING_MS = 120_000;

/** Whether the shell still holds a fresh user gesture (browsers without the API: assume yes). */
function hasTransientActivation(hostWindow: Window): boolean {
  const activation = (hostWindow.navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation;
  return activation === undefined || activation.isActive;
}

async function copyFromShell(hostWindow: Window, text: string): Promise<boolean> {
  try {
    if (hostWindow.navigator.clipboard?.writeText) {
      await hostWindow.navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Falls through to the legacy path below.
  }
  const doc = hostWindow.document;
  const area = doc.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none';
  doc.body.append(area);
  try {
    area.select();
    return doc.execCommand('copy');
  } catch {
    return false;
  } finally {
    area.remove();
  }
}

/**
 * The shell's default way to share for a home: the system share sheet when the
 * browser has one, otherwise the clipboard (the link, or the text).
 */
export async function shareFromShell(request: AppShareRequest, hostWindow: Window): Promise<AppShareResult> {
  if (request.action === 'copy') return (await copyFromShell(hostWindow, request.text)) ? 'copied' : 'unavailable';
  const data: ShareData = {};
  if (request.title !== '') data.title = request.title;
  if (request.text !== '') data.text = request.text;
  if (request.url !== '') data.url = request.url;
  const nav = hostWindow.navigator;
  if (typeof nav.share === 'function' && (typeof nav.canShare !== 'function' || nav.canShare(data))) {
    try {
      await nav.share(data);
      return 'shared';
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return 'cancelled';
      // NotAllowedError and friends: the clipboard may still work.
    }
  }
  const fallback = request.url !== '' ? request.url : request.text;
  return (await copyFromShell(hostWindow, fallback)) ? 'copied' : 'unavailable';
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
  if (options.signal?.aborted) return Promise.reject(new DOMException('Mount cancelled', 'AbortError'));
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
  let navigationProbe: number | undefined;
  let navigationTimer: ReturnType<typeof setTimeout> | undefined;
  let windowStart = 0;
  let windowCount = 0;
  let lastFocusRequest = 0;
  let publishedRevision = options.initialState?.revision ?? 0;
  const calls = new Map<string, AbortController>();
  let sharePendingSince = 0;

  const frame = hostDocument.createElement('iframe');

  let removeAbortListener: (() => void) | undefined;
  const cleanup = (): void => {
    removeAbortListener?.();
    removeAbortListener = undefined;
    if (frameTimer) clearTimeout(frameTimer);
    if (bootTimer) clearTimeout(bootTimer);
    if (heartbeat) clearInterval(heartbeat);
    if (navigationTimer) clearTimeout(navigationTimer);
    navigationTimer = undefined;
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

  const startShare = (id: string, request: AppShareRequest): void => {
    const answer = (result: AppShareResult): void => {
      if (lifecycle === 'loading' || lifecycle === 'active') send('share.settled', { id, result });
    };
    const now = Date.now();
    // One sheet at a time, and only on the resident's own tap: a home cannot
    // open share sheets or write the clipboard by itself.
    if (now - sharePendingSince < SHARE_PENDING_MS || !hasTransientActivation(hostWindow)) {
      answer('unavailable');
      return;
    }
    sharePendingSince = now;
    let pending: Promise<AppShareResult>;
    try {
      pending = (options.share ?? shareFromShell)(request, hostWindow);
    } catch (error) {
      pending = Promise.reject(error);
    }
    void pending.then(
      (result) => answer(result),
      () => answer('unavailable'),
    ).finally(() => {
      sharePendingSince = 0;
    });
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
          if (message.challenge === navigationProbe) {
            navigationProbe = undefined;
            if (navigationTimer) clearTimeout(navigationTimer);
            navigationTimer = undefined;
            return;
          }
          if (message.challenge !== pendingProbe) return;
          pendingProbe = undefined;
          missed = 0;
          break;
        case 'call.start':
          if (lifecycle !== 'active' && lifecycle !== 'loading') return;
          startCall(message.id, message.name, message.args, message.timeoutMs);
          break;
        case 'bar.buttons':
          options.onBarButtons?.(message.buttons);
          break;
        case 'share.start':
          if (lifecycle !== 'active') {
            send('share.settled', { id: message.id, result: 'unavailable' });
            return;
          }
          startShare(message.id, message.request);
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
      link: { params: { ...(options.link?.params ?? {}) }, hash: options.link?.hash ?? '' },
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
      // An extra frame load is being checked: that check decides.
      if (navigationProbe !== undefined) return;
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
    const abort = (): void => {
      settle('disposed');
      reject(new DOMException('Mount cancelled', 'AbortError'));
    };
    options.signal?.addEventListener('abort', abort, { once: true });
    removeAbortListener = () => options.signal?.removeEventListener('abort', abort);
    if (options.signal?.aborted) { abort(); return; }
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
      selectBarButton(id) {
        if (port === undefined || (lifecycle !== 'loading' && lifecycle !== 'active')) return;
        send('bar.select', { id });
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
    // A frame that loads a second document navigated away from the bootstrap:
    // whatever it shows now is not the verified release, so it goes. Some
    // engines also fire `load` for same-document history moves (an app's own
    // pushState/back navigation), so first ask the bootstrap over its private
    // port: a new document cannot answer, the verified one can.
    frame.addEventListener('load', () => {
      frameLoads += 1;
      if (frameLoads === 1) return;
      if (port === undefined) {
        settle('crashed', 'navigated');
        return;
      }
      const challenge = nextProbe;
      nextProbe += 1;
      navigationProbe = challenge;
      if (navigationTimer) clearTimeout(navigationTimer);
      navigationTimer = setTimeout(() => {
        if (navigationProbe === challenge) settle('crashed', 'navigated');
      }, APP_NAVIGATION_PROBE_MS);
      send('app.ping', { challenge });
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
