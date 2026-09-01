import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { onRequest } from 'firebase-functions/v2/https';

import { createControlPlaneApp } from './api.js';
import { loadEmulatorConfig } from './config.js';
import { AccessTokenSigner } from './crypto.js';
import { FirebaseComponentStorage } from './component-storage.js';
import { ComponentStore } from './component-store.js';
import { FirestoreRecordingPushTransport } from './push.js';
import { PushStore } from './push-store.js';
import { ControlPlaneStore } from './store.js';
import { SYSTEM_CLOCK } from './types.js';

const config = loadEmulatorConfig();
const firebase = initializeApp({ projectId: config.projectId });
const auth = getAuth(firebase);
const firestore = getFirestore(firebase);
const componentStorage = new FirebaseComponentStorage(
  getStorage(firebase).bucket(config.componentBucket),
  {
    projectId: config.projectId,
    functionsEmulator: process.env.FUNCTIONS_EMULATOR === 'true',
    storageEmulatorHost: process.env.FIREBASE_STORAGE_EMULATOR_HOST,
    bucketName: config.componentBucket,
  },
);
const componentStore = new ComponentStore(firestore, componentStorage, config, SYSTEM_CLOCK);
const store = new ControlPlaneStore(firestore, config, SYSTEM_CLOCK);
const pushStore = new PushStore(firestore, config, SYSTEM_CLOCK);
const pushTransport = new FirestoreRecordingPushTransport(firestore, {
  projectId: config.projectId,
  functionsEmulator: process.env.FUNCTIONS_EMULATOR === 'true',
  firestoreEmulatorHost: process.env.FIRESTORE_EMULATOR_HOST,
});
const signer = new AccessTokenSigner(config);
const app = createControlPlaneApp({
  auth,
  clock: SYSTEM_CLOCK,
  config,
  signer,
  store,
  pushStore,
  pushTransport,
  componentStore,
});

export const controlPlaneApi = onRequest({
  region: config.region,
  cors: false,
  concurrency: 16,
  maxInstances: 4,
  timeoutSeconds: 30,
}, app);
