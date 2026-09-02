import type { Credential } from 'firebase-admin/app';
import { FieldValue, type Firestore } from 'firebase-admin/firestore';

export const EMULATOR_PUSH_PROJECT_ID = 'demo-miakapp-v4';
export const EMULATOR_PUSH_DELIVERIES_COLLECTION = 'emulatorPushDeliveries';
export const EMULATOR_PUSH_DELIVERY_SCHEMA = 'miakapp.emulator-push-delivery/1';

export interface ChallengePushDelivery {
  readonly fid: string;
  readonly challengeId: string;
  readonly challengeSecret: string;
}

export interface SemanticNotificationPushDelivery {
  readonly fid: string;
  readonly homeId: string;
  readonly grantId: string;
  readonly title: string;
  readonly body: string;
  readonly tag: string | null;
}

export interface PushTransport {
  sendChallenge(delivery: ChallengePushDelivery): Promise<void>;
  sendSemanticNotification(delivery: SemanticNotificationPushDelivery): Promise<void>;
}

export interface FirebaseFidMessage {
  readonly fid: string;
  readonly data: Readonly<Record<string, string>>;
  readonly notification?: Readonly<{
    readonly title: string;
    readonly body: string;
  }>;
}

export interface FirebaseMessagingClient {
  send(message: FirebaseFidMessage): Promise<void>;
}

export interface FirebaseFcmResponse {
  readonly ok: boolean;
  readonly status: number;
}

export interface FirebaseFcmRequestInit {
  readonly method: 'POST';
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  readonly signal: AbortSignal;
}

export interface FirebaseFcmRequest {
  send(
    url: string,
    init: FirebaseFcmRequestInit,
  ): Promise<FirebaseFcmResponse>;
}

export interface ProductionPushTransportConfig {
  readonly environment: 'staging' | 'production';
  readonly projectId: string;
}

export class PushTransportError extends Error {
  constructor() {
    super('Push delivery is unavailable');
    this.name = 'PushTransportError';
  }
}

export interface EmulatorPushTransportConfig {
  readonly projectId: string;
  readonly functionsEmulator: boolean;
  readonly firestoreEmulatorHost: string | undefined;
}

function assertDemoEmulator(config: EmulatorPushTransportConfig): void {
  if (config.projectId !== EMULATOR_PUSH_PROJECT_ID
    || config.functionsEmulator !== true
    || typeof config.firestoreEmulatorHost !== 'string'
    || config.firestoreEmulatorHost.trim().length === 0) {
    throw new Error('Push recording is restricted to the demo Firebase Emulator project');
  }
}

export class FirestoreRecordingPushTransport implements PushTransport {
  readonly #firestore: Firestore;

  constructor(firestore: Firestore, config: EmulatorPushTransportConfig) {
    assertDemoEmulator(config);
    this.#firestore = firestore;
  }

  async sendChallenge(delivery: ChallengePushDelivery): Promise<void> {
    await this.#firestore.collection(EMULATOR_PUSH_DELIVERIES_COLLECTION).add({
      schema: EMULATOR_PUSH_DELIVERY_SCHEMA,
      delivery_type: 'challenge',
      provider: 'fcm',
      fid: delivery.fid,
      payload: {
        challenge_id: delivery.challengeId,
        challenge_secret: delivery.challengeSecret,
      },
      recorded_at: FieldValue.serverTimestamp(),
    });
  }

  async sendSemanticNotification(delivery: SemanticNotificationPushDelivery): Promise<void> {
    await this.#firestore.collection(EMULATOR_PUSH_DELIVERIES_COLLECTION).add({
      schema: EMULATOR_PUSH_DELIVERY_SCHEMA,
      delivery_type: 'semantic_notification',
      provider: 'fcm',
      fid: delivery.fid,
      payload: {
        grant_id: delivery.grantId,
        notification: {
          title: delivery.title,
          body: delivery.body,
          tag: delivery.tag,
        },
      },
      recorded_at: FieldValue.serverTimestamp(),
    });
  }
}

const PRODUCTION_PUSH_PROJECTS = Object.freeze({
  staging: 'miakapp-v4-staging',
  production: 'miakapp-v4',
} as const);
const MAXIMUM_OAUTH_TOKEN_BYTES = 8_192;
const FCM_REQUEST_TIMEOUT_MILLISECONDS = 15_000;

