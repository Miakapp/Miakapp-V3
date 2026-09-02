import { describe, expect, test } from 'bun:test';
import { GoogleAuth } from 'google-gax';

import type { CloudCallOptions } from '../../src/cloud-security.js';
import {
  createGoogleCloudSecurityClients,
  type GoogleCloudSecurityClientFactories,
  type GoogleKmsTransport,
  type GoogleSecretManagerTransport,
} from '../../src/google-cloud-clients.js';
import { ProductionConfigurationError } from '../../src/production-config.js';

describe('Google Cloud client adapters', () => {
  test('passes fresh extensible options to every generated-client call', async () => {
    const received: CloudCallOptions[] = [];
    const inspect = (options: CloudCallOptions): void => {
      expect(Object.isExtensible(options)).toBe(true);
      Object.assign(options, { otherArgs: { headers: { routing: 'synthetic' } } });
      received.push(options);
    };
    const kms: GoogleKmsTransport = {
      async getPublicKey(request, options) {
        inspect(options);
        return [{ name: request.name }];
      },
      async asymmetricSign(request, options) {
        inspect(options);
        return [{ name: request.name }];
      },
    };
    const secrets: GoogleSecretManagerTransport = {
      async accessSecretVersion(request, options) {
        inspect(options);
        return [{ name: request.name }];
      },
    };
    const auth = new GoogleAuth({ projectId: 'miakapp-v4-staging' });
    const constructions: unknown[] = [];
    const factories: GoogleCloudSecurityClientFactories = {
      kms: (options) => {
        constructions.push(options);
        return kms;
      },
      secrets: (options) => {
        constructions.push(options);
        return secrets;
      },
    };
    const clients = createGoogleCloudSecurityClients(
      auth,
      'miakapp-v4-staging',
      factories,
    );
    const original = Object.freeze({ timeout: 1_234, retry: null } as const);

    await clients.kms.getPublicKey({ name: 'kms-version' }, original);
    await clients.kms.asymmetricSign({
      name: 'kms-version',
      data: new Uint8Array([1]),
      dataCrc32c: { value: 1 },
    }, original);
    await clients.secrets.accessSecretVersion({ name: 'secret-version' }, original);

    expect(received).toHaveLength(3);
    expect(constructions).toEqual([
      {
        apiEndpoint: 'cloudkms.googleapis.com',
        auth,
        projectId: 'miakapp-v4-staging',
        universeDomain: 'googleapis.com',
      },
      {
        apiEndpoint: 'secretmanager.googleapis.com',
        auth,
        projectId: 'miakapp-v4-staging',
        universeDomain: 'googleapis.com',
      },
    ]);
    expect(received.every((options) => options !== original)).toBe(true);
    expect(received.every((options) => (
      options.timeout === 1_234 && options.retry === null
    ))).toBe(true);
    expect(Object.keys(original)).toEqual(['timeout', 'retry']);
  });

  test('rejects Google SDK logging before constructing either client', () => {
    const previous = process.env.GOOGLE_SDK_NODE_LOGGING;
    let constructions = 0;
    const factories: GoogleCloudSecurityClientFactories = {
      kms: () => {
        constructions += 1;
        throw new Error('must not construct KMS');
      },
      secrets: () => {
        constructions += 1;
        throw new Error('must not construct Secret Manager');
      },
    };
    process.env.GOOGLE_SDK_NODE_LOGGING = 'secret-manager';
    try {
      expect(() => createGoogleCloudSecurityClients(
        new GoogleAuth({ projectId: 'miakapp-v4-staging' }),
        'miakapp-v4-staging',
        factories,
      )).toThrow(ProductionConfigurationError);
      expect(constructions).toBe(0);
    } finally {
      if (previous === undefined) delete process.env.GOOGLE_SDK_NODE_LOGGING;
      else process.env.GOOGLE_SDK_NODE_LOGGING = previous;
    }
  });
});
