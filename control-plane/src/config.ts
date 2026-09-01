import { readFileSync } from 'node:fs';
import { createHmac, type JsonWebKey } from 'node:crypto';

import type { DeploymentConfig } from './types.js';

const EMULATOR_PROJECT = 'demo-miakapp-v35';
const FIXTURE_URL = new URL('../../control-plane-contract/fixtures/v1/access-tokens.json', import.meta.url);
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

interface SyntheticFixture {
  readonly provenance: {
    readonly kind: string;
    readonly contains_production_data: boolean;
    readonly test_private_keys: string;
  };
  readonly deployment: {
    readonly issuer: string;
    readonly jwks_uri: string;
    readonly exchange_endpoint: string;
    readonly push_audience: string;
    readonly components_audience: string;
  };
  readonly home_key: { readonly pepper_base64url: string };
  readonly test_only_private_keys: {
    readonly warning: string;
    readonly future: JsonWebKey & {
      readonly kty: 'OKP';
      readonly crv: 'Ed25519';
      readonly x: string;
      readonly d: string;
      readonly kid: string;
    };
    readonly firebase: JsonWebKey & {
      readonly kty: 'RSA';
      readonly n: string;
      readonly e: string;
      readonly kid: string;
    };
  };
}

function readSyntheticFixture(): SyntheticFixture {
  const parsed = JSON.parse(readFileSync(FIXTURE_URL, 'utf8')) as SyntheticFixture;
  if (parsed.provenance.kind !== 'hand_authored_synthetic'
    || parsed.provenance.contains_production_data
    || parsed.provenance.test_private_keys !== 'test_only_do_not_use'
    || parsed.test_only_private_keys.warning !== 'SYNTHETIC TEST KEYS. NEVER LOAD IN PRODUCTION.') {
    throw new Error('Control-plane emulator fixture is not explicitly synthetic');
  }
  return parsed;
}

function derivedEmulatorKey(root: Uint8Array, domain: string): Uint8Array {
  return new Uint8Array(createHmac('sha256', root)
    .update('miakapp-emulator-control-plane-v1\0', 'utf8')
    .update(domain, 'utf8')
    .digest());
}

export function assertEmulatorRuntime(environment: NodeJS.ProcessEnv = process.env): void {
  const projectId = environment.GCLOUD_PROJECT ?? environment.GOOGLE_CLOUD_PROJECT;
  if (environment.FUNCTIONS_EMULATOR !== 'true' || projectId !== EMULATOR_PROJECT) {
    throw new Error('This control-plane implementation is restricted to the demo Firebase Emulator project');
  }
}

