/**
 * Accepts `miakapp.runtime-diagnostics/1` reports from deployed shells.
 *
 * The shell emits these when the component runtime stops (`src/app/runtime-diagnostics.ts`).
 * Until now nothing accepted them: the shell spoke into a socket nobody had
 * opened, so a sandbox broken in production stayed silent on both ends.
 *
 * The delicate part is that this endpoint cannot authenticate its caller. The
 * shell posts with `credentials: 'omit'` from an unauthenticated page, so
 * anything reaching this module is *poster-authored* — including the fields the
 * shell itself derived from a verified pointer. The sending half already
 * refuses to forward a code the trusted host cannot vouch for; the receiving
 * half cannot assume the sending half ran. So every field is re-checked here
 * against the same closed vocabulary, and a report that fails is **rejected
 * rather than stored**: an operator surface that records whatever it is handed
 * is a writable log, not a diagnostic.
 */

import { apiError } from './errors.js';
import { assertExactKeys, objectValue, stringValue, type JsonValue } from './json.js';

export const RUNTIME_DIAGNOSTICS_SCHEMA = 'miakapp.runtime-diagnostics/1';

/**
 * Mirrors `HOST_FAILURE_CODES` plus `unclassified` in the shell. It is copied
 * rather than imported because the two halves ship separately: the control
 * plane must keep rejecting codes it does not know even when facing a shell
 * build it has never seen. Adding a code here is therefore a deliberate act on
 * both sides, which is the point.
 */
const ACCEPTED_FAILURE_CODES: ReadonlySet<string> = new Set([
  'bridge_protocol_violation',
  'capability_denied',
  'failed',
  'mount_failed',
  'ready_timeout',
  'render_invalid',
  'runtime_unresponsive',
  'sandbox_origin_invalid',
  'terminated',
  'unclassified',
]);

/**
 * `release` is 64 bytes of free-form string in the pointer contract
 * (`component-runtime/src/contract.ts`), and a poster can put anything in it.
 * It is constrained to an identifier shape before it becomes a log label or a
 * rate-limit subject: no spaces, no control characters, no delimiters that let
 * one release impersonate another in a line of text.
 */
const RELEASE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** RFC 3339 UTC instants only. Offsets and lowercase `t`/`z` are refused. */
const INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

/**
 * A report whose clock is far from ours says nothing useful about when the
 * runtime stopped, and a poster free to choose `at` can file reports into the
 * past or the future. Anything outside the window is refused; the observation
 * timestamp the sink records is always ours.
 */
export const MAX_REPORT_SKEW_MILLISECONDS = 5 * 60_000;

export interface RuntimeDiagnosticsReport {
  readonly code: string;
  readonly release: string;
  /** The instant the shell claims, already checked against our clock. */
  readonly reportedAt: string;
  /** The instant we accepted it. Never poster-controlled. */
  readonly observedAt: string;
}

export interface RuntimeDiagnosticsSink {
  /** Must not throw: a failed diagnostic must not become a second failure. */
  record(report: RuntimeDiagnosticsReport): void;
}

/**
 * Parses and validates one report body.
 *
 * Throws `invalid_request` for every rejection, deliberately without saying
 * which field failed: the caller is unauthenticated, and a precise parser is a
 * free oracle for probing the accepted vocabulary.
 */
export function parseRuntimeDiagnosticsReport(
  body: { [key: string]: JsonValue },
  nowMilliseconds: number,
): RuntimeDiagnosticsReport {
  const record = objectValue(body);
  assertExactKeys(record, ['schema', 'code', 'release', 'at']);

  if (stringValue(record.schema) !== RUNTIME_DIAGNOSTICS_SCHEMA) throw apiError('invalid_request');

  const code = stringValue(record.code);
  if (!ACCEPTED_FAILURE_CODES.has(code)) throw apiError('invalid_request');

  const release = stringValue(record.release);
  if (!RELEASE_PATTERN.test(release)) throw apiError('invalid_request');

  const reportedAt = stringValue(record.at);
  if (!INSTANT_PATTERN.test(reportedAt)) throw apiError('invalid_request');
  const reportedMilliseconds = Date.parse(reportedAt);
  if (!Number.isFinite(reportedMilliseconds)) throw apiError('invalid_request');
  if (Math.abs(reportedMilliseconds - nowMilliseconds) > MAX_REPORT_SKEW_MILLISECONDS) {
    throw apiError('invalid_request');
  }

  return Object.freeze({
    code,
    release,
    reportedAt,
    observedAt: new Date(nowMilliseconds).toISOString(),
  });
}

/**
 * Emits accepted reports as one structured line, which is what an operator
 * actually reads on a Functions deployment.
 *
 * Nothing durable is written on purpose. This route is unauthenticated, so a
 * database write here would be an amplification primitive: whoever can reach
 * the endpoint could grow a collection, and the bill, without an account.
 * Admission budgets bound the log; they cannot bound a store's retention.
 */
export function createLoggingRuntimeDiagnosticsSink(
  write: (line: string) => void = (line) => { console.warn(line); },
): RuntimeDiagnosticsSink {
  return {
    record(report: RuntimeDiagnosticsReport): void {
      try {
        write(JSON.stringify({
          severity: 'WARNING',
          message: 'component runtime stopped',
          schema: RUNTIME_DIAGNOSTICS_SCHEMA,
          code: report.code,
          release: report.release,
          reported_at: report.reportedAt,
          observed_at: report.observedAt,
        }));
      } catch {
        // Losing a diagnostic is preferable to failing the request that carried it.
      }
    },
  };
}
