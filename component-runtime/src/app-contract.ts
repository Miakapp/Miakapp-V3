// The `miakapp.app/1` bridge: what crosses the port between the trusted shell
// and a whole-house application running in its opaque-origin frame.
//
// An app release draws itself — any DOM, CSS, layout, routing or
// bundled library — inside a frame the shell sizes and owns. What it cannot do
// is reach anything the shell did not hand it: the frame has no origin, no
// network, no storage shared with anyone, and this port is its only way out.
//
// Everything a frame sends is validated here as untrusted input. The bootstrap
// that speaks the frame's half of the protocol runs in the same realm as the
// house code, so nothing it says carries more authority than the house does.

import {
  ContractViolation,
  LIMITS,
  isPlainRecord,
  measureStructuredValue,
  validateResourceName,
} from './contract';

export const APP_BRIDGE_PROTOCOL = 1 as const;

/** The path the shell frames; the sandbox site serves the bootstrap there. */
export const APP_DOCUMENT_PATH = '/app.html' as const;

export const APP_LIMITS = Object.freeze({
  /** Frame announcement: the sandbox site must answer quickly or it is down. */
  frameReadyMs: 10_000,
  /** From artifact delivery to the app declaring its first screen. */
  bootMs: 15_000,
  heartbeatMs: 4_000,
  missedHeartbeats: 3,
  outstandingCalls: LIMITS.outstandingCalls,
  callDeadlineMs: LIMITS.callDeadlineMs,
  defaultCallDeadlineMs: 15_000,
  messagesPerSecond: LIMITS.guestMessagesPerSecond,
  messageBytes: 65_536,
});

/** Messages the frame may send. Anything else ends the session. */
export type AppFrameMessage =
  | { readonly kind: 'app.ready' }
  | { readonly kind: 'app.crash'; readonly reason: AppCrashReason }
  | { readonly kind: 'app.pong'; readonly challenge: number }
  | {
    readonly kind: 'call.start';
    readonly id: string;
    readonly name: string;
    readonly args: unknown;
    readonly timeoutMs: number;
  }
  | { readonly kind: 'shell.focus' }
  | { readonly kind: 'bar.buttons'; readonly buttons: readonly AppBarButton[] }
  | { readonly kind: 'share.start'; readonly id: string; readonly request: AppShareRequest };

/**
 * What a home asks Miakapp to share or copy. The frame cannot reach
 * `navigator.share` or the clipboard (its sandbox and Permissions-Policy deny
 * both), so the shell does it, only while the resident's tap is still fresh.
 */
export type AppShareRequest =
  | { readonly action: 'share'; readonly title: string; readonly text: string; readonly url: string }
  | { readonly action: 'copy'; readonly text: string };

/** Closed outcome vocabulary, mirrored by the bootstrap and the SDK. */
export const APP_SHARE_RESULTS = ['shared', 'copied', 'cancelled', 'unavailable'] as const;
export type AppShareResult = (typeof APP_SHARE_RESULTS)[number];

export const APP_SHARE_LIMITS = Object.freeze({ title: 200, text: 2_000, url: 2_048, copy: 4_096 });

function shareString(value: unknown, max: number, name: string): string {
  if (typeof value !== 'string' || value.length > max) violation(`share ${name} is invalid`);
  return value;
}

/** Only absolute HTTPS links leave the frame; '' means no link. */
export function isShareableUrl(value: string): boolean {
  if (value === '') return true;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.href.length <= APP_SHARE_LIMITS.url && url.username === '' && url.password === '';
  } catch {
    return false;
  }
}

/** Validates a share or copy request; throws `ContractViolation` otherwise. */
export function parseShareRequest(value: unknown): AppShareRequest {
  if (!isPlainRecord(value)) violation('share request must be a plain record');
  if (value.action === 'copy') {
    exactKeys(value, ['action', 'text']);
    const text = shareString(value.text, APP_SHARE_LIMITS.copy, 'text');
    if (text === '') violation('copy text is empty');
    return Object.freeze({ action: 'copy', text });
  }
  if (value.action !== 'share') violation('share action is invalid');
  exactKeys(value, ['action', 'title', 'text', 'url']);
  const title = shareString(value.title, APP_SHARE_LIMITS.title, 'title');
  const text = shareString(value.text, APP_SHARE_LIMITS.text, 'text');
  const url = shareString(value.url, APP_SHARE_LIMITS.url, 'url');
  if (!isShareableUrl(url)) violation('share url must be https');
  if (text === '' && url === '') violation('share needs a text or a url');
  return Object.freeze({ action: 'share', title, text, url });
}

