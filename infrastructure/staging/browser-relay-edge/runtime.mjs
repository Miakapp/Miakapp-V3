import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';

export const PROJECT_ID = 'miakapp-v4-staging';
export const PROJECT_NUMBER = '1072737219170';
export const REGION = 'europe-west9';
export const FUNCTION_ID = 'control-plane';
export const FUNCTION_NAME = `projects/${PROJECT_ID}/locations/${REGION}/functions/${FUNCTION_ID}`;
export const RUN_SERVICE_NAME = `projects/${PROJECT_ID}/locations/${REGION}/services/${FUNCTION_ID}`;
export const CONTROL_PLANE_URI = 'https://control-plane-aczhngqraq-od.a.run.app';
export const CANONICAL_ISSUER = 'https://control.staging.miakapp.com';
export const CANONICAL_ORIGIN = 'https://app.staging.miakapp.com';
export const EDGE_ISSUER = CONTROL_PLANE_URI;
export const EDGE_ORIGIN = 'https://miakapp-v4-staging.web.app';
export const DEPLOYED_REPOSITORY_COMMIT = 'ba4fc9caed566fa39fc66371192fb1821b4232ff';
export const DEPLOYED_SOURCE_SHA256 =
  '3e94305e17ee4df07f54f13560dac0a9491de3f89fb3ddbf4ab745c62dce8c7e';
export const CANONICAL_RUNTIME_SHA256 =
  'c018708786fc23a15f7701093b5148c0e415a2df8045af8e170e4308c2deae37';
export const EDGE_RUNTIME_SHA256 =
  '8b580e7e5d4ab1243081a4699cf1fd68783916ffcccf90651261f3a61d0813d8';
export const EDGE_PROFILE = 'staging-browser-relay-acceptance';

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function reject(message) {
  throw new Error(message);
}

const canonicalBytes = readFileSync(
  new URL('../workload/runtime-config-version-1-current.json', import.meta.url),
);
if (sha256(canonicalBytes) !== CANONICAL_RUNTIME_SHA256) {
  reject('Canonical staging runtime bytes differ from the reviewed edge rollback input');
}

let canonicalValue;
try {
  canonicalValue = JSON.parse(canonicalBytes.toString('utf8'));
} catch {
  reject('Canonical staging runtime is not valid JSON');
}
if (canonicalValue?.schema !== 'miakapp.production-runtime/2'
  || canonicalValue?.security?.schema !== 'miakapp.production-security/2'
  || canonicalValue?.security?.environment !== 'staging'
  || canonicalValue?.security?.project_id !== PROJECT_ID
  || canonicalValue?.security?.region !== REGION
  || canonicalValue?.security?.issuer !== CANONICAL_ISSUER
  || !isDeepStrictEqual(canonicalValue?.allowed_origins, [CANONICAL_ORIGIN])) {
  reject('Canonical staging runtime does not match the reviewed private profile');
}

const edgeValue = structuredClone(canonicalValue);
edgeValue.security.issuer = EDGE_ISSUER;
edgeValue.allowed_origins = [EDGE_ORIGIN];
const edgeBytes = Buffer.from(`${JSON.stringify(edgeValue)}\n`, 'utf8');
if (sha256(edgeBytes) !== EDGE_RUNTIME_SHA256) {
  reject('Derived staging edge runtime bytes differ from the reviewed digest');
}

export function runtimeBytes(profile) {
  if (profile === 'canonical') return Buffer.from(canonicalBytes);
  if (profile === EDGE_PROFILE) return Buffer.from(edgeBytes);
  return reject('Unknown staging control-plane network profile');
}

export function runtimeJson(profile) {
  return runtimeBytes(profile).toString('utf8');
}

export function runtimeProfile(value) {
  if (typeof value !== 'string') reject('Control-plane runtime environment value is missing');
  const bytes = Buffer.from(value, 'utf8');
  const digest = sha256(bytes);
  if (digest === CANONICAL_RUNTIME_SHA256 && bytes.equals(canonicalBytes)) return 'canonical';
  if (digest === EDGE_RUNTIME_SHA256 && bytes.equals(edgeBytes)) return EDGE_PROFILE;
  return reject('Control-plane runtime environment value is not a reviewed network profile');
}

export function runtimeDigest(profile) {
  if (profile === 'canonical') return CANONICAL_RUNTIME_SHA256;
  if (profile === EDGE_PROFILE) return EDGE_RUNTIME_SHA256;
  return reject('Unknown staging control-plane network profile');
}
