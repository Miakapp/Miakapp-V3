import type { JsonWebKey } from 'node:crypto';

export const HOME_ID_PATTERN = /^[a-z][a-z0-9-]{1,61}[a-z0-9]$/;
export const COORDINATOR_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
export const IDENTIFIER_PATTERN = /^[A-Za-z0-9_-]{22}$/;
export const HOME_KEY_PATTERN = /^mhk1_([A-Za-z0-9_-]{22})_([A-Za-z0-9_-]{43})$/;
export const SHA256_PATTERN = /^[A-Za-z0-9_-]{43}$/;
export const COMPONENT_ABI = 'miakapp.component/1' as const;
export const ACCESS_SCOPES = Object.freeze([
  'relay:coordinator',
  'relay:cli',
  'push:send',
  'components:publish',
] as const);

export type AccessScope = typeof ACCESS_SCOPES[number];

export const ADMISSION_OPERATIONS = Object.freeze([
  'home.create',
  'home.patch',
  'home_key.create',
  'home_key.revoke',
  'access.exchange',
  'push.destination.challenge',
  'push.destination.register',
  'push.destination.delete',
  'push.grant.create',
  'push.grant.revoke',
  'push.send',
  'component.upload.issue',
  'component.upload.deliver',
  'component.finalize',
  'component.activate',
] as const);

export type AdmissionOperation = typeof ADMISSION_OPERATIONS[number];

export const ADMISSION_BUDGETS = Object.freeze([
  'audit.events',
  'source.operations',
  'home.create.actor',
  'home.create.source',
  'access.exchange.source',
  'access.exchange.key',
  'access.exchange.home',
  'push.challenge.actor',
  'push.challenge.app',
  'push.challenge.source',
  'push.send.key',
  'push.send.home',
  'push.send.grant',
  'push.send.destination',
  'component.upload.issue.home',
  'component.upload.issue_bytes.home',
  'component.upload.delivery.upload',
  'component.upload.delivery.home',
  'component.upload.delivery_bytes.home',
  'component.finalize.home',
  'component.activate.home',
] as const);

export type AdmissionBudget = typeof ADMISSION_BUDGETS[number];

export interface AdmissionLimit {
  readonly maximum: number;
  readonly windowMilliseconds: number;
}

export interface AdmissionProfile {
  readonly limits: Readonly<Record<AdmissionBudget, AdmissionLimit>>;
  readonly auditRetentionMilliseconds: number;
  readonly auditSlots: number;
  readonly bucketSlots: number;
  readonly maximumAuditEventBytes: number;
  readonly bucketRetentionMilliseconds: number;
  readonly maximumRetryAfterSeconds: number;
}

export interface FirebasePrincipal {
  readonly userId: string;
  readonly authenticatedAt: number;
  readonly expiresAt: number;
}

export interface AppCheckPrincipal {
  readonly appId: string;
  readonly expiresAt: number;
}

export interface HomeInput {
  readonly homeId: string;
  readonly name: string;
  readonly icon: string;
  readonly relayUrl: string;
}

