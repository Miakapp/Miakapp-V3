import { createHmac } from 'node:crypto';

import { loadEmulatorConfig } from '../../src/config.js';
import { ADMISSION_BUDGETS, type AdmissionBudget } from '../../src/types.js';

const PROJECT_ID = 'demo-miakapp-v4';
const config = loadEmulatorConfig({
  FUNCTIONS_EMULATOR: 'true',
  GCLOUD_PROJECT: PROJECT_ID,
} as NodeJS.ProcessEnv);
const configuredAuditKey = config.auditHmacKeyForVersion(config.auditKeyVersion);
if (configuredAuditKey === undefined) throw new Error('Synthetic admission audit key is unavailable');
const auditKey = new Uint8Array(configuredAuditKey);

const admissionSubjectReservations = new Map<string, string>();

export const RANDOM_SUBJECT_ATTEMPTS = 8;

export interface AdmissionSubjectFixture {
  readonly budget: AdmissionBudget;
  readonly subject: string;
}

function admissionSubjectBucket({ budget, subject }: AdmissionSubjectFixture): {
  readonly documentId: string;
  readonly fingerprint: string;
} {
  const fingerprint = createHmac('sha256', auditKey)
    .update('miakapp-admission-v1\0', 'utf8')
    .update(`budget:${budget}`, 'utf8')
    .update('\0', 'utf8')
    .update(subject, 'utf8')
    .digest();
  const slotsPerBudget = Math.floor(config.admissionProfile.bucketSlots / ADMISSION_BUDGETS.length);
  const budgetPartition = ADMISSION_BUDGETS.indexOf(budget) * slotsPerBudget;
  const slot = budgetPartition + (fingerprint.readUInt32BE(0) % slotsPerBudget);
  return Object.freeze({
    documentId: slot.toString(16).padStart(4, '0'),
    fingerprint: `${config.auditKeyVersion}\0${fingerprint.toString('base64url')}`,
  });
}

/**
 * Reserves the exact fixed admission buckets a randomized fixture will use.
 * A false result means callers must discard the fixture before exercising the
 * operation. Refused production mutations are never retried by this helper.
 */
export function reserveAdmissionSubjects(subjects: readonly AdmissionSubjectFixture[]): boolean {
  const candidates = new Map<string, string>();
  for (const subject of subjects) {
    const candidate = admissionSubjectBucket(subject);
    const local = candidates.get(candidate.documentId);
    const reserved = admissionSubjectReservations.get(candidate.documentId);
    if ((local !== undefined && local !== candidate.fingerprint)
      || (reserved !== undefined && reserved !== candidate.fingerprint)) {
      return false;
    }
    candidates.set(candidate.documentId, candidate.fingerprint);
  }
  for (const [documentId, fingerprint] of candidates) {
    admissionSubjectReservations.set(documentId, fingerprint);
  }
  return true;
}

export function clearAdmissionSubjectReservations(): void {
  admissionSubjectReservations.clear();
}
