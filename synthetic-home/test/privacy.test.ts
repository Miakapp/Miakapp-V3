import { describe, expect, test } from 'bun:test';
import { loadSyntheticHomeCorpus, validateCorpusDocuments } from '../src/corpus.js';
import {
  PrivacyViolation,
  assertPublicFixture,
  scanPublicFixture,
} from '../src/privacy.js';

const corpus = await loadSyntheticHomeCorpus();

describe('public fixture privacy boundary', () => {
  test('accepts the complete built-in corpus', () => {
    expect(scanPublicFixture(corpus)).toEqual([]);
    expect(() => assertPublicFixture(corpus)).not.toThrow();
  });

  for (const [code, candidate] of [
    ['secret_field', { password: 'synthetic-placeholder' }],
    ['identifying_field', { latitude: 1 }],
    ['ip_address', { value: '192.0.2.10' }],
    ['hardware_identifier', { value: '02:00:00:00:00:01' }],
    ['email_address', { value: 'person@example.com' }],
    ['absolute_path', { value: '/opt/example/runtime.json' }],
    ['opaque_identifier', { value: '00000000-0000-4000-8000-000000000001' }],
    ['token_like_value', { value: 'Abcdefghijklmnopqrstuvwxyz0123456789' }],
    ['active_endpoint', { value: 'mqtt://broker.synthetic.test/topic' }],
    ['non_reserved_url', { value: 'https://public.example.com/resource' }],
    ['non_synthetic_time', { value: '2031-01-02T03:04:05Z' }],
    ['node_red_export', { type: 'function', z: 'syn_flow_example', wires: [] }],
  ] as const) {
    test(`detects ${code}`, () => {
      expect(scanPublicFixture(candidate).map((finding) => finding.code)).toContain(code);
    });
  }

  test('detects explicit network topology fields and IPv6 values', () => {
    const findings = scanPublicFixture({
      hostname: 'coordinator.synthetic.invalid',
      broker: 'broker.synthetic.invalid',
      endpoint_value: '[2001:db8::1]',
    });
    expect(findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'identifying_field', path: '$.hostname' }),
      expect.objectContaining({ code: 'identifying_field', path: '$.broker' }),
      expect.objectContaining({ code: 'ip_address', path: '$.endpoint_value' }),
    ]));
  });

  test('detects segmented secret fields in an otherwise valid corpus', () => {
    const home = structuredClone(corpus.home);
    home.initial_context.global['broker.password'] = 'synthetic passphrase placeholder';
    expect(() => validateCorpusDocuments(corpus.manifest, home, corpus.scenarios)).not.toThrow();
    expect(scanPublicFixture(home)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'secret_field',
        path: '$.initial_context.global.broker.password',
      }),
    ]));
  });

  test('detects compressed IPv6, private hosts, network paths, and provider tokens', () => {
    const providerToken = ['AKIA', '0'.repeat(16)].join('');
    const findings = scanPublicFixture({
      ipv6: 'fe80::1234',
      host_value: 'coordinator.internal',
      network_path: String.raw`\\synthetic-host\share\fixture.json`,
      provider_token_value: providerToken,
    });
    expect(findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'ip_address', path: '$.ipv6' }),
      expect.objectContaining({ code: 'private_hostname', path: '$.host_value' }),
      expect.objectContaining({ code: 'absolute_path', path: '$.network_path' }),
      expect.objectContaining({ code: 'token_like_value', path: '$.provider_token_value' }),
    ]));
  });

  test('rejects credential metadata on reserved fixture URLs', () => {
    const findings = scanPublicFixture({
      image: 'https://media.synthetic.test/image.png?access_token=placeholder',
      callback: 'https://relay.synthetic.test/return#credential',
    });
    expect(findings.filter(({ code }) => code === 'non_reserved_url')).toHaveLength(2);
  });

  test('allows reserved URLs and the designated fictional clock', () => {
    expect(scanPublicFixture({
      image: 'https://media.synthetic.test/fixtures/example.png',
      at: '2042-04-05T06:00:00Z',
    })).toEqual([]);
  });

  test('throws one aggregate error with paths', () => {
    try {
      assertPublicFixture({ secret: 'placeholder', endpoint: '203.0.113.1' });
      throw new Error('expected a privacy violation');
    } catch (error) {
      expect(error).toBeInstanceOf(PrivacyViolation);
      expect((error as PrivacyViolation).findings).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: 'secret_field', path: '$.secret' }),
        expect.objectContaining({ code: 'ip_address', path: '$.endpoint' }),
      ]));
    }
  });

  test('rejects cyclic input instead of recursing forever', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(scanPublicFixture(cyclic)).toEqual([
      expect.objectContaining({ code: 'cyclic_value', path: '$.self' }),
    ]);
  });
});
