import { describe, expect, it } from 'vitest';

import { collectStagingEnvFaults, KNOWN_STAGING_ENV_KEYS } from './staging-env';

const LIVE_ENV: Readonly<Record<string, string>> = Object.freeze({
  VITE_MIAKAPP_MODE: 'live',
  VITE_MIAKAPP_CONTROL_PLANE_EXCHANGE_ENDPOINT:
    'https://control.example.test/v1/user-relay-tokens:exchange',
  VITE_MIAKAPP_RUNTIME_DIAGNOSTICS_ENDPOINT: 'https://control.example.test/v1/runtime-diagnostics',
  VITE_MIAKAPP_HOME_ID: 'example-home',
  VITE_MIAKAPP_HOME_NAME: 'Example home',
  VITE_MIAKAPP_HOME_DETAIL: 'Staging · synthetic coordinator',
  VITE_MIAKAPP_FIREBASE_API_KEY: 'public-web-api-key',
  VITE_MIAKAPP_FIREBASE_APP_ID: 'public-web-app-id',
  VITE_MIAKAPP_FIREBASE_AUTH_DOMAIN: 'example.firebaseapp.com',
  VITE_MIAKAPP_FIREBASE_MESSAGING_SENDER_ID: '000000000000',
  VITE_MIAKAPP_FIREBASE_PROJECT_ID: 'example',
  VITE_MIAKAPP_FIREBASE_STORAGE_BUCKET: 'example.firebasestorage.app',
  VITE_MIAKAPP_APP_CHECK_SITE_KEY: 'public-recaptcha-enterprise-site-key',
});

function faultsFor(overrides: Readonly<Record<string, string>>): readonly string[] {
  return collectStagingEnvFaults({ ...LIVE_ENV, ...overrides });
}

function withoutKey(key: string): Readonly<Record<string, string>> {
  const env: Record<string, string> = { ...LIVE_ENV };
  delete env[key];
  return env;
}

