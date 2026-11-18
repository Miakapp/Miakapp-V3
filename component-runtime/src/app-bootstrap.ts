// The fixed bootstrap of `/app.html`, the document a whole-house application
// runs in. It is the only inline script the document's CSP admits; everything
// else it runs is the verified release, loaded from a `blob:` URL it created.
//
// It is not a security boundary against the house: it shares a realm with the
// house code, so the shell treats everything it says as the house speaking. Its
// job is to speak the bridge protocol correctly for a well-behaved house and to
// expose the small `window.miakapp` API that protocol implies. The boundary is
// the browser's: an opaque origin, a CSP without network, and a frame box the
// house cannot draw outside of.


type Listener<T> = (value: T) => void;

interface StateView {
  values: Readonly<Record<string, unknown>>;
  revision: number;
  stale: boolean;
}

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

const NONCE = /^[A-Za-z0-9_-]{16,128}$/u;
const SHARE_RESULTS = new Set(['shared', 'copied', 'cancelled', 'unavailable']);
type ShareResult = 'shared' | 'copied' | 'cancelled' | 'unavailable';

function shareField(value: unknown, max: number, name: string): string {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw new TypeError(`miakapp.share: ${name} must be a string`);
  if (value.length > max) throw new TypeError(`miakapp.share: ${name} is longer than ${max} characters`);
  return value;
}

function shareUrl(value: unknown): string {
  const url = shareField(value, 2_048, 'url');
  if (url === '') return '';
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new TypeError('miakapp.share: url must be an absolute https:// URL');
  }
  if (parsed.protocol !== 'https:' || parsed.username !== '' || parsed.password !== '') {
    throw new TypeError('miakapp.share: url must be an absolute https:// URL');
  }
  return parsed.href;
}

const CALL_ERRORS = new Set(['denied', 'unavailable', 'failed', 'outcome_unknown', 'timeout', 'busy']);

class MiakappCallError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(`The home did not complete the call (${code})`);
    this.name = 'MiakappCallError';
    this.code = code;
  }
}

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '');
}

function matches(patterns: readonly string[], resource: string): boolean {
  return patterns.some((pattern) => (
    pattern === resource
    || (pattern.endsWith('.*') && resource.startsWith(`${pattern.slice(0, -2)}.`))
  ));
}

function freezeDeep<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) freezeDeep((value as Record<string, unknown>)[key]);
  }
  return value;
}

