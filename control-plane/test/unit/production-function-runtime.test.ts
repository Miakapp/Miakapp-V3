import { describe, expect, test } from 'bun:test';
import type express from 'express';

import { ProductionConfigurationError } from '../../src/production-config.js';
import {
  createProductionFunctionRuntime,
  productionInitializationFailureEvent,
} from '../../src/production-function-runtime.js';
import {
  ProductionInitializationError,
  type ProductionControlPlane,
} from '../../src/production-runtime.js';
import {
  PRODUCTION_RUNTIME_CONFIG_VARIABLE,
  loadProductionRuntimeConfig,
} from '../../src/production-runtime-loader.js';

function keyring(secretId: string) {
  return {
    current_version: 'v1',
    versions: [{
      logical_version: 'v1',
      resource_name: `projects/miakapp-v4-staging/secrets/${secretId}/versions/1`,
    }],
  };
}

function runtimeDocument(): Record<string, unknown> {
  return {
    schema: 'miakapp.production-runtime/1',
    security: {
      schema: 'miakapp.production-security/1',
      environment: 'staging',
      project_id: 'miakapp-v4-staging',
      region: 'europe-west9',
      issuer: 'https://control.staging.miakapp.com',
      signing: {
        key_version_name: 'projects/miakapp-v4-staging/locations/europe-west9/keyRings/miakapp-v4-staging/cryptoKeys/access-token-signing/cryptoKeyVersions/1',
        public_jwk: {
          kty: 'OKP',
          crv: 'Ed25519',
          x: Buffer.alloc(32, 7).toString('base64url'),
          use: 'sig',
          alg: 'EdDSA',
          kid: 'staging-access-token-v1',
        },
        rpc_timeout_ms: 2_000,
      },
      secret_manager: {
        rpc_timeout_ms: 1_500,
        keyrings: {
          homeKeyPepper: keyring('miakapp-home-key-pepper'),
          componentHmac: keyring('miakapp-component-hmac'),
          pushHmac: keyring('miakapp-push-hmac'),
          auditHmac: keyring('miakapp-audit-hmac'),
          networkHmac: keyring('miakapp-network-hmac'),
        },
      },
    },
    allowed_origins: ['https://app.staging.miakapp.com'],
    app_check_app_id: '1:1234567890:web:0123456789abcdef',
    component_bucket: 'miakapp-v4-staging-components',
  };
}

function loadedConfig() {
  return loadProductionRuntimeConfig('staging', {
    [PRODUCTION_RUNTIME_CONFIG_VARIABLE]: JSON.stringify(runtimeDocument()),
  });
}

interface ResponseState {
  statusCode: number | undefined;
  readonly headers: Map<string, string>;
  contentType: string | undefined;
  body: unknown;
}

function recordingResponse(): Readonly<{ response: express.Response; state: ResponseState }> {
  const state: ResponseState = {
    statusCode: undefined,
    headers: new Map(),
    contentType: undefined,
    body: undefined,
  };
  const response = {
    status(code: number) {
      state.statusCode = code;
      return response;
    },
    set(name: string, value: string) {
      state.headers.set(name.toLowerCase(), value);
      return response;
    },
    type(value: string) {
      state.contentType = value;
      return response;
    },
    send(body?: unknown) {
      state.body = body;
      return response;
    },
  };
  return { response: response as unknown as express.Response, state };
}

const request = Object.freeze({}) as express.Request;

