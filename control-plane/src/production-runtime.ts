import type express from 'express';
import { Storage } from '@google-cloud/storage';
import { getAppCheck } from 'firebase-admin/app-check';
import { getApp, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { Firestore } from 'firebase-admin/firestore';

import { AdmissionController } from './admission.js';
import {
  FirebaseAdminAppCheckVerifier,
  type FirebaseAdminAppCheckClient,
} from './app-check.js';
import {
  FirebaseAdminAuthVerifier,
  type FirebaseTokenVerifier,
} from './auth.js';
import { createControlPlaneApp } from './api.js';
import {
  ProductionFirebaseComponentStorage,
  type ComponentStorageBucket,
} from './component-storage.js';
import { ComponentStore } from './component-store.js';
import {
  initializeProductionSecurity,
  type KmsClient,
  type SecretManagerClient,
} from './cloud-security.js';
import { createGoogleCloudSecurityClients } from './google-cloud-clients.js';
import {
  FirebaseFcmClient,
  FirebaseFidPushTransport,
} from './push.js';
import { PushStore } from './push-store.js';
import {
  assertProductionRuntimeEnvironment,
  createProductionDeploymentConfig,
  parseProductionRuntimeConfig,
  type ProductionRuntimeConfig,
} from './production-runtime-config.js';
import { ProductionConfigurationError } from './production-config.js';
import {
  createProductionRuntimeIdentity,
  type ProductionRuntimeIdentity,
} from './production-identity.js';
import { ControlPlaneStore } from './store.js';
import { SYSTEM_CLOCK, type Clock } from './types.js';

export interface FirebaseProductionServices {
  readonly auth: FirebaseTokenVerifier;
  readonly appCheck: FirebaseAdminAppCheckClient;
  readonly firestore: Firestore;
  readonly identity: ProductionRuntimeIdentity;
  readonly componentBucket: ComponentStorageBucket;
}

export interface ProductionRuntimeFactories {
  readonly identity: (config: ProductionRuntimeConfig) => ProductionRuntimeIdentity;
  readonly firebase: (
    config: ProductionRuntimeConfig,
    identity: ProductionRuntimeIdentity,
  ) => FirebaseProductionServices;
  readonly cloudSecurity: (
    config: ProductionRuntimeConfig,
    identity: ProductionRuntimeIdentity,
  ) => Readonly<{
    readonly kms: KmsClient;
    readonly secrets: SecretManagerClient;
  }>;
}

export interface ProductionControlPlane {
  readonly application: express.Express;
  readonly environment: 'staging' | 'production';
  readonly projectId: string;
}

export const PRODUCTION_INITIALIZATION_STAGES = Object.freeze([
  'runtime-config',
  'runtime-environment',
  'identity',
  'firebase-clients',
  'cloud-clients',
  'cloud-security',
  'application',
] as const);

export type ProductionInitializationStage =
  typeof PRODUCTION_INITIALIZATION_STAGES[number];

export function isProductionInitializationStage(
  value: unknown,
): value is ProductionInitializationStage {
  return typeof value === 'string'
    && (PRODUCTION_INITIALIZATION_STAGES as readonly string[]).includes(value);
}

export class ProductionInitializationError extends ProductionConfigurationError {
  readonly stage: ProductionInitializationStage;

  constructor(stage: ProductionInitializationStage) {
    super();
    this.name = 'ProductionInitializationError';
    this.stage = stage;
  }
}

function atStage<Value>(stage: ProductionInitializationStage, operation: () => Value): Value {
  try {
    return operation();
  } catch (error) {
    if (error instanceof ProductionInitializationError) throw error;
    throw new ProductionInitializationError(stage);
  }
}

async function atAsyncStage<Value>(
  stage: ProductionInitializationStage,
  operation: () => Promise<Value>,
): Promise<Value> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof ProductionInitializationError) throw error;
    throw new ProductionInitializationError(stage);
  }
}

const OWNED_FIREBASE_APPS = new Map<string, App>();

function firebaseApp(
  config: ProductionRuntimeConfig,
  identity: ProductionRuntimeIdentity,
): App {
  const name = `miakapp-control-plane-${config.environment}`;
  const owned = OWNED_FIREBASE_APPS.get(name);
  if (owned !== undefined) {
    if (!getApps().includes(owned)
      || owned.options.projectId !== config.security.projectId
      || owned.options.storageBucket !== config.componentBucket) {
      throw new ProductionConfigurationError();
    }
    return getApp(name);
  }
  if (getApps().some((candidate) => candidate.name === name)) {
    throw new ProductionConfigurationError();
  }
  const app = initializeApp({
    credential: identity.firebaseCredential,
    projectId: config.security.projectId,
    storageBucket: config.componentBucket,
  }, name);
  OWNED_FIREBASE_APPS.set(name, app);
  return app;
}

