import {
  REQUEST_JSON_LIMITS,
  parseRequestJson,
  type JsonValue,
} from './json.js';
import {
  ProductionConfigurationError,
  type ProductionEnvironment,
} from './production-config.js';
import {
  parseProductionRuntimeConfig,
  type ProductionRuntimeConfig,
} from './production-runtime-config.js';

export const PRODUCTION_RUNTIME_CONFIG_VARIABLE = 'MIAKAPP_RUNTIME_CONFIG_JSON';
export const MAXIMUM_PRODUCTION_RUNTIME_CONFIG_BYTES = REQUEST_JSON_LIMITS.maximumBytes;

export interface LoadedProductionRuntimeDocument {
  readonly document: JsonValue;
  readonly config: ProductionRuntimeConfig;
}

function fail(): never {
  throw new ProductionConfigurationError();
}

export function loadProductionRuntimeConfig(
  expectedEnvironment: ProductionEnvironment,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): LoadedProductionRuntimeDocument {
  try {
    if (expectedEnvironment !== 'staging' && expectedEnvironment !== 'production') fail();
    const source = environment[PRODUCTION_RUNTIME_CONFIG_VARIABLE];
    if (source === undefined
      || source.length === 0
      || Buffer.byteLength(source, 'utf8') > MAXIMUM_PRODUCTION_RUNTIME_CONFIG_BYTES) {
      fail();
    }
    const document = parseRequestJson(Buffer.from(source, 'utf8'));
    const config = parseProductionRuntimeConfig(document);
    if (config.environment !== expectedEnvironment) fail();
    return Object.freeze({ document, config });
  } catch {
    throw new ProductionConfigurationError();
  }
}
