import { describe, expect, it, vi } from 'vitest';

import {
  classifyRuntimeFailure,
  createRuntimeDiagnostics,
  MAX_RUNTIME_REPORTS,
  RUNTIME_DIAGNOSTICS_SCHEMA,
  UNCLASSIFIED_FAILURE,
  type RuntimeDiagnosticsReport,
} from './runtime-diagnostics';

function collector(): {
  readonly reports: RuntimeDiagnosticsReport[];
  readonly endpoints: string[];
  readonly send: (endpoint: string, report: RuntimeDiagnosticsReport) => void;
} {
  const reports: RuntimeDiagnosticsReport[] = [];
  const endpoints: string[] = [];
  return {
    reports,
    endpoints,
    send: (endpoint, report) => {
      endpoints.push(endpoint);
      reports.push(report);
    },
  };
}

describe('classifyRuntimeFailure', () => {
  it('keeps every code the trusted host itself raises', () => {
    for (const code of [
      'bridge_protocol_violation',
      'capability_denied',
      'failed',
      'mount_failed',
      'ready_timeout',
      'render_invalid',
      'runtime_unresponsive',
      'sandbox_origin_invalid',
      'terminated',
    ]) {
      expect(classifyRuntimeFailure(code)).toBe(code);
    }
  });

  it('replaces a code the component authored', () => {
    // `runtime.error` copies `payload.code` off the bridge, so this is the
    // component speaking, not the host.
    expect(classifyRuntimeFailure('please_sign_in_at_evil.example')).toBe(UNCLASSIFIED_FAILURE);
  });

  it('replaces a code that smuggles data rather than truncating it', () => {
    const exfiltration = `ready_timeout|token=${'s3cret'.repeat(128)}`;

    const classified = classifyRuntimeFailure(exfiltration);

    // A prefix match or a truncation would have leaked the tail.
    expect(classified).toBe(UNCLASSIFIED_FAILURE);
    expect(classified).not.toContain('s3cret');
    expect(classified).not.toContain('ready_timeout');
  });

  it('does not accept a host code that merely contains one', () => {
    expect(classifyRuntimeFailure('ready_timeout ')).toBe(UNCLASSIFIED_FAILURE);
    expect(classifyRuntimeFailure('READY_TIMEOUT')).toBe(UNCLASSIFIED_FAILURE);
    expect(classifyRuntimeFailure('not_ready_timeout')).toBe(UNCLASSIFIED_FAILURE);
  });

  it('is not fooled by inherited object properties', () => {
    expect(classifyRuntimeFailure('toString')).toBe(UNCLASSIFIED_FAILURE);
    expect(classifyRuntimeFailure('constructor')).toBe(UNCLASSIFIED_FAILURE);
  });
});

describe('createRuntimeDiagnostics', () => {
  it('reports a host failure with the release and nothing else', () => {
    const sink = collector();
    const diagnostics = createRuntimeDiagnostics({
      endpoint: 'https://diagnostics.example/runtime',
      send: sink.send,
      now: () => new Date('2026-09-15T03:30:00.000Z'),
    });

    diagnostics.report('ready_timeout', 'release-7');

    expect(sink.endpoints).toEqual(['https://diagnostics.example/runtime']);
    expect(sink.reports).toEqual([
      {
        schema: RUNTIME_DIAGNOSTICS_SCHEMA,
        code: 'ready_timeout',
        release: 'release-7',
        at: '2026-09-15T03:30:00.000Z',
      },
    ]);
  });

  it('carries no field beyond the declared schema', () => {
    const sink = collector();
    const diagnostics = createRuntimeDiagnostics({
      endpoint: 'https://diagnostics.example/runtime',
      send: sink.send,
    });

    diagnostics.report('render_invalid', 'release-7');

    expect(Object.keys(sink.reports[0]!).sort()).toEqual(['at', 'code', 'release', 'schema']);
  });

  it('never forwards a component-authored code to the endpoint', () => {
    const sink = collector();
    const diagnostics = createRuntimeDiagnostics({
      endpoint: 'https://diagnostics.example/runtime',
      send: sink.send,
    });

    diagnostics.report('secret=hunter2', 'release-7');

    expect(sink.reports[0]!.code).toBe(UNCLASSIFIED_FAILURE);
    expect(JSON.stringify(sink.reports[0])).not.toContain('hunter2');
  });

  it('caps reports so a crash loop cannot become a beacon', () => {
    const sink = collector();
    const diagnostics = createRuntimeDiagnostics({
      endpoint: 'https://diagnostics.example/runtime',
      send: sink.send,
    });

    for (let index = 0; index < MAX_RUNTIME_REPORTS + 5; index += 1) {
      diagnostics.report('runtime_unresponsive', 'release-7');
    }

    expect(sink.reports).toHaveLength(MAX_RUNTIME_REPORTS);
  });

  it('counts a rejected report against the cap too', () => {
    const send = vi.fn(() => {
      throw new Error('endpoint unreachable');
    });
    const diagnostics = createRuntimeDiagnostics({
      endpoint: 'https://diagnostics.example/runtime',
      send,
    });

    for (let index = 0; index < MAX_RUNTIME_REPORTS + 3; index += 1) {
      diagnostics.report('ready_timeout', 'release-7');
    }

    expect(send).toHaveBeenCalledTimes(MAX_RUNTIME_REPORTS);
  });

  it('swallows a failing endpoint rather than failing the render path', () => {
    const diagnostics = createRuntimeDiagnostics({
      endpoint: 'https://diagnostics.example/runtime',
      send: () => {
        throw new Error('endpoint unreachable');
      },
    });

    expect(() => diagnostics.report('mount_failed', 'release-7')).not.toThrow();
  });

  it('does not let a rejected transport surface as an unhandled rejection', async () => {
    const diagnostics = createRuntimeDiagnostics({
      endpoint: 'https://diagnostics.example/runtime',
      send: () => {
        void Promise.reject(new Error('network down')).catch(() => undefined);
      },
    });

    diagnostics.report('terminated', 'release-7');

    await expect(Promise.resolve()).resolves.toBeUndefined();
  });

  it('freezes the report so a transport cannot mutate it before sending', () => {
    const sink = collector();
    const diagnostics = createRuntimeDiagnostics({
      endpoint: 'https://diagnostics.example/runtime',
      send: sink.send,
    });

    diagnostics.report('capability_denied', 'release-7');

    expect(Object.isFrozen(sink.reports[0])).toBe(true);
  });
});
