// The `miakapp.app/1` bridge: what crosses the port between the trusted shell
// and a whole-house application running in its opaque-origin frame.
//
// A `miakapp.component/1` release hands the shell a semantic tree and the shell
// draws it. An app release draws itself — any DOM, CSS, layout, routing or
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
  | { readonly kind: 'shell.focus' };

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