/**
 * The few buttons a home adds to the Miakapp bar. Miakapp draws them: the home
 * names them, picks an icon from a closed list, and hears which one was tapped.
 */
export interface AppBarButton {
  readonly id: string;
  readonly label: string;
  readonly icon: AppBarIcon;
  readonly active: boolean;
  /** A count drawn on the button (e.g. requests waiting); 0 or absent shows none. */
  readonly badge: number;
}

export const APP_BAR_ICONS = [
  'grid', 'bolt', 'light', 'thermometer', 'camera', 'lock', 'list', 'chart', 'leaf', 'star',
  'people', 'bell',
] as const;
export type AppBarIcon = (typeof APP_BAR_ICONS)[number];

export const APP_BAR_LIMITS = Object.freeze({ buttons: 2, labelLength: 16, badge: 999 });

const BAR_BUTTON_ID = /^[a-z0-9][a-z0-9-]{0,31}$/u;

/** Validates a list of bar buttons; throws `ContractViolation` otherwise. */
export function parseBarButtons(value: unknown): AppBarButton[] {
  if (!Array.isArray(value) || value.length > APP_BAR_LIMITS.buttons) violation('bar buttons are invalid');
  const ids = new Set<string>();
  const buttons = value.map((entry: unknown) => {
    if (!isPlainRecord(entry)) violation('bar button must be a plain record');
    exactKeys(entry, Object.hasOwn(entry, 'badge') ? ['id', 'label', 'icon', 'active', 'badge'] : ['id', 'label', 'icon', 'active']);
    const { id, label, icon, active } = entry;
    const badge = entry.badge ?? 0;
    if (typeof badge !== 'number' || !Number.isInteger(badge) || badge < 0 || badge > APP_BAR_LIMITS.badge) {
      violation('bar button badge is invalid');
    }
    if (typeof id !== 'string' || !BAR_BUTTON_ID.test(id) || ids.has(id)) violation('bar button id is invalid');
    ids.add(id);
    if (typeof label !== 'string') violation('bar button label is invalid');
    const text = label.replace(/\s+/gu, ' ').trim();
    if (text === '' || [...text].length > APP_BAR_LIMITS.labelLength) violation('bar button label is invalid');
    if (!APP_BAR_ICONS.includes(icon as AppBarIcon)) violation('bar button icon is invalid');
    if (typeof active !== 'boolean') violation('bar button active flag is invalid');
    return Object.freeze({ id, label: text, icon: icon as AppBarIcon, active, badge });
  });
  if (buttons.filter((button) => button.active).length > 1) violation('only one bar button can be active');
  return buttons;
}

/**
 * Closed on purpose: a crash reason is shown by the shell, and the shell never
 * shows text the house wrote.
 */
export const APP_CRASH_REASONS = ['artifact_integrity', 'artifact_load', 'boot_error'] as const;
export type AppCrashReason = (typeof APP_CRASH_REASONS)[number];

/** Closed failure vocabulary for a settled call, mirrored by the bootstrap. */
export const APP_CALL_ERRORS = [
  'denied',
  'unavailable',
  'failed',
  'outcome_unknown',
  'timeout',
  'busy',
] as const;
export type AppCallError = (typeof APP_CALL_ERRORS)[number];

export interface AppGrant {
  readonly state_read: readonly string[];
  readonly call: readonly string[];
}

export interface AppStatePayload {
  readonly values: Readonly<Record<string, unknown>>;
  readonly revision: number;
  readonly stale: boolean;
}

export interface AppLoadPayload {
  readonly release: {
    readonly home_id: string;
    readonly release: string;
    readonly sha256: string;
    readonly size: number;
  };
  readonly home: { readonly id: string; readonly name: string };
  readonly locale: string;
  readonly theme: AppTheme;
  readonly grant: AppGrant;
  readonly state: AppStatePayload;
  readonly artifact: ArrayBuffer;
}