export function createFirebaseProductionServices(
  config: ProductionRuntimeConfig,
  identity: ProductionRuntimeIdentity,
): FirebaseProductionServices {
  const app = firebaseApp(config, identity);
  const componentStorage = new Storage({
    apiEndpoint: 'https://storage.googleapis.com',
    authClient: identity.authClient,
    projectId: config.security.projectId,
    retryOptions: Object.freeze({ autoRetry: false, maxRetries: 0 }),
    universeDomain: 'googleapis.com',
  });
  const firestore = new Firestore({
    auth: identity.googleAuth,
    databaseId: '(default)',
    projectId: config.security.projectId,
    servicePath: 'firestore.googleapis.com',
    universeDomain: 'googleapis.com',
  });
  return Object.freeze({
    auth: new FirebaseAdminAuthVerifier(getAuth(app)),
    appCheck: getAppCheck(app),
    firestore,
    identity,
    componentBucket: componentStorage.bucket(config.componentBucket),
  });
}

const DEFAULT_FACTORIES: ProductionRuntimeFactories = Object.freeze({
  identity: createProductionRuntimeIdentity,
  firebase: createFirebaseProductionServices,
  cloudSecurity: (
    config: ProductionRuntimeConfig,
    identity: ProductionRuntimeIdentity,
  ) => createGoogleCloudSecurityClients(
    identity.googleAuth,
    config.security.projectId,
  ),
});

export async function createProductionControlPlane(
  input: unknown,
  options: Readonly<{
    readonly environment?: Readonly<Record<string, string | undefined>>;
    readonly factories?: ProductionRuntimeFactories;
    readonly clock?: Clock;
  }> = {},
): Promise<ProductionControlPlane> {
  const runtime = atStage('runtime-config', () => parseProductionRuntimeConfig(input));
  const customEnvironment = options.environment !== undefined;
  const customFactories = options.factories !== undefined;
  if (customEnvironment !== customFactories) {
    throw new ProductionInitializationError('runtime-environment');
  }
  const environment = options.environment ?? process.env;
  atStage('runtime-environment', () => assertProductionRuntimeEnvironment(runtime, environment));
  const factories = options.factories ?? DEFAULT_FACTORIES;
  const clock = options.clock ?? SYSTEM_CLOCK;
  const identity = atStage('identity', () => factories.identity(runtime));
  if (identity.serviceAccountEmail !== runtime.serviceAccountEmail) {
    throw new ProductionInitializationError('identity');
  }
  const firebase = atStage('firebase-clients', () => factories.firebase(runtime, identity));
  if (firebase.identity !== identity) {
    throw new ProductionInitializationError('firebase-clients');
  }
  const cloud = atStage('cloud-clients', () => factories.cloudSecurity(runtime, identity));
  const security = await atAsyncStage(
    'cloud-security',
    () => initializeProductionSecurity(runtime.security, cloud),
  );
  const { application, config } = atStage('application', () => {
    const config = createProductionDeploymentConfig(runtime, security.secrets);
    const componentStorage = new ProductionFirebaseComponentStorage(
      firebase.componentBucket,
      {
        environment: runtime.environment,
        projectId: config.projectId,
        functionsEmulator: false,
        storageEmulatorHost: environment.STORAGE_EMULATOR_HOST || undefined,
        bucketName: config.componentBucket,
      },
    );
    const admission = new AdmissionController(firebase.firestore, config, clock);
    const store = new ControlPlaneStore(firebase.firestore, config, clock);
    const pushStore = new PushStore(firebase.firestore, config, clock);
    const componentStore = new ComponentStore(firebase.firestore, componentStorage, config, clock);
    const pushTransport = new FirebaseFidPushTransport(new FirebaseFcmClient(
      identity.firebaseCredential,
      {
        environment: runtime.environment,
        projectId: config.projectId,
      },
    ), {
      environment: runtime.environment,
      projectId: config.projectId,
    });
    const appCheck = new FirebaseAdminAppCheckVerifier(firebase.appCheck, config.appCheckAppId);
    const application = createControlPlaneApp({
      admission,
      appCheck,
      auth: firebase.auth,
      clock,
      config,
      signer: security.signer,
      store,
      pushStore,
      pushTransport,
      componentStore,
    });
    return { application, config };
  });
  return Object.freeze({
    application,
    environment: runtime.environment,
    projectId: config.projectId,
  });
}
