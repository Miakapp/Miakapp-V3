import { open } from 'node:fs/promises';
import {
  CONTRACT_LIMITS,
  ContractViolation,
  type CoordinatorContractCorpus,
  validateCoordinatorContractCorpus,
} from './contract.js';

const BUILT_IN_CORPUS = new URL('../fixtures/v1/scenarios.json', import.meta.url);

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child, seen);
  return Object.freeze(value);
}

export async function loadCoordinatorContractCorpus(
  url: URL = BUILT_IN_CORPUS,
): Promise<CoordinatorContractCorpus> {
  const file = await open(url, 'r');
  let bytes: Uint8Array;
  try {
    const metadata = await file.stat();
    if (metadata.size > CONTRACT_LIMITS.corpusBytes) {
      throw new ContractViolation('limit_exceeded', 'corpus file is too large');
    }
    const bounded = Buffer.allocUnsafe(CONTRACT_LIMITS.corpusBytes + 1);
    let offset = 0;
    while (offset < bounded.byteLength) {
      const result = await file.read(bounded, offset, bounded.byteLength - offset, null);
      if (result.bytesRead === 0) break;
      offset += result.bytesRead;
    }
    bytes = bounded.subarray(0, offset);
  } finally {
    await file.close();
  }
  if (bytes.byteLength > CONTRACT_LIMITS.corpusBytes) {
    throw new ContractViolation('limit_exceeded', 'corpus file is too large');
  }
  const value = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  return deepFreeze(validateCoordinatorContractCorpus(value));
}
