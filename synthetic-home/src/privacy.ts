import { isIP } from 'node:net';
import { isPlainRecord } from './contract.js';

export interface PrivacyFinding {
  code: string;
  path: string;
  message: string;
}

const SECRET_KEY_PARTS = new Set([
  'authorization',
  'cookie',
  'credential',
  'credentials',
  'passwd',
  'password',
  'secret',
  'token',
]);
const IDENTIFYING_KEY_PARTS = new Set([
  'address',
  'broker',
  'bssid',
  'endpoint',
  'host',
  'hostname',
  'imei',
  'ip',
  'lat',
  'latitude',
  'location',
  'lon',
  'longitude',
  'mac',
  'serial',
  'ssid',
  'topic',
]);
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const MAC_ADDRESS = /\b(?:[0-9a-f]{2}:){5}[0-9a-f]{2}\b/i;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i;
const LONG_HEX = /\b[0-9a-f]{32,}\b/i;
const TOKEN_LIKE = /\b(?=[A-Za-z0-9_+/-]{32,}\b)(?=[A-Za-z0-9_+/-]*[A-Z])(?=[A-Za-z0-9_+/-]*[a-z])(?=[A-Za-z0-9_+/-]*\d)[A-Za-z0-9_+/-]+={0,2}\b/;
const PROVIDER_TOKEN = /\b(?:A(?:KI|SI)A[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{30,}|AIza[0-9A-Za-z_-]{35}|xox[baprs]-[0-9A-Za-z-]{10,})\b/;
const ABSOLUTE_PATH = /^(?:\/(?!\/)|[A-Za-z]:\\|\\\\[^\\\r\n]+\\[^\\\r\n]+)/;
const ENDPOINT_SCHEME = /\b(?:amqps?|mqtts?|postgres(?:ql)?|rediss?|ssh|tcp|wss?):\/\//i;
const IPV6_CANDIDATE = /[0-9a-f]*:[0-9a-f:]+/gi;
const PRIVATE_HOSTNAME = /\b[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.(?:home|internal|lan|local|localdomain)\b/i;
const UTC_TIMESTAMP = /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z\b/g;
const URL_CANDIDATE = /\bhttps?:\/\/[^\s"'<>]+/gi;

export class PrivacyViolation extends Error {
  readonly findings: readonly PrivacyFinding[];

  constructor(findings: readonly PrivacyFinding[]) {
    super(findings.map(({ code, path }) => `${code} at ${path}`).join('; '));
    this.name = 'PrivacyViolation';
    this.findings = findings;
  }
}

function ipv4Addresses(value: string): string[] {
  const candidates = value.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g) ?? [];
  return candidates.filter((candidate) => (
    candidate.split('.').every((part) => Number(part) >= 0 && Number(part) <= 255)
  ));
}

function ipv6Addresses(value: string): string[] {
  return (value.match(IPV6_CANDIDATE) ?? []).filter((candidate) => isIP(candidate) === 6);
}

function keyParts(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter((part) => part.length > 0)
    .map((part) => part.toLowerCase());
}

function isSecretKey(key: string): boolean {
  const parts = keyParts(key);
  return parts.some((part) => SECRET_KEY_PARTS.has(part))
    || parts.some((part, index) => (
      part === 'key' && ['api', 'private'].includes(parts[index - 1] ?? '')
    ));
}

function isIdentifyingKey(key: string): boolean {
  const parts = keyParts(key);
  return parts.some((part) => IDENTIFYING_KEY_PARTS.has(part))
    || parts.some((part, index) => (
      part === 'id' && ['client', 'coord'].includes(parts[index - 1] ?? '')
    ));
}

function addFinding(
  findings: PrivacyFinding[],
  code: string,
  path: string,
  message: string,
): void {
  findings.push({ code, path, message });
}

function scanString(value: string, path: string, findings: PrivacyFinding[]): void {
  if (ABSOLUTE_PATH.test(value)) {
    addFinding(findings, 'absolute_path', path, 'absolute host paths are not public fixture data');
  }
  if (ipv4Addresses(value).length > 0) {
    addFinding(findings, 'ip_address', path, 'IP addresses are not public fixture data');
  }
  if (ipv6Addresses(value).length > 0) {
    addFinding(findings, 'ip_address', path, 'IP addresses are not public fixture data');
  }
  if (MAC_ADDRESS.test(value)) {
    addFinding(findings, 'hardware_identifier', path, 'hardware addresses are not public fixture data');
  }
  if (EMAIL.test(value)) {
    addFinding(findings, 'email_address', path, 'email addresses are not public fixture data');
  }
  if (UUID.test(value)) {
    addFinding(findings, 'opaque_identifier', path, 'UUID-shaped identifiers are not allowed');
  }
  if (LONG_HEX.test(value) || TOKEN_LIKE.test(value) || PROVIDER_TOKEN.test(value)) {
    addFinding(findings, 'token_like_value', path, 'high-entropy token-shaped values are not allowed');
  }
  if (ENDPOINT_SCHEME.test(value)) {
    addFinding(findings, 'active_endpoint', path, 'active transport endpoints are not allowed');
  }
  if (PRIVATE_HOSTNAME.test(value)) {
    addFinding(findings, 'private_hostname', path, 'private host names are not public fixture data');
  }

  for (const candidate of value.match(URL_CANDIDATE) ?? []) {
    try {
      const url = new URL(candidate);
      const reservedHost = url.hostname === 'test'
        || url.hostname.endsWith('.test')
        || url.hostname === 'example'
        || url.hostname.endsWith('.example');
      const secretQuery = [...url.searchParams.keys()].some(isSecretKey);
      if (!reservedHost
        || url.username !== ''
        || url.password !== ''
        || url.port !== ''
        || secretQuery
        || url.hash !== '') {
        addFinding(
          findings,
          'non_reserved_url',
          path,
          'fixture URLs must use a reserved host without credentials, a port, or secret metadata',
        );
      }
    } catch {
      addFinding(findings, 'invalid_url', path, 'URL-shaped fixture text must be parseable');
    }
  }

  for (const timestamp of value.match(UTC_TIMESTAMP) ?? []) {
    if (!timestamp.startsWith('2042-')) {
      addFinding(
        findings,
        'non_synthetic_time',
        path,
        'fixture timestamps must use the designated fictional year 2042',
      );
    }
  }
}

export function scanPublicFixture(value: unknown): PrivacyFinding[] {
  const findings: PrivacyFinding[] = [];
  const seen = new WeakSet<object>();
  const stack: Array<{ value: unknown; path: string }> = [{ value, path: '$' }];

  while (stack.length > 0) {
    const current = stack.pop()!;
    if (typeof current.value === 'string') {
      scanString(current.value, current.path, findings);
      continue;
    }
    if (current.value === null || typeof current.value !== 'object') continue;
    if (seen.has(current.value)) {
      addFinding(findings, 'cyclic_value', current.path, 'fixture input must be an acyclic value');
      continue;
    }
    seen.add(current.value);

    if (Array.isArray(current.value)) {
      for (let index = current.value.length - 1; index >= 0; index -= 1) {
        stack.push({ value: current.value[index], path: `${current.path}[${index}]` });
      }
      continue;
    }
    if (!isPlainRecord(current.value)) {
      addFinding(findings, 'non_json_value', current.path, 'fixture input must contain plain JSON values');
      continue;
    }

    const keys = Object.keys(current.value);
    if (keys.includes('type') && keys.includes('wires') && keys.includes('z')) {
      addFinding(
        findings,
        'node_red_export',
        current.path,
        'raw Node-RED node structures are not allowed',
      );
    }
    for (let index = keys.length - 1; index >= 0; index -= 1) {
      const key = keys[index]!;
      const childPath = `${current.path}.${key}`;
      if (isSecretKey(key)) {
        addFinding(findings, 'secret_field', childPath, 'secret-bearing fields are not allowed');
      }
      if (isIdentifyingKey(key)) {
        addFinding(findings, 'identifying_field', childPath, 'location or hardware fields are not allowed');
      }
      scanString(key, `${childPath}#key`, findings);
      stack.push({ value: current.value[key], path: childPath });
    }
  }

  return findings;
}

export function assertPublicFixture(value: unknown): void {
  const findings = scanPublicFixture(value);
  if (findings.length > 0) throw new PrivacyViolation(findings);
}
