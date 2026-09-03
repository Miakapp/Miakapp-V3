import { onInit } from 'firebase-functions/v2/core';
import { onRequest } from 'firebase-functions/v2/https';

import { PRODUCTION_CONTROL_PLANE_REGION } from './production-config.js';
import { createProductionFunctionRuntime } from './production-function-runtime.js';

const runtime = createProductionFunctionRuntime('staging');

export const STAGING_CONTROL_PLANE_OPTIONS = Object.freeze({
  region: PRODUCTION_CONTROL_PLANE_REGION,
  minInstances: 0,
  maxInstances: 1,
  concurrency: 16,
  timeoutSeconds: 30,
  serviceAccount: 'miakapp-control-plane@miakapp-v4-staging.iam.gserviceaccount.com',
  cors: false,
  invoker: 'private' as const,
  omit: true,
});

onInit(async () => {
  await runtime.initialize().catch(() => undefined);
});

export const controlPlane = onRequest(STAGING_CONTROL_PLANE_OPTIONS, runtime.handle);
