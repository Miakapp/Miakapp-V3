import type express from 'express';

import {
  ProductionConfigurationError,
  type ProductionEnvironment,
} from './production-config.js';
import {
  createProductionControlPlane,
  type ProductionControlPlane,
} from './production-runtime.js';
import {
  loadProductionRuntimeConfig,
  type LoadedProductionRuntimeDocument,
} from './production-runtime-loader.js';

const UNAVAILABLE_RESPONSE = '{"error":"service_unavailable"}';

export interface ProductionFunctionRuntimeDependencies {
  readonly loadConfig?: () => LoadedProductionRuntimeDocument;
  readonly createControlPlane?: (input: unknown) => Promise<ProductionControlPlane>;
}

export interface ProductionFunctionRuntime {
  readonly initialize: () => Promise<void>;
  readonly handle: (request: express.Request, response: express.Response) => Promise<void>;
}

function unavailable(response: express.Response): void {
  response
    .status(503)
    .set('Cache-Control', 'no-store')
    .type('application/json')
    .send(UNAVAILABLE_RESPONSE);
}

export function createProductionFunctionRuntime(
  expectedEnvironment: ProductionEnvironment,
  dependencies: ProductionFunctionRuntimeDependencies = {},
): ProductionFunctionRuntime {
  const loadConfig = dependencies.loadConfig
    ?? (() => loadProductionRuntimeConfig(expectedEnvironment));
  const compose = dependencies.createControlPlane ?? createProductionControlPlane;
  let initialization: Promise<ProductionControlPlane> | undefined;

  const controlPlane = (): Promise<ProductionControlPlane> => {
    initialization ??= Promise.resolve()
      .then(loadConfig)
      .then(async (loaded) => {
        if (loaded.config.environment !== expectedEnvironment) {
          throw new ProductionConfigurationError();
        }
        const composed = await compose(loaded.document);
        if (composed.environment !== expectedEnvironment
          || composed.projectId !== loaded.config.security.projectId) {
          throw new ProductionConfigurationError();
        }
        return composed;
      })
      .catch(() => {
        throw new ProductionConfigurationError();
      });
    return initialization;
  };

  const initialize = async (): Promise<void> => {
    await controlPlane();
  };

  const handle = async (
    request: express.Request,
    response: express.Response,
  ): Promise<void> => {
    let composed: ProductionControlPlane;
    try {
      composed = await controlPlane();
    } catch {
      unavailable(response);
      return;
    }
    composed.application(request, response);
  };

  return Object.freeze({ initialize, handle });
}
