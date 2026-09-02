import { KeyManagementServiceClient } from '@google-cloud/kms';
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import type { GoogleAuth } from 'google-gax';

import type {
  CloudCallOptions,
  KmsClient,
  KmsPublicKeyResponse,
  KmsSignResponse,
  SecretManagerAccessResponse,
  SecretManagerClient,
} from './cloud-security.js';
import { ProductionConfigurationError } from './production-config.js';

export interface GoogleKmsTransport {
  getPublicKey(
    request: Readonly<{ readonly name: string }>,
    options: CloudCallOptions,
  ): Promise<unknown>;
  asymmetricSign(
    request: Readonly<{
      readonly name: string;
      readonly data: Uint8Array;
      readonly dataCrc32c: Readonly<{ readonly value: number }>;
    }>,
    options: CloudCallOptions,
  ): Promise<unknown>;
}

export interface GoogleSecretManagerTransport {
  accessSecretVersion(
    request: Readonly<{ readonly name: string }>,
    options: CloudCallOptions,
  ): Promise<unknown>;
}

export interface GoogleCloudSecurityClientFactories {
  readonly kms: (options: GoogleCloudClientConstructionOptions) => GoogleKmsTransport;
  readonly secrets: (options: GoogleCloudClientConstructionOptions) => GoogleSecretManagerTransport;
}

export interface GoogleCloudClientConstructionOptions {
  readonly apiEndpoint: string;
  readonly auth: GoogleAuth;
  readonly projectId: string;
  readonly universeDomain: 'googleapis.com';
}

export interface GoogleCloudSecurityClients {
  readonly kms: KmsClient;
  readonly secrets: SecretManagerClient;
}

const GOOGLE_CLIENT_FACTORIES: GoogleCloudSecurityClientFactories = Object.freeze({
  kms: ({
    apiEndpoint,
    auth,
    projectId,
    universeDomain,
  }: GoogleCloudClientConstructionOptions) => new KeyManagementServiceClient({
    apiEndpoint,
    auth,
    projectId,
    universeDomain,
  }),
  secrets: ({
    apiEndpoint,
    auth,
    projectId,
    universeDomain,
  }: GoogleCloudClientConstructionOptions) => new SecretManagerServiceClient({
    apiEndpoint,
    auth,
    projectId,
    universeDomain,
  }),
});

function checkedTuple<Response>(result: unknown): readonly [Response] {
  if (!Array.isArray(result)) return [undefined as Response];
  return [result[0] as Response];
}

export function assertGoogleSdkLoggingDisabled(
  environment: Readonly<Record<string, string | undefined>>,
): void {
  const setting = environment.GOOGLE_SDK_NODE_LOGGING;
  if (setting !== undefined && setting.length !== 0) {
    throw new ProductionConfigurationError();
  }
}

export function createGoogleCloudSecurityClients(
  auth: GoogleAuth,
  projectId: string,
  factories: GoogleCloudSecurityClientFactories = GOOGLE_CLIENT_FACTORIES,
): GoogleCloudSecurityClients {
  assertGoogleSdkLoggingDisabled(process.env);
  const kms = factories.kms({
    apiEndpoint: 'cloudkms.googleapis.com',
    auth,
    projectId,
    universeDomain: 'googleapis.com',
  });
  const secrets = factories.secrets({
    apiEndpoint: 'secretmanager.googleapis.com',
    auth,
    projectId,
    universeDomain: 'googleapis.com',
  });
  return Object.freeze({
    kms: Object.freeze({
      async getPublicKey(
        request: Readonly<{ readonly name: string }>,
        options: CloudCallOptions,
      ) {
        const response = await kms.getPublicKey(request, { ...options });
        return checkedTuple<KmsPublicKeyResponse>(response);
      },
      async asymmetricSign(
        request: Readonly<{
          readonly name: string;
          readonly data: Uint8Array;
          readonly dataCrc32c: Readonly<{ readonly value: number }>;
        }>,
        options: CloudCallOptions,
      ) {
        const response = await kms.asymmetricSign(request, { ...options });
        return checkedTuple<KmsSignResponse>(response);
      },
    }),
    secrets: Object.freeze({
      async accessSecretVersion(
        request: Readonly<{ readonly name: string }>,
        options: CloudCallOptions,
      ) {
        const response = await secrets.accessSecretVersion(request, { ...options });
        return checkedTuple<SecretManagerAccessResponse>(response);
      },
    }),
  });
}
