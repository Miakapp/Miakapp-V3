/**
 * Reports why the component runtime stopped, without letting the component
 * choose what gets reported.
 *
 * When a mount fails the shell falls back to the host's own tree. That fallback
 * is correct but mute: a sandbox that is broken in production degrades silently
 * and nobody operating the deployment learns of it. This module is the voice.
 *
 * The subtlety is who is speaking. `runtime.error` carries a `code` taken
 * straight off the bridge payload, so a failure code is *component-authored
 * text*. Forwarding it verbatim to an operator endpoint would hand home code a
 * write primitive into our telemetry, and rendering it verbatim in the shell
 * would hand it a line of trusted chrome. So nothing crosses either boundary
 * unless it matches a code the trusted host itself can raise.
 */

/**
 * Every code the trusted half of the bridge raises, plus the shell's own mount
 * rejection. A code outside this set did not come from us.
 */
export const HOST_FAILURE_CODES = Object.freeze([
  'bridge_protocol_violation',
  'capability_denied',
  'failed',
  'mount_failed',
  'ready_timeout',
  'render_invalid',
  'runtime_unresponsive',
  'sandbox_origin_invalid',
  'terminated',
] as const);

export type HostFailureCode = (typeof HOST_FAILURE_CODES)[number];

/** Stands in for any code the host cannot vouch for, component-authored or not. */
export const UNCLASSIFIED_FAILURE = 'unclassified';

export type ClassifiedFailure = HostFailureCode | typeof UNCLASSIFIED_FAILURE;

const KNOWN_CODES: ReadonlySet<string> = new Set(HOST_FAILURE_CODES);

/**
 * Collapses a failure code to one the host can vouch for. This is the only way
 * a code reaches telemetry or the shell's chrome, so an unrecognised string is
 * replaced rather than truncated or escaped: the component gets to signal *that*
 * it failed, never *what* the operator reads.
 */
export function classifyRuntimeFailure(code: string): ClassifiedFailure {
  return KNOWN_CODES.has(code) ? (code as HostFailureCode) : UNCLASSIFIED_FAILURE;
}

export const RUNTIME_DIAGNOSTICS_SCHEMA = 'miakapp.runtime-diagnostics/1';

/**
 * Reports are capped per shell mount. A runtime that fails, is retried and
 * fails again is a crash loop, and a crash loop pointed at an endpoint is a
 * flood; the cap also denies a component the ability to beacon by failing on
 * demand.
 */
export const MAX_RUNTIME_REPORTS = 4;

export interface RuntimeDiagnosticsReport {
  readonly schema: typeof RUNTIME_DIAGNOSTICS_SCHEMA;
  readonly code: ClassifiedFailure;
  readonly release: string;
  readonly at: string;
}

type SendReport = (endpoint: string, report: RuntimeDiagnosticsReport) => void;

export interface RuntimeDiagnosticsOptions {
  /** HTTPS endpoint the deployment declares. */
  readonly endpoint: string;
  readonly send?: SendReport;
  readonly now?: () => Date;
}

export interface RuntimeDiagnostics {
  /** Never throws and never rejects: reporting a failure must not become one. */
  report(code: string, release: string): void;
}

/**
 * `keepalive` matters more than it looks: the interesting failures happen while
 * the shell is tearing the frame down, and a plain fetch issued on that path is
 * free to be cancelled with the document.
 */
function postReport(endpoint: string, report: RuntimeDiagnosticsReport): void {
  void fetch(endpoint, {
    method: 'POST',
    keepalive: true,
    credentials: 'omit',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(report),
  }).catch(() => undefined);
}

/**
 * The release identifier is ours — it comes from the verified pointer, not from
 * the artifact — so it is the one piece of context safe to carry. No message,
 * no tree, no origin, no user-visible state: an operator learns which release
 * stopped and why, and nothing about the home it stopped in.
 */
export function createRuntimeDiagnostics(
  options: RuntimeDiagnosticsOptions,
): RuntimeDiagnostics {
  const { endpoint, send = postReport, now = () => new Date() } = options;
  let sent = 0;

  return {
    report(code: string, release: string): void {
      if (sent >= MAX_RUNTIME_REPORTS) return;
      sent += 1;
      const report: RuntimeDiagnosticsReport = Object.freeze({
        schema: RUNTIME_DIAGNOSTICS_SCHEMA,
        code: classifyRuntimeFailure(code),
        release,
        at: now().toISOString(),
      });
      try {
        send(endpoint, report);
      } catch {
        // An unreachable or misconfigured endpoint must never surface as a
        // second failure in the render path.
      }
    },
  };
}