const FETCH_FCM_REQUEST: FirebaseFcmRequest = Object.freeze({
  async send(url: string, init: FirebaseFcmRequestInit) {
    return fetch(url, init);
  },
});

function boundedTransportValue(value: string, maximumBytes: number): boolean {
  return value.length > 0
    && Buffer.byteLength(value, 'utf8') <= maximumBytes
    && !/\p{Cc}/u.test(value);
}

function validateFid(fid: string): void {
  if (!boundedTransportValue(fid, 4_096)) throw new PushTransportError();
}

export class FirebaseFcmClient implements FirebaseMessagingClient {
  readonly #credential: Credential;
  readonly #endpoint: string;
  readonly #request: FirebaseFcmRequest;

  constructor(
    credential: Credential,
    config: ProductionPushTransportConfig,
    request: FirebaseFcmRequest = FETCH_FCM_REQUEST,
  ) {
    const projectId = PRODUCTION_PUSH_PROJECTS[config.environment];
    if (projectId === undefined || projectId !== config.projectId) {
      throw new Error('Production push transport configuration is invalid');
    }
    this.#credential = credential;
    this.#endpoint = `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`;
    this.#request = request;
  }

  async send(message: FirebaseFidMessage): Promise<void> {
    try {
      const credential = await this.#credential.getAccessToken();
      if (!boundedTransportValue(credential.access_token, MAXIMUM_OAUTH_TOKEN_BYTES)
        || !Number.isSafeInteger(credential.expires_in)
        || credential.expires_in < 1
        || credential.expires_in > 86_400) {
        throw new PushTransportError();
      }
      const response = await this.#request.send(this.#endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${credential.access_token}`,
          'Content-Type': 'application/json; charset=utf-8',
        },
        body: JSON.stringify({ message }),
        signal: AbortSignal.timeout(FCM_REQUEST_TIMEOUT_MILLISECONDS),
      });
      if (!response.ok || response.status < 200 || response.status > 299) {
        throw new PushTransportError();
      }
    } catch {
      throw new PushTransportError();
    }
  }
}

export class FirebaseFidPushTransport implements PushTransport {
  readonly #messaging: FirebaseMessagingClient;

  constructor(messaging: FirebaseMessagingClient, config: ProductionPushTransportConfig) {
    if (PRODUCTION_PUSH_PROJECTS[config.environment] !== config.projectId) {
      throw new Error('Production push transport configuration is invalid');
    }
    this.#messaging = messaging;
  }

  async sendChallenge(delivery: ChallengePushDelivery): Promise<void> {
    validateFid(delivery.fid);
    if (!boundedTransportValue(delivery.challengeId, 128)
      || !boundedTransportValue(delivery.challengeSecret, 128)) {
      throw new PushTransportError();
    }
    await this.#send({
      fid: delivery.fid,
      data: {
        schema: 'miakapp.push-challenge-delivery/1',
        challenge_id: delivery.challengeId,
        challenge_secret: delivery.challengeSecret,
      },
    });
  }

  async sendSemanticNotification(delivery: SemanticNotificationPushDelivery): Promise<void> {
    validateFid(delivery.fid);
    if (!/^[a-z][a-z0-9-]{1,61}[a-z0-9]$/.test(delivery.homeId)
      || !boundedTransportValue(delivery.grantId, 128)
      || !boundedTransportValue(delivery.title, 120)
      || !boundedTransportValue(delivery.body, 1_024)
      || /[<>]/u.test(delivery.title)
      || /[<>]/u.test(delivery.body)
      || (delivery.tag !== null
        && (!boundedTransportValue(delivery.tag, 64) || /[<>]/u.test(delivery.tag)))) {
      throw new PushTransportError();
    }
    await this.#send({
      fid: delivery.fid,
      notification: {
        title: delivery.title,
        body: delivery.body,
      },
      data: {
        schema: 'miakapp.semantic-notification/1',
        home_id: delivery.homeId,
        grant_id: delivery.grantId,
        tag: delivery.tag ?? '',
      },
    });
  }

  async #send(message: FirebaseFidMessage): Promise<void> {
    try {
      await this.#messaging.send(message);
    } catch {
      throw new PushTransportError();
    }
  }
}