export function loadEmulatorConfig(environment: NodeJS.ProcessEnv = process.env): DeploymentConfig {
  assertEmulatorRuntime(environment);
  const fixture = readSyntheticFixture();
  const signing = fixture.test_only_private_keys.future;
  const appCheckSigning = fixture.test_only_private_keys.firebase;
  const pepper = Buffer.from(fixture.home_key.pepper_base64url, 'base64url');
  const verifierKeyVersion = 'test-only-emulator-v1';
  const auditKeyVersion = 'test-only-emulator-audit-v1';
  const networkKeyVersion = 'test-only-emulator-network-v1';
  const auditKey = derivedEmulatorKey(pepper, 'audit-fingerprints');
  const networkKey = derivedEmulatorKey(pepper, 'network-fingerprints');
  const componentBucket = `${EMULATOR_PROJECT}.appspot.com`;
  const appCheckAppId = '1:1234567890:web:0123456789abcdef';
  if (pepper.byteLength !== 32
    || signing.d.length === 0
    || signing.x.length === 0
    || signing.kid.length === 0
    || appCheckSigning.n.length === 0
    || appCheckSigning.e.length === 0
    || appCheckSigning.kid.length === 0) {
    throw new Error('Synthetic emulator key material is invalid');
  }
  return Object.freeze({
    projectId: EMULATOR_PROJECT,
    region: 'europe-west1',
    allowedOrigins: new Set(['https://app.example.test']),
    issuer: fixture.deployment.issuer,
    jwksUri: fixture.deployment.jwks_uri,
    exchangeEndpoint: fixture.deployment.exchange_endpoint,
    pushAudience: fixture.deployment.push_audience,
    componentsAudience: fixture.deployment.components_audience,
    componentBucket,
    componentUploadBaseUrl: 'https://control.example.test/v1/component-uploads',
    componentArtifactBaseUrl: 'https://control.example.test/v1/components',
    componentKeyVersion: verifierKeyVersion,
    componentHmacKeyForVersion: (version: string) => (
      version === verifierKeyVersion ? new Uint8Array(pepper) : undefined
    ),
    verifierKeyVersion,
    homeKeyPepperForVersion: (version: string) => (
      version === verifierKeyVersion ? new Uint8Array(pepper) : undefined
    ),
    appCheckAppId,
    appCheckIssuer: 'https://firebaseappcheck.googleapis.com/1234567890',
    appCheckAudience: 'projects/1234567890',
    appCheckPublicJwk: Object.freeze({
      kty: 'RSA',
      n: appCheckSigning.n,
      e: appCheckSigning.e,
      use: 'sig',
      alg: 'RS256',
      kid: appCheckSigning.kid,
    }),
    pushKeyVersion: verifierKeyVersion,
    pushHmacKeyForVersion: (version: string) => (
      version === verifierKeyVersion ? new Uint8Array(pepper) : undefined
    ),
    admissionProfile: Object.freeze({
      limits: Object.freeze({
        'audit.events': { maximum: 4_096, windowMilliseconds: MINUTE },
        'source.operations': { maximum: 512, windowMilliseconds: MINUTE },
        'home.create.actor': { maximum: 32, windowMilliseconds: HOUR },
        'home.create.source': { maximum: 64, windowMilliseconds: HOUR },
        'access.exchange.source': { maximum: 256, windowMilliseconds: MINUTE },
        'access.exchange.key': { maximum: 32, windowMilliseconds: MINUTE },
        'access.exchange.home': { maximum: 128, windowMilliseconds: MINUTE },
        'push.challenge.actor': { maximum: 64, windowMilliseconds: MINUTE },
        'push.challenge.app': { maximum: 256, windowMilliseconds: MINUTE },
        'push.challenge.source': { maximum: 128, windowMilliseconds: MINUTE },
        'push.send.key': { maximum: 120, windowMilliseconds: MINUTE },
        'push.send.home': { maximum: 240, windowMilliseconds: MINUTE },
        'push.send.grant': { maximum: 120, windowMilliseconds: MINUTE },
        'push.send.destination': { maximum: 120, windowMilliseconds: MINUTE },
        'component.upload.issue.home': { maximum: 64, windowMilliseconds: MINUTE },
        'component.upload.issue_bytes.home': { maximum: 64 * 1_024 * 1_024, windowMilliseconds: HOUR },
        'component.upload.delivery.upload': { maximum: 8, windowMilliseconds: 15 * MINUTE },
        'component.upload.delivery.home': { maximum: 64, windowMilliseconds: MINUTE },
        'component.upload.delivery_bytes.home': { maximum: 64 * 1_024 * 1_024, windowMilliseconds: HOUR },
        'component.finalize.home': { maximum: 64, windowMilliseconds: MINUTE },
        'component.activate.home': { maximum: 64, windowMilliseconds: MINUTE },
      }),
      auditRetentionMilliseconds: 7 * DAY,
      auditSlots: 4_096,
      bucketSlots: 65_536,
      maximumAuditEventBytes: 2_048,
      bucketRetentionMilliseconds: DAY,
      maximumRetryAfterSeconds: 300,
    }),
    auditKeyVersion,
    auditHmacKeyForVersion: (version: string) => (
      version === auditKeyVersion ? new Uint8Array(auditKey) : undefined
    ),
    networkKeyVersion,
    networkHmacKeyForVersion: (version: string) => (
      version === networkKeyVersion ? new Uint8Array(networkKey) : undefined
    ),
    signingPrivateJwk: signing,
    signingPublicJwk: Object.freeze({
      kty: 'OKP',
      crv: 'Ed25519',
      x: signing.x,
      use: 'sig',
      alg: 'EdDSA',
      kid: signing.kid,
    }),
  });
}
