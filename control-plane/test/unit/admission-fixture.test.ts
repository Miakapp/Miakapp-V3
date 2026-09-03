import { beforeEach, describe, expect, test } from 'bun:test';

import {
  clearAdmissionSubjectReservations,
  reserveAdmissionSubjects,
} from '../emulator/admission-fixture.js';

const BUDGET = 'component.upload.delivery.upload' as const;

beforeEach(() => clearAdmissionSubjectReservations());

function reserveUntilCollision(): { readonly budget: typeof BUDGET; readonly subject: string } {
  for (let index = 0; index <= 3_120; index += 1) {
    const candidate = { budget: BUDGET, subject: `fixture-subject-${index}` } as const;
    if (!reserveAdmissionSubjects([candidate])) return candidate;
  }
  throw new Error('Fixed admission partition unexpectedly had no collision');
}

describe('randomized admission subject fixtures', () => {
  test('reuse one fingerprint but reject a different subject in its fixed bucket', () => {
    const first = { budget: BUDGET, subject: 'fixture-subject-0' } as const;
    expect(reserveAdmissionSubjects([first])).toBeTrue();
    expect(reserveAdmissionSubjects([first])).toBeTrue();
    expect(reserveAdmissionSubjects([{
      budget: 'component.upload.delivery.home',
      subject: first.subject,
    }])).toBeTrue();

    expect(reserveUntilCollision().subject).toMatch(/^fixture-subject-/);
  });

  test('clears reservations with the emulator state boundary', () => {
    const rejected = reserveUntilCollision();
    expect(reserveAdmissionSubjects([rejected])).toBeFalse();
    clearAdmissionSubjectReservations();
    expect(reserveAdmissionSubjects([rejected])).toBeTrue();
  });
});