function start(): void {
  const nonce = new URLSearchParams(location.hash.slice(1)).get('nonce');
  if (nonce === null || !NONCE.test(nonce)) return;

  // Captured before any house code exists, so a later prototype patch cannot
  // redirect what the bootstrap itself sends.
  const parentWindow = window.parent;
  let post: ((message: unknown) => void) | undefined;
  let bound = false;
  let installed = false;
  let readySent = false;

  const send = (kind: string, payload: Record<string, unknown> = {}): void => {
    post?.({ v: 1, kind, payload });
  };

  const crash = (reason: 'artifact_integrity' | 'artifact_load' | 'boot_error'): void => {
    if (readySent) return;
    readySent = true;
    send('app.crash', { reason });
  };

  const ready = (): void => {
    if (readySent || !installed) return;
    readySent = true;
    send('app.ready');
  };

  let state: StateView = freezeDeep({ values: {}, revision: 0, stale: true });
  let theme = 'system';
  const stateListeners = new Set<Listener<StateView>>();
  const themeListeners = new Set<Listener<string>>();
  const barListeners = new Set<Listener<string | null>>();
  const calls = new Map<string, PendingCall>();
  const shares = new Map<string, (result: ShareResult) => void>();
  let nextCall = 1;
  let nextShare = 1;

  // Sent only on the resident's own tap, which the shell checks again on its
  // side; without one the answer is 'unavailable' and nothing opens.
  const requestShare = (request: Record<string, unknown>): Promise<ShareResult> => {
    const activation = (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation;
    if ((activation !== undefined && !activation.isActive) || !installed || post === undefined) {
      return Promise.resolve('unavailable');
    }
    const id = `s${nextShare}`;
    nextShare += 1;
    return new Promise((resolve) => {
      shares.set(id, resolve);
      send('share.start', { id, request });
    });
  };
  let grant: { state_read: readonly string[]; call: readonly string[] } = { state_read: [], call: [] };

  const emit = <T>(listeners: Set<Listener<T>>, value: T): void => {
    for (const listener of [...listeners]) {
      try {
        listener(value);
      } catch (error) {
        // A throwing subscriber must not starve the others; surface it as the
        // house's own uncaught error, where its developer will look.
        setTimeout(() => {
          throw error;
        });
      }
    }
  };

  const api = {
    abi: 'miakapp.app/1',
    release: '',
    home: { id: '', name: '' },
    // What the home's link carried (`/h/<id>?invite=…#…`): the app decides
    // what to do with it, for example send the invite to its coordinator.
    link: Object.freeze({ params: Object.freeze({}), hash: '' }) as { readonly params: Readonly<Record<string, string>>; readonly hash: string },
    locale: 'en',
    get theme(): string {
      return theme;
    },
    state: Object.freeze({
      get: (path: string): unknown => state.values[path],
      values: (): Readonly<Record<string, unknown>> => state.values,
      get revision(): number {
        return state.revision;
      },
      get stale(): boolean {
        return state.stale;
      },
      subscribe: (listener: Listener<StateView>): (() => void) => {
        stateListeners.add(listener);
        return () => stateListeners.delete(listener);
      },
    }),
    can: Object.freeze({
      read: (path: string): boolean => matches(grant.state_read, path),
      call: (name: string): boolean => matches(grant.call, name),
    }),
    call: (name: string, args: unknown = null, options: { timeoutMs?: number } = {}): Promise<unknown> => {
      const id = `c${nextCall}`;
      nextCall += 1;
      return new Promise((resolve, reject) => {
        if (!matches(grant.call, name)) {
          reject(new MiakappCallError('denied'));
          return;
        }
        calls.set(id, { resolve, reject });
        send('call.start', {
          id,
          name,
          args: args === undefined ? null : args,
          timeout_ms: Math.max(1, Math.min(300_000, Math.trunc(options.timeoutMs ?? 15_000))),
        });
      });
    },
    // The Miakapp bar: up to two buttons the shell draws for this home. The
    // shell keeps the last list for the next visit, so call it on every start.
    bar: Object.freeze({
      setButtons: (buttons: readonly { id: string; label: string; icon: string; active?: boolean; badge?: number }[]): void => {
        send('bar.buttons', {
          buttons: Array.from(buttons, (button) => ({
            id: String(button.id),
            label: String(button.label),
            icon: String(button.icon),
            active: button.active === true,
            badge: button.badge === undefined ? 0 : Number(button.badge),
          })),
        });
      },
      onSelect: (listener: Listener<string | null>): (() => void) => {
        barListeners.add(listener);
        return () => barListeners.delete(listener);
      },
    }),
    // The frame cannot open the share sheet or write the clipboard: Miakapp
    // does it for the home, on a tap. Resolves 'shared', 'copied',
    // 'cancelled' or 'unavailable' (then show the link so it can be copied).
    share: (data: { title?: string; text?: string; url?: string } = {}): Promise<ShareResult> => {
      const request = {
        action: 'share',
        title: shareField(data.title, 200, 'title'),
        text: shareField(data.text, 2_000, 'text'),
        url: shareUrl(data.url),
      };
      if (request.text === '' && request.url === '') throw new TypeError('miakapp.share: give a text or a url');
      return requestShare(request);
    },
    copy: (text: string): Promise<'copied' | 'unavailable'> => {
      const value = shareField(text, 4_096, 'text');
      if (value === '') throw new TypeError('miakapp.copy: text is empty');
      return requestShare({ action: 'copy', text: value }) as Promise<'copied' | 'unavailable'>;
    },
    onThemeChange: (listener: Listener<string>): (() => void) => {
      themeListeners.add(listener);
      return () => themeListeners.delete(listener);
    },
    ready,
    CallError: MiakappCallError,
  };

  // Before ready, any uncaught failure is a boot failure: the shell shows its
  // own crash screen instead of a half-drawn house. After ready, errors are the
  // house's business and stay in its console.
  window.addEventListener('error', () => crash('boot_error'));
  window.addEventListener('unhandledrejection', () => crash('boot_error'));

  // The keyboard way back to the Miakapp menu. Registered first, in the capture
  // phase, so house listeners cannot see it before it is handled.
  window.addEventListener('keydown', (event) => {
    if (event.altKey && event.shiftKey && event.code === 'KeyM') {
      event.preventDefault();
      event.stopImmediatePropagation();
      send('shell.focus');
    }
  }, true);

  // Everything the API exposes is taken from the load message synchronously,
  // before the digest is awaited, so a state update that arrives during the
  // await is applied on top of it rather than overwritten by it.
  const accept = (payload: Record<string, unknown>): void => {
    const release = payload.release as { release: string };
    const home = payload.home as { id: string; name: string };
    grant = freezeDeep(payload.grant as typeof grant);
    state = freezeDeep(payload.state as StateView);
    theme = String(payload.theme);
    api.release = release.release;
    api.home = Object.freeze({ id: home.id, name: home.name });
    api.locale = String(payload.locale);
    const link = (payload.link ?? {}) as { params?: Record<string, unknown>; hash?: unknown };
    const params: Record<string, string> = {};
    for (const [key, value] of Object.entries(link.params ?? {})) {
      if (typeof value === 'string') params[key] = value;
    }
    api.link = Object.freeze({ params: Object.freeze(params), hash: typeof link.hash === 'string' ? link.hash : '' });
  };

  const load = async (payload: Record<string, unknown>): Promise<void> => {
    const release = payload.release as { sha256: string; size: number };
    const bytes = new Uint8Array(payload.artifact as ArrayBuffer);
    const digest = base64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));
    if (digest !== release.sha256 || bytes.byteLength !== release.size) {
      crash('artifact_integrity');
      return;
    }

    Object.defineProperty(window, 'miakapp', {
      value: Object.freeze(api),
      writable: false,
      configurable: false,
      enumerable: true,
    });
    installed = true;
    document.documentElement.lang = api.locale;
    document.title = api.home.name;
    // An app, not a page: the home's document never rubber-bands and its text
    // is not selectable (no selection handles on a long press), except where
    // residents type. Placed first so the home's own rules can still override it.
    const base = document.createElement('style');
    base.textContent = 'html{touch-action:pan-x pan-y}'
      + 'html,body{overscroll-behavior:none;-webkit-user-select:none;user-select:none;'
      + '-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent}'
      + 'input,textarea,select,[contenteditable]{-webkit-user-select:text;user-select:text}';
    document.head.prepend(base);
    // No zoom inside the home either: Safari's pinch gestures ignore touch-action.
    for (const gesture of ['gesturestart', 'gesturechange', 'gestureend']) {
      document.addEventListener(gesture, (event) => event.preventDefault(), { passive: false });
    }

    // A classic script, because that is what the control plane admits: it parses
    // every release as `sourceType: 'script'` and rejects `import()`. Bundle the
    // house as an IIFE; anything a bundler can inline is allowed.
    const url = URL.createObjectURL(new Blob([bytes], { type: 'text/javascript' }));
    const script = document.createElement('script');
    script.async = false;
    script.src = url;
    script.addEventListener('error', () => crash('artifact_load'));
    script.addEventListener('load', () => {
      URL.revokeObjectURL(url);
      // One task later, so a house that renders synchronously at the end of
      // its script has painted before the shell lifts its loading screen.
      setTimeout(ready, 0);
    });
    document.head.append(script);
  };

  const onPortMessage = (event: MessageEvent): void => {
    const data = event.data as { v?: unknown; kind?: unknown; payload?: Record<string, unknown> };
    if (data === null || typeof data !== 'object' || data.v !== 1 || typeof data.payload !== 'object') return;
    const payload = data.payload;
    switch (data.kind) {
      case 'app.load':
        if (api.release !== '') return;
        accept(payload);
        void load(payload).catch(() => crash('artifact_load'));
        break;
      case 'state.snapshot':
        state = freezeDeep({
          values: payload.values as Record<string, unknown>,
          revision: payload.revision as number,
          stale: false,
        });
        emit(stateListeners, state);
        break;
      case 'state.stale':
        state = freezeDeep({ ...state, revision: payload.revision as number, stale: true });
        emit(stateListeners, state);
        break;
      case 'app.theme':
        theme = String(payload.theme);
        emit(themeListeners, theme);
        break;
      case 'call.settled': {
        const pending = calls.get(String(payload.id));
        if (pending === undefined) return;
        calls.delete(String(payload.id));
        if (payload.ok === true) pending.resolve(freezeDeep(payload.value));
        else {
          const code = String(payload.error);
          pending.reject(new MiakappCallError(CALL_ERRORS.has(code) ? code : 'failed'));
        }
        break;
      }
      case 'share.settled': {
        const settle = shares.get(String(payload.id));
        if (settle === undefined) return;
        shares.delete(String(payload.id));
        const result = String(payload.result);
        settle((SHARE_RESULTS.has(result) ? result : 'unavailable') as ShareResult);
        break;
      }
      case 'bar.select':
        emit(barListeners, typeof payload.id === 'string' ? payload.id : null);
        break;
      case 'app.ping':
        send('app.pong', { challenge: payload.challenge });
        break;
      default:
        break;
    }
  };

  const onBind = (event: MessageEvent): void => {
    if (bound || event.source !== parentWindow) return;
    const data = event.data as Record<string, unknown> | null;
    if (data === null || typeof data !== 'object'
      || data.type !== 'miakapp.app.bind'
      || data.nonce !== nonce
      || event.ports.length !== 1) return;
    bound = true;
    window.removeEventListener('message', onBind);
    const port = event.ports[0]!;
    const postMessage = port.postMessage.bind(port);
    post = (message) => postMessage(message);
    port.addEventListener('message', onPortMessage);
    port.start();
  };

  window.addEventListener('message', onBind);
  parentWindow.postMessage({ type: 'miakapp.app.ready', runtime: '1', nonce }, '*');
}

start();