export type AppTheme = 'light' | 'dark' | 'system';

const CALL_ID = /^[A-Za-z0-9_-]{1,64}$/u;

function violation(message: string): never {
  throw new ContractViolation('bridge_protocol_violation', message);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): void {
  const actual = Object.keys(value);
  if (actual.length !== keys.length || !keys.every((key) => Object.hasOwn(value, key))) {
    violation('app message has unexpected fields');
  }
}

/**
 * Parses one message from the frame. Throws `ContractViolation` on anything
 * outside the closed protocol; the caller ends the session rather than guess.
 */
export function parseAppFrameMessage(value: unknown): AppFrameMessage {
  if (!isPlainRecord(value)) violation('app message must be a plain record');
  exactKeys(value, ['v', 'kind', 'payload']);
  if (value.v !== APP_BRIDGE_PROTOCOL) violation('unsupported app bridge protocol');
  const payload = value.payload;
  if (!isPlainRecord(payload)) violation('app message payload must be a plain record');
  measureStructuredValue(payload, { maxBytes: APP_LIMITS.messageBytes });

  switch (value.kind) {
    case 'app.ready':
      exactKeys(payload, []);
      return { kind: 'app.ready' };
    case 'shell.focus':
      exactKeys(payload, []);
      return { kind: 'shell.focus' };
    case 'bar.buttons':
      exactKeys(payload, ['buttons']);
      return { kind: 'bar.buttons', buttons: parseBarButtons(payload.buttons) };
    case 'share.start': {
      exactKeys(payload, ['id', 'request']);
      if (typeof payload.id !== 'string' || !CALL_ID.test(payload.id)) violation('share id is invalid');
      return { kind: 'share.start', id: payload.id, request: parseShareRequest(payload.request) };
    }
    case 'app.crash': {
      exactKeys(payload, ['reason']);
      const reason = payload.reason;
      if (!APP_CRASH_REASONS.includes(reason as AppCrashReason)) violation('unknown crash reason');
      return { kind: 'app.crash', reason: reason as AppCrashReason };
    }
    case 'app.pong': {
      exactKeys(payload, ['challenge']);
      if (!Number.isSafeInteger(payload.challenge)) violation('heartbeat challenge is invalid');
      return { kind: 'app.pong', challenge: payload.challenge as number };
    }
    case 'call.start': {
      exactKeys(payload, ['id', 'name', 'args', 'timeout_ms']);
      if (typeof payload.id !== 'string' || !CALL_ID.test(payload.id)) violation('call id is invalid');
      let name: string;
      try {
        name = validateResourceName(payload.name, 'call name');
      } catch {
        return violation('call name is invalid');
      }
      const timeout = payload.timeout_ms;
      if (!Number.isSafeInteger(timeout)
        || (timeout as number) < 1
        || (timeout as number) > APP_LIMITS.callDeadlineMs) {
        violation('call timeout is out of range');
      }
      return {
        kind: 'call.start',
        id: payload.id,
        name,
        args: payload.args,
        timeoutMs: timeout as number,
      };
    }
    default:
      return violation(`app message kind is not allowed: ${String(value.kind)}`);
  }
}

/** Wraps a shell-to-frame message in the bridge envelope. */
export function appShellMessage(kind: string, payload: Record<string, unknown>): {
  readonly v: typeof APP_BRIDGE_PROTOCOL;
  readonly kind: string;
  readonly payload: Record<string, unknown>;
} {
  return { v: APP_BRIDGE_PROTOCOL, kind, payload };
}

/** The frame's first words, posted to its parent before any port exists. */
export function isAppReadyAnnouncement(value: unknown, nonce: string): boolean {
  if (!isPlainRecord(value)) return false;
  const keys = Object.keys(value).sort();
  return keys.length === 3
    && keys[0] === 'nonce'
    && keys[1] === 'runtime'
    && keys[2] === 'type'
    && value.type === 'miakapp.app.ready'
    && value.runtime === String(APP_BRIDGE_PROTOCOL)
    && value.nonce === nonce;
}
