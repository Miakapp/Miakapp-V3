import { type JsonValue } from './json.js';
import { ContractViolation } from './json.js';

const FORBIDDEN_TEXT = [
  /miakapp-3/i,
  /cloud\.colmon/i,
  /(?:^|[^0-9])192\.168\./,
  /(?:^|[^0-9])10\.(?:[0-9]{1,3}\.){2}/,
  /@(?:gmail|outlook|hotmail|icloud)\./i,
  /firebaseio\.com/i,
] as const;
const PRIVATE_JWK_FIELDS = new Set(['d', 'p', 'q', 'dp', 'dq', 'qi']);

function visit(value: JsonValue, path: string, violations: string[]): void {
  if (typeof value === 'string') {
    for (const pattern of FORBIDDEN_TEXT) {
      if (pattern.test(value)) violations.push(`${path} matches forbidden production-like text`);
    }
    if (/^https?:|^wss?:/.test(value)) {
      try {
        const url = new URL(value);
        if (!url.hostname.endsWith('.test') && url.hostname !== 'securetoken.google.com') {
          violations.push(`${path} uses a non-synthetic host`);
        }
      } catch {
        violations.push(`${path} resembles an invalid URL`);
      }
    }
    if (value.includes('@') && !value.endsWith('@example.test')) {
      violations.push(`${path} uses a non-synthetic email`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => visit(entry, `${path}[${index}]`, violations));
    return;
  }
  if (value === null || typeof value !== 'object') return;
  for (const [key, entry] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (PRIVATE_JWK_FIELDS.has(key) && !path.startsWith('$.test_only_private_keys.')) {
      violations.push(`${childPath} exposes private key material outside the test-only container`);
    }
    visit(entry, childPath, violations);
  }
}

export function findPrivacyViolations(value: JsonValue): string[] {
  const violations: string[] = [];
  visit(value, '$', violations);
  return violations;
}

export function assertSyntheticPrivacy(value: JsonValue): void {
  const violations = findPrivacyViolations(value);
  if (violations.length > 0) {
    throw new ContractViolation('privacy_violation', violations.join('; '));
  }
}
