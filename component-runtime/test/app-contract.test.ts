import { describe, expect, test } from 'bun:test';

import { parseAppFrameMessage, isAppReadyAnnouncement } from '../src/app-contract';
import { appContentSecurityPolicy, buildAppDocument } from '../src/app-document';
import { APP_ABI, COMPONENT_ABI, POINTER_SCHEMA, validatePointer } from '../src/contract';

const message = (kind: string, payload: Record<string, unknown>) => ({ v: 1, kind, payload });

describe('miakapp.app/1 bridge', () => {
  test('accepts the closed frame vocabulary', () => {
    expect(parseAppFrameMessage(message('app.ready', {}))).toEqual({ kind: 'app.ready' });
    expect(parseAppFrameMessage(message('shell.focus', {}))).toEqual({ kind: 'shell.focus' });
    expect(parseAppFrameMessage(message('app.crash', { reason: 'boot_error' })))
      .toEqual({ kind: 'app.crash', reason: 'boot_error' });
    expect(parseAppFrameMessage(message('call.start', {
      id: 'c1', name: 'lighting.set', args: { on: true }, timeout_ms: 1_000,
    }))).toEqual({ kind: 'call.start', id: 'c1', name: 'lighting.set', args: { on: true }, timeoutMs: 1_000 });
  });

  test('rejects anything the shell would have to interpret', () => {
    const rejected = [
      message('ui.render', {}),
      message('app.crash', { reason: '<b>your account was hacked</b>' }),
      message('app.ready', { extra: true }),
      message('call.start', { id: 'c1', name: 'lighting.*', args: null, timeout_ms: 1 }),
      message('call.start', { id: 'bad id', name: 'lighting.set', args: null, timeout_ms: 1 }),
      message('call.start', { id: 'c1', name: 'lighting.set', args: null, timeout_ms: 0 }),
      message('call.start', { id: 'c1', name: 'lighting.set', args: null, timeout_ms: 300_001 }),
      message('call.start', { id: 'c1', name: 'lighting.set', args: 'x'.repeat(70_000), timeout_ms: 1 }),
      { v: 2, kind: 'app.ready', payload: {} },
      { v: 1, kind: 'app.ready', payload: {}, port: 1 },
      'app.ready',
    ];
    for (const value of rejected) expect(() => parseAppFrameMessage(value)).toThrow();
  });

  test('binds only the announcement carrying this mount nonce', () => {
    const nonce = 'n'.repeat(32);
    expect(isAppReadyAnnouncement({ type: 'miakapp.app.ready', runtime: '1', nonce }, nonce)).toBe(true);
    expect(isAppReadyAnnouncement({ type: 'miakapp.app.ready', runtime: '1', nonce: 'other' }, nonce)).toBe(false);
    expect(isAppReadyAnnouncement({ type: 'miakapp.runtime.ready', runtime: '1', nonce }, nonce)).toBe(false);
  });
});

describe('release pointers', () => {
  const base = {
    schema: POINTER_SCHEMA,
    home_id: 'home-a',
    generation: 3,
    release: 'r3',
    url: 'https://artifacts.example/v1/components/x.js',
    sha256: 'A'.repeat(43),
    size: 10,
    requires: { state_read: [], event_subscribe: [], event_publish: [], call: [], presentation: [] },
  };
  const context = { expectedHomeId: 'home-a', allowedArtifactOrigins: new Set(['https://artifacts.example']) };

  test('carry either ABI explicitly and nothing else', () => {
    expect(validatePointer({ ...base, abi: APP_ABI }, context).abi).toBe(APP_ABI);
    expect(validatePointer({ ...base, abi: COMPONENT_ABI }, context).abi).toBe(COMPONENT_ABI);
    expect(() => validatePointer({ ...base, abi: 'miakapp.app/2' }, context)).toThrow();
  });
});

describe('/app.html', () => {
  test('keeps the opaque origin and the network closed while freeing presentation', async () => {
    const document = await buildAppDocument({
      bootstrapSource: 'console.log("boot")',
      hostOrigin: 'https://miakapp.example',
      sandboxOrigin: 'https://sandbox.example',
    });
    const csp = document.headers.find((header) => header.key === 'Content-Security-Policy')!.value;
    expect(csp).toBe(appContentSecurityPolicy(document.scriptHash, 'https://miakapp.example'));
    const directives = new Map(csp.split('; ').map((entry) => {
      const [name, ...rest] = entry.split(' ');
      return [name!, rest.join(' ')];
    }));
    expect(directives.get('sandbox')).toBe('allow-scripts allow-forms');
    expect(directives.get('sandbox')).not.toContain('allow-same-origin');
    expect(directives.get('connect-src')).toBe("'none'");
    expect(directives.get('frame-src')).toBe("'none'");
    expect(directives.get('form-action')).toBe("'none'");
    expect(directives.get('img-src')).toBe('data: blob:');
    expect(directives.get('frame-ancestors')).toBe('https://miakapp.example');
    expect(directives.get('script-src')).toContain(`'sha256-${document.scriptHash}'`);
    expect(document.headers.find((header) => header.key === 'Permissions-Policy')!.value).toContain('fullscreen=()');
  });

  test('refuses to build a document the shell origin could share', async () => {
    await expect(buildAppDocument({
      bootstrapSource: 'x',
      hostOrigin: 'https://miakapp.example',
      sandboxOrigin: 'https://miakapp.example',
    })).rejects.toThrow('differ');
  });
});
