import { describe, expect, test } from 'bun:test';
import type { Firestore } from 'firebase-admin/firestore';

import { AdmissionController, auditOutcomeFor } from '../../src/admission.js';
import { loadEmulatorConfig } from '../../src/config.js';
import { ApiError } from '../../src/errors.js';
import { ADMISSION_BUDGETS, SYSTEM_CLOCK, type DeploymentConfig } from '../../src/types.js';

const config = loadEmulatorConfig({
  FUNCTIONS_EMULATOR: 'true',
  GCLOUD_PROJECT: 'demo-miakapp-v35',
} as NodeJS.ProcessEnv);

describe('bounded control-plane admission configuration', () => {
  test('defines every budget once and domain-separates audit from network fingerprints', () => {
    expect(Object.keys(config.admissionProfile.limits).sort()).toEqual([...ADMISSION_BUDGETS].sort());
    expect(config.auditHmacKeyForVersion(config.auditKeyVersion)).toHaveLength(32);
    expect(config.networkHmacKeyForVersion(config.networkKeyVersion)).toHaveLength(32);
    expect(config.auditHmacKeyForVersion(config.auditKeyVersion)).not.toEqual(
      config.networkHmacKeyForVersion(config.networkKeyVersion),
    );
  });

  test('rejects incomplete profiles and missing fingerprint keys before touching Firestore', () => {
    const limits = { ...config.admissionProfile.limits } as Record<string, unknown>;
    delete limits['push.send.home'];
    const incomplete = {
      ...config,
      admissionProfile: { ...config.admissionProfile, limits },
    } as unknown as DeploymentConfig;
    expect(() => new AdmissionController({} as Firestore, incomplete, SYSTEM_CLOCK))
      .toThrow('define every budget exactly once');
    expect(() => new AdmissionController({} as Firestore, {
      ...config,
      auditHmacKeyForVersion: () => undefined,
    }, SYSTEM_CLOCK)).toThrow('Audit key configuration is invalid');
  });

  test('requires one bounded Retry-After value on every rate-limit error', () => {
    const error = new ApiError('rate_limited', 17);
    expect(error).toMatchObject({
      code: 'rate_limited',
      status: 429,
      retryable: true,
      retryAfterSeconds: 17,
    });
    expect(() => new ApiError('rate_limited')).toThrow('Retry-After');
    expect(() => new ApiError('rate_limited', 301)).toThrow('Retry-After');
    expect(() => new ApiError('invalid_request', 1)).toThrow('Retry-After');
  });

  test('distinguishes definitive denials from uncertain dependency failures', () => {
    expect(auditOutcomeFor(new ApiError('invalid_request'))).toEqual({
      outcome: 'denied',
      code: 'invalid_request',
    });
    expect(auditOutcomeFor(new ApiError('temporarily_unavailable'))).toEqual({
      outcome: 'outcome_unknown',
      code: 'temporarily_unavailable',
    });
    expect(auditOutcomeFor(new Error('synthetic dependency failure'))).toEqual({
      outcome: 'outcome_unknown',
      code: 'temporarily_unavailable',
    });
  });
});