describe('production Function runtime', () => {
  test('single-flights concurrent initialization and delegates every request after one cloud load', async () => {
    let release: () => void = () => { throw new Error('Initialization did not start'); };
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const counters = {
      configLoads: 0,
      compositions: 0,
      secretReads: 0,
      publicKeyReads: 0,
      requests: 0,
    };
    const application = ((_: express.Request, response: express.Response) => {
      counters.requests += 1;
      response.status(204).send();
    }) as unknown as express.Express;
    const composition: ProductionControlPlane = Object.freeze({
      application,
      environment: 'staging',
      projectId: 'miakapp-v4-staging',
    });
    const runtime = createProductionFunctionRuntime('staging', {
      loadConfig() {
        counters.configLoads += 1;
        return loadedConfig();
      },
      async createControlPlane() {
        counters.compositions += 1;
        counters.secretReads += 5;
        counters.publicKeyReads += 1;
        await gate;
        return composition;
      },
    });

    const responses = Array.from({ length: 16 }, () => recordingResponse());
    const requests = responses.map(({ response }) => runtime.handle(request, response));
    await Promise.resolve();
    await Promise.resolve();
    expect(counters).toEqual({
      configLoads: 1,
      compositions: 1,
      secretReads: 5,
      publicKeyReads: 1,
      requests: 0,
    });
    release();
    await Promise.all(requests);

    expect(counters.requests).toBe(16);
    expect(responses.every(({ state }) => state.statusCode === 204)).toBe(true);
    expect(Object.isFrozen(runtime)).toBe(true);
  });

  test('latches initialization failure and returns a fixed non-cacheable 503 without retrying', async () => {
    const counters = {
      configLoads: 0,
      compositions: 0,
      secretReads: 0,
      publicKeyReads: 0,
    };
    const runtime = createProductionFunctionRuntime('staging', {
      loadConfig() {
        counters.configLoads += 1;
        return loadedConfig();
      },
      async createControlPlane() {
        counters.compositions += 1;
        counters.secretReads += 5;
        counters.publicKeyReads += 1;
        throw new Error('projects/private-project/secrets/private-secret/versions/1');
      },
    });

    await expect(runtime.initialize()).rejects.toEqual(new ProductionConfigurationError());
    const responses = Array.from({ length: 17 }, () => recordingResponse());
    await Promise.all(responses.map(({ response }) => runtime.handle(request, response)));

    expect(counters).toEqual({
      configLoads: 1,
      compositions: 1,
      secretReads: 5,
      publicKeyReads: 1,
    });
    for (const { state } of responses) {
      expect(state.statusCode).toBe(503);
      expect(state.headers.get('cache-control')).toBe('no-store');
      expect(state.contentType).toBe('application/json');
      expect(state.body).toBe('{"error":"service_unavailable"}');
      expect(JSON.stringify(state)).not.toContain('private-project');
      expect(JSON.stringify(state)).not.toContain('private-secret');
    }
  });

  test('preserves only a classified initialization stage for startup diagnostics', async () => {
    const sensitiveCause = 'projects/private-project/secrets/private-secret/versions/1';
    const failure = new ProductionInitializationError('cloud-security');
    const runtime = createProductionFunctionRuntime('staging', {
      loadConfig: loadedConfig,
      async createControlPlane() {
        throw failure;
      },
    });

    const observed = await runtime.initialize().catch((error: unknown) => error);
    expect(observed).toBe(failure);
    expect(productionInitializationFailureEvent(observed)).toEqual({
      event: 'miakapp_control_plane_initialization_failed',
      stage: 'cloud-security',
    });
    expect(productionInitializationFailureEvent(new Error(sensitiveCause))).toEqual({
      event: 'miakapp_control_plane_initialization_failed',
      stage: 'function-runtime',
    });
    expect(JSON.stringify(productionInitializationFailureEvent(new Error(sensitiveCause))))
      .not.toContain(sensitiveCause);

    Object.defineProperty(failure, 'stage', { value: sensitiveCause });
    expect(productionInitializationFailureEvent(failure)).toEqual({
      event: 'miakapp_control_plane_initialization_failed',
      stage: 'function-runtime',
    });
  });

  test('rejects a composition result that escapes the loaded environment boundary', async () => {
    const runtime = createProductionFunctionRuntime('staging', {
      loadConfig: loadedConfig,
      async createControlPlane(): Promise<ProductionControlPlane> {
        return Object.freeze({
          application: (() => undefined) as unknown as express.Express,
          environment: 'production',
          projectId: 'miakapp-v4',
        });
      },
    });
    await expect(runtime.initialize()).rejects.toThrow(ProductionConfigurationError);
  });
});