describe('collectStagingEnvFaults', () => {
  it('accepts the documented staging example', () => {
    expect(collectStagingEnvFaults(LIVE_ENV)).toEqual([]);
  });

  it('ignores variables the bundle never reads', () => {
    expect(faultsFor({ PATH: '/usr/bin', HOME: '/root', CI: 'true' })).toEqual([]);
  });

  it('names an unknown Miakapp key instead of ignoring it', () => {
    // The whole point of the closed set: this is a misspelling of the sandbox
    // origin, and the shell would simply leave the component runtime unmounted.
    expect(faultsFor({ VITE_MIAKAPP_COMPONENT_SANDBOX_ORGIN: 'https://sandbox.example.test' })).toEqual([
      'VITE_MIAKAPP_COMPONENT_SANDBOX_ORGIN is not a key this bundle reads; check the spelling',
    ]);
  });

  it('catches a name misspelled before the Miakapp segment', () => {
    expect(faultsFor({ VITE_MIKAAPP_HOME_ID: 'example-home' })).toEqual([
      'VITE_MIKAAPP_HOME_ID is not a key this bundle reads; check the spelling',
    ]);
  });

  it('requires a mode', () => {
    expect(collectStagingEnvFaults(withoutKey('VITE_MIAKAPP_MODE'))).toEqual([
      'VITE_MIAKAPP_MODE is required; staging deploys the live host with "live"',
    ]);
  });

  it('rejects a mode the host does not implement', () => {
    expect(faultsFor({ VITE_MIAKAPP_MODE: 'production' })).toEqual([
      'VITE_MIAKAPP_MODE must be "live" or "demo", not production',
    ]);
  });

  it('reports every missing live key at once', () => {
    const env: Record<string, string> = { VITE_MIAKAPP_MODE: 'live' };
    const faults = collectStagingEnvFaults(env);
    expect(faults).toHaveLength(11);
    expect(faults).toContain('VITE_MIAKAPP_HOME_ID is required when VITE_MIAKAPP_MODE=live');
    expect(faults).toContain(
      'VITE_MIAKAPP_CONTROL_PLANE_EXCHANGE_ENDPOINT is required when VITE_MIAKAPP_MODE=live',
    );
  });

  it('treats a blank value as absent, exactly as the host does', () => {
    expect(faultsFor({ VITE_MIAKAPP_HOME_NAME: '   ' })).toEqual([
      'VITE_MIAKAPP_HOME_NAME is required when VITE_MIAKAPP_MODE=live',
    ]);
  });

  it('does not demand live keys of a demo build', () => {
    expect(collectStagingEnvFaults({ VITE_MIAKAPP_MODE: 'demo' })).toEqual([]);
  });

  it.each([
    'VITE_MIAKAPP_CONTROL_PLANE_EXCHANGE_ENDPOINT',
    'VITE_MIAKAPP_RUNTIME_DIAGNOSTICS_ENDPOINT',
  ])('rejects a plaintext %s', (key) => {
    expect(faultsFor({ [key]: 'http://control.example.test/v1/thing' })).toEqual([
      `${key} must use HTTPS: http://control.example.test/v1/thing`,
    ]);
  });

  it('rejects an endpoint that is not a URL', () => {
    expect(faultsFor({ VITE_MIAKAPP_RUNTIME_DIAGNOSTICS_ENDPOINT: '/v1/runtime-diagnostics' })).toEqual([
      'VITE_MIAKAPP_RUNTIME_DIAGNOSTICS_ENDPOINT is not a URL: /v1/runtime-diagnostics',
    ]);
  });

  it('accepts a sandbox origin with the trailing slash the runtime strips', () => {
    expect(faultsFor({ VITE_MIAKAPP_COMPONENT_SANDBOX_ORIGIN: 'https://sandbox.example.test/' })).toEqual(
      [],
    );
  });

  it('rejects a sandbox origin carrying a path', () => {
    expect(
      faultsFor({ VITE_MIAKAPP_COMPONENT_SANDBOX_ORIGIN: 'https://sandbox.example.test/sandbox.html' }),
    ).toEqual([
      'VITE_MIAKAPP_COMPONENT_SANDBOX_ORIGIN must be a bare origin with no path, query or fragment: https://sandbox.example.test/sandbox.html',
    ]);
  });

  it('rejects an artifact origin with the trailing slash that matches nothing', () => {
    // `allowedArtifactOrigins.has(url.origin)` never sees a trailing slash, so
    // this value silently refuses every artifact it is offered.
    expect(
      faultsFor({
        VITE_MIAKAPP_COMPONENT_POINTER_ENDPOINT: 'https://control.example.test/v1/pointer',
        VITE_MIAKAPP_COMPONENT_ARTIFACT_ORIGINS: 'https://artifacts.example.test/',
      }),
    ).toEqual([
      'VITE_MIAKAPP_COMPONENT_ARTIFACT_ORIGINS must be a bare origin with no path, query or fragment: https://artifacts.example.test/',
    ]);
  });

  it('checks every entry of the artifact origin list', () => {
    expect(
      faultsFor({
        VITE_MIAKAPP_COMPONENT_POINTER_ENDPOINT: 'https://control.example.test/v1/pointer',
        VITE_MIAKAPP_COMPONENT_ARTIFACT_ORIGINS:
          'https://one.example.test, http://two.example.test ,https://three.example.test',
      }),
    ).toEqual([
      'VITE_MIAKAPP_COMPONENT_ARTIFACT_ORIGINS must use HTTPS: http://two.example.test',
    ]);
  });

  it('accepts a whitespace-padded artifact origin list', () => {
    expect(
      faultsFor({
        VITE_MIAKAPP_COMPONENT_POINTER_ENDPOINT: 'https://control.example.test/v1/pointer',
        VITE_MIAKAPP_COMPONENT_ARTIFACT_ORIGINS:
          ' https://control.example.test , https://two.example.test ',
      }),
    ).toEqual([]);
  });

  it('rejects an artifact origin list that resolves to nothing', () => {
    expect(
      faultsFor({
        VITE_MIAKAPP_COMPONENT_POINTER_ENDPOINT: 'https://control.example.test/v1/pointer',
        VITE_MIAKAPP_COMPONENT_ARTIFACT_ORIGINS: ' , , ',
      }),
    ).toEqual(['VITE_MIAKAPP_COMPONENT_ARTIFACT_ORIGINS lists no origin']);
  });

  it('refuses half a component release configuration rather than disabling it', () => {
    expect(
      faultsFor({ VITE_MIAKAPP_COMPONENT_POINTER_ENDPOINT: 'https://control.example.test/v1/pointer' }),
    ).toEqual([
      'VITE_MIAKAPP_COMPONENT_ARTIFACT_ORIGINS is required alongside VITE_MIAKAPP_COMPONENT_POINTER_ENDPOINT; component releases stay off without it',
    ]);
    expect(
      faultsFor({ VITE_MIAKAPP_COMPONENT_ARTIFACT_ORIGINS: 'https://artifacts.example.test' }),
    ).toEqual([
      'VITE_MIAKAPP_COMPONENT_POINTER_ENDPOINT is required alongside VITE_MIAKAPP_COMPONENT_ARTIFACT_ORIGINS; component releases stay off without it',
    ]);
  });

  it('rejects a diagnostics endpoint that names another control plane', () => {
    expect(
      faultsFor({
        VITE_MIAKAPP_RUNTIME_DIAGNOSTICS_ENDPOINT: 'https://stale.example.test/v1/runtime-diagnostics',
      }),
    ).toEqual([
      'VITE_MIAKAPP_RUNTIME_DIAGNOSTICS_ENDPOINT must share the control plane origin https://control.example.test, but points at https://stale.example.test',
    ]);
  });

  it('accepts a diagnostics endpoint on the control plane origin whatever its path', () => {
    expect(
      faultsFor({
        VITE_MIAKAPP_RUNTIME_DIAGNOSTICS_ENDPOINT: 'https://control.example.test/v2/elsewhere',
      }),
    ).toEqual([]);
  });

  it('reports a malformed diagnostics endpoint once, not twice', () => {
    expect(
      faultsFor({ VITE_MIAKAPP_RUNTIME_DIAGNOSTICS_ENDPOINT: 'http://control.example.test/v1/runtime-diagnostics' }),
    ).toEqual([
      'VITE_MIAKAPP_RUNTIME_DIAGNOSTICS_ENDPOINT must use HTTPS: http://control.example.test/v1/runtime-diagnostics',
    ]);
  });

  it('rejects a pointer endpoint that names another control plane', () => {
    expect(
      faultsFor({
        VITE_MIAKAPP_COMPONENT_POINTER_ENDPOINT: 'https://releases.example.test',
        VITE_MIAKAPP_COMPONENT_ARTIFACT_ORIGINS: 'https://control.example.test',
      }),
    ).toEqual([
      'VITE_MIAKAPP_COMPONENT_POINTER_ENDPOINT must share the control plane origin https://control.example.test, but points at https://releases.example.test',
    ]);
  });

  it('accepts a pointer endpoint on the control plane origin whatever its path', () => {
    expect(
      faultsFor({
        VITE_MIAKAPP_COMPONENT_POINTER_ENDPOINT: 'https://control.example.test/v2/elsewhere',
        VITE_MIAKAPP_COMPONENT_ARTIFACT_ORIGINS: 'https://control.example.test',
      }),
    ).toEqual([]);
  });

  it('reports a malformed pointer endpoint once, not twice', () => {
    expect(
      faultsFor({
        VITE_MIAKAPP_COMPONENT_POINTER_ENDPOINT: 'http://releases.example.test',
        VITE_MIAKAPP_COMPONENT_ARTIFACT_ORIGINS: 'https://control.example.test',
      }),
    ).toEqual([
      'VITE_MIAKAPP_COMPONENT_POINTER_ENDPOINT must use HTTPS: http://releases.example.test',
    ]);
  });

  it('rejects an artifact origin list that excludes the control plane', () => {
    // Every pointer names an artifact on the control plane origin, so this list
    // refuses all of them at `allowedArtifactOrigins.has(url.origin)`. Releases
    // read as configured and never activate.
    expect(
      faultsFor({
        VITE_MIAKAPP_COMPONENT_POINTER_ENDPOINT: 'https://control.example.test/v1/pointer',
        VITE_MIAKAPP_COMPONENT_ARTIFACT_ORIGINS: 'https://artifacts.example.test',
      }),
    ).toEqual([
      'VITE_MIAKAPP_COMPONENT_ARTIFACT_ORIGINS must include the control plane origin https://control.example.test, which serves every artifact a pointer names; it lists https://artifacts.example.test',
    ]);
  });

  it('accepts artifact origins beside the control plane rather than demanding it alone', () => {
    // Containment, not equality: the digest in the pointer is what makes bytes
    // trustworthy, so a deployment may name a mirror as well.
    expect(
      faultsFor({
        VITE_MIAKAPP_COMPONENT_POINTER_ENDPOINT: 'https://control.example.test/v1/pointer',
        VITE_MIAKAPP_COMPONENT_ARTIFACT_ORIGINS:
          'https://artifacts.example.test,https://control.example.test',
      }),
    ).toEqual([]);
  });

  it('stays silent about the control plane origin while the list is still malformed', () => {
    // The entry must be retyped anyway; a second sentence about containment
    // would describe a list that does not exist yet.
    expect(
      faultsFor({
        VITE_MIAKAPP_COMPONENT_POINTER_ENDPOINT: 'https://control.example.test/v1/pointer',
        VITE_MIAKAPP_COMPONENT_ARTIFACT_ORIGINS: 'http://artifacts.example.test',
      }),
    ).toEqual([
      'VITE_MIAKAPP_COMPONENT_ARTIFACT_ORIGINS must use HTTPS: http://artifacts.example.test',
    ]);
  });

  it('stays silent about origins when the anchor itself is the faulty value', () => {
    // The exchange endpoint is what every other value is measured against.
    // Once it is wrong, naming a second control plane sends the operator
    // looking for a deployment that does not exist; report the anchor only.
    // Both cross-key rules go quiet here: the pointer origin and the artifact
    // origin list, neither of which contains `control.example.test`.
    expect(
      faultsFor({
        VITE_MIAKAPP_CONTROL_PLANE_EXCHANGE_ENDPOINT:
          'http://control.example.test/v1/user-relay-tokens:exchange',
        VITE_MIAKAPP_COMPONENT_POINTER_ENDPOINT: 'https://releases.example.test',
        VITE_MIAKAPP_COMPONENT_ARTIFACT_ORIGINS: 'https://artifacts.example.test',
      }),
    ).toEqual([
      'VITE_MIAKAPP_CONTROL_PLANE_EXCHANGE_ENDPOINT must use HTTPS: http://control.example.test/v1/user-relay-tokens:exchange',
    ]);
  });

  it('leaves the optional features off without complaint when nothing declares them', () => {
    const env: Record<string, string> = { ...LIVE_ENV };
    delete env.VITE_MIAKAPP_RUNTIME_DIAGNOSTICS_ENDPOINT;
    expect(collectStagingEnvFaults(env)).toEqual([]);
  });

  it('exposes a closed key set covering the documented example', () => {
    for (const key of Object.keys(LIVE_ENV)) {
      expect(KNOWN_STAGING_ENV_KEYS.has(key)).toBe(true);
    }
    expect(KNOWN_STAGING_ENV_KEYS.has('toString')).toBe(false);
  });
});
