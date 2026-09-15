import { describe, expect, test } from 'bun:test';

import { ApiError } from '../../src/errors.js';
import type { JsonValue } from '../../src/json.js';
import {
  MAX_REPORT_SKEW_MILLISECONDS,
  RUNTIME_DIAGNOSTICS_SCHEMA,
  createLoggingRuntimeDiagnosticsSink,
  parseRuntimeDiagnosticsReport,
} from '../../src/runtime-diagnostics.js';

const NOW = Date.parse('2026-09-15T03:00:00.000Z');

function body(overrides: { [key: string]: JsonValue } = {}): { [key: string]: JsonValue } {
  return {
    schema: RUNTIME_DIAGNOSTICS_SCHEMA,
    code: 'ready_timeout',
    release: 'release-2026-09-15.1',
    at: '2026-09-15T02:59:30.000Z',
    ...overrides,
  };
}

function rejection(input: { [key: string]: JsonValue }): ApiError {
  try {
    parseRuntimeDiagnosticsReport(input, NOW);
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error('report was accepted');
}

describe('parseRuntimeDiagnosticsReport', () => {
  test('accepts a well-formed report and stamps its own observation time', () => {
    const report = parseRuntimeDiagnosticsReport(body(), NOW);
    expect(report).toEqual({
      code: 'ready_timeout',
      release: 'release-2026-09-15.1',
      reportedAt: '2026-09-15T02:59:30.000Z',
      observedAt: '2026-09-15T03:00:00.000Z',
    });
    expect(Object.isFrozen(report)).toBe(true);
  });

  test('accepts every code the trusted host can raise, and unclassified', () => {
    const codes = [
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
    ];
    for (const code of codes) {
      expect(parseRuntimeDiagnosticsReport(body({ code }), NOW).code).toBe(code);
    }
  });

  test('rejects a code outside the vocabulary instead of storing it', () => {
    expect(rejection(body({ code: 'contract_violation' })).code).toBe('invalid_request');
    expect(rejection(body({ code: 'READY_TIMEOUT' })).code).toBe('invalid_request');
    expect(rejection(body({ code: '' })).code).toBe('invalid_request');
  });

  test('rejects a code smuggled through the prototype chain', () => {
    expect(rejection(body({ code: 'toString' })).code).toBe('invalid_request');
    expect(rejection(body({ code: 'constructor' })).code).toBe('invalid_request');
    expect(rejection(body({ code: 'hasOwnProperty' })).code).toBe('invalid_request');
  });

  test('rejects a non-string code', () => {
    expect(rejection(body({ code: 7 })).code).toBe('invalid_request');
    expect(rejection(body({ code: null })).code).toBe('invalid_request');
    expect(rejection(body({ code: ['failed'] })).code).toBe('invalid_request');
  });

  test('rejects a release that is not an identifier', () => {
    expect(rejection(body({ release: 'release with spaces' })).code).toBe('invalid_request');
    expect(rejection(body({ release: 'release\ninjected' })).code).toBe('invalid_request');
    expect(rejection(body({ release: '-leading-dash' })).code).toBe('invalid_request');
    expect(rejection(body({ release: '' })).code).toBe('invalid_request');
    expect(rejection(body({ release: 'a'.repeat(65) })).code).toBe('invalid_request');
  });

  test('accepts a release at the contract boundary', () => {
    const release = `a${'b'.repeat(63)}`;
    expect(parseRuntimeDiagnosticsReport(body({ release }), NOW).release).toBe(release);
  });

  test('rejects a schema it does not serve', () => {
    expect(rejection(body({ schema: 'miakapp.runtime-diagnostics/2' })).code).toBe('invalid_request');
    expect(rejection(body({ schema: 'miakapp.push-grant/1' })).code).toBe('invalid_request');
  });

  test('rejects missing and extra keys', () => {
    const { at: _at, ...missing } = body();
    expect(rejection(missing).code).toBe('invalid_request');
    expect(rejection(body({ message: 'component said this' })).code).toBe('invalid_request');
    expect(rejection(body({ origin: 'https://example.test' })).code).toBe('invalid_request');
  });

  test('rejects timestamps that are not RFC 3339 UTC instants', () => {
    expect(rejection(body({ at: '2026-09-15T02:59:30+02:00' })).code).toBe('invalid_request');
    expect(rejection(body({ at: '2026-09-15 02:59:30Z' })).code).toBe('invalid_request');
    expect(rejection(body({ at: '2026-09-15t02:59:30z' })).code).toBe('invalid_request');
    expect(rejection(body({ at: '2026-09-15' })).code).toBe('invalid_request');
    expect(rejection(body({ at: '2026-13-15T02:59:30.000Z' })).code).toBe('invalid_request');
  });

  test('rejects a clock too far from ours in either direction', () => {
    const past = new Date(NOW - MAX_REPORT_SKEW_MILLISECONDS - 1_000).toISOString();
    const future = new Date(NOW + MAX_REPORT_SKEW_MILLISECONDS + 1_000).toISOString();
    expect(rejection(body({ at: past })).code).toBe('invalid_request');
    expect(rejection(body({ at: future })).code).toBe('invalid_request');
  });

  test('accepts a clock at the edge of the window', () => {
    const edge = new Date(NOW - MAX_REPORT_SKEW_MILLISECONDS).toISOString();
    expect(parseRuntimeDiagnosticsReport(body({ at: edge }), NOW).reportedAt).toBe(edge);
  });

  test('rejects a body that is not an object', () => {
    expect(rejection([] as unknown as { [key: string]: JsonValue }).code).toBe('invalid_request');
  });
});

describe('createLoggingRuntimeDiagnosticsSink', () => {
  test('emits one structured line carrying only the checked fields', () => {
    const lines: string[] = [];
    const sink = createLoggingRuntimeDiagnosticsSink((line) => { lines.push(line); });
    sink.record(parseRuntimeDiagnosticsReport(body(), NOW));
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] as string)).toEqual({
      severity: 'WARNING',
      message: 'component runtime stopped',
      schema: RUNTIME_DIAGNOSTICS_SCHEMA,
      code: 'ready_timeout',
      release: 'release-2026-09-15.1',
      reported_at: '2026-09-15T02:59:30.000Z',
      observed_at: '2026-09-15T03:00:00.000Z',
    });
  });

  test('a failing writer never becomes a second failure', () => {
    const sink = createLoggingRuntimeDiagnosticsSink(() => { throw new Error('log backend down'); });
    expect(() => { sink.record(parseRuntimeDiagnosticsReport(body(), NOW)); }).not.toThrow();
  });
});