export interface HomeRepresentation {
  readonly home_id: string;
  readonly name: string;
  readonly icon: string;
  readonly relay_url: string;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface HomePatch {
  readonly name?: string;
  readonly icon?: string;
  readonly relayUrl?: string;
}

export interface HomeKeyMetadata {
  readonly key_id: string;
  readonly label: string;
  readonly scopes: AccessScope[];
  readonly created_at: string;
  readonly revoked_at: string | null;
  readonly last_used_at: string | null;
}

export interface PushDestinationMetadata {
  readonly destination_id: string;
  readonly provider: 'fcm';
  readonly created_at: string;
  readonly updated_at: string;
}

export interface PushGrantMetadata {
  readonly grant_id: string;
  readonly home_id: string;
  readonly destination_id: string;
  readonly created_at: string;
  readonly expires_at: string;
  readonly revoked_at: string | null;
}

export interface PushNotification {
  readonly title: string;
  readonly body: string;
  readonly tag: string | null;
}

export interface PushAccessPrincipal {
  readonly homeId: string;
  readonly clientId: string;
  readonly expiresAt: number;
}

export type ComponentPublisherPrincipal =
  | {
    readonly kind: 'owner';
    readonly homeId: string;
    readonly userId: string;
  }
  | {
    readonly kind: 'access_token';
    readonly homeId: string;
    readonly clientId: string;
  };

export interface ComponentRequirements {
  readonly state_read: readonly string[];
  readonly event_subscribe: readonly string[];
  readonly event_publish: readonly string[];
  readonly call: readonly string[];
  readonly presentation: readonly string[];
}

export interface ComponentUploadInput {
  readonly release: string;
  readonly abi: typeof COMPONENT_ABI;
  readonly sha256: string;
  readonly size: number;
  readonly requires: ComponentRequirements;
}

export interface ComponentUploadRepresentation {
  readonly schema: 'miakapp.component-upload/1';
  readonly upload_id: string;
  readonly upload_url: string;
  readonly upload_token: string;
  readonly expires_at: string;
}

export type ComponentUploadStatus = 'awaiting_upload' | 'delivered' | 'finalized';

export interface ComponentUploadStatusRepresentation extends ComponentUploadInput {
  readonly schema: 'miakapp.component-upload-status/1';
  readonly upload_id: string;
  readonly status: ComponentUploadStatus;
  readonly expires_at: string;
}

export interface ComponentReleaseRepresentation extends ComponentUploadInput {
  readonly schema: 'miakapp.component-release/1';
  readonly finalized_at: string;
}

export interface ComponentPointerRepresentation extends ComponentUploadInput {
  readonly schema: 'miakapp.component-pointer/1';
  readonly home_id: string;
  readonly generation: number;
  readonly url: string;
}

export type ExchangeRequest =
  | {
    readonly purpose: 'relay';
    readonly role: 'coordinator';
    readonly coordinatorName: string;
    readonly reason: 'initial' | 'reauth' | 'reconnect';
  }
  | {
    readonly purpose: 'relay';
    readonly role: 'cli';
    readonly reason: 'initial' | 'reauth' | 'reconnect';
  }
  | { readonly purpose: 'push' }
  | { readonly purpose: 'components' };

export interface AccessGrant {
  readonly issuedAt: number;
  readonly tokenId: string;
  readonly homeId: string;
  readonly clientId: string;
  readonly label: string;
  readonly scope: AccessScope;
  readonly audience: string;
  readonly role: 'coordinator' | 'cli' | null;
  readonly coordinatorName: string | null;
}

export type SigningPublicJwk = Readonly<{
  kty: 'OKP';
  crv: 'Ed25519';
  x: string;
  use: 'sig';
  alg: 'EdDSA';
  kid: string;
}>;

export interface DeploymentConfig {
  readonly projectId: string;
  readonly region: string;
  readonly allowedOrigins: ReadonlySet<string>;
  readonly issuer: string;
  readonly jwksUri: string;
  readonly exchangeEndpoint: string;
  readonly pushAudience: string;
  readonly componentsAudience: string;
  readonly componentBucket: string;
  readonly componentUploadBaseUrl: string;
  readonly componentArtifactBaseUrl: string;
  readonly componentKeyVersion: string;
  readonly componentHmacKeyForVersion: (version: string) => Uint8Array | undefined;
  readonly verifierKeyVersion: string;
  readonly homeKeyPepperForVersion: (version: string) => Uint8Array | undefined;
  readonly appCheckAppId: string;
  readonly pushKeyVersion: string;
  readonly pushHmacKeyForVersion: (version: string) => Uint8Array | undefined;
  readonly admissionProfile: AdmissionProfile;
  readonly auditKeyVersion: string;
  readonly auditHmacKeyForVersion: (version: string) => Uint8Array | undefined;
  readonly networkKeyVersion: string;
  readonly networkHmacKeyForVersion: (version: string) => Uint8Array | undefined;
  readonly signingPublicJwk: SigningPublicJwk;
}

export interface EmulatorDeploymentConfig extends DeploymentConfig {
  readonly appCheckIssuer: string;
  readonly appCheckAudience: string;
  readonly appCheckPublicJwk: JsonWebKey & { readonly kid: string };
  readonly signingPrivateJwk: JsonWebKey & { readonly kid: string };
}

export interface Clock {
  now(): number;
}

export const SYSTEM_CLOCK: Clock = Object.freeze({ now: () => Date.now() });
