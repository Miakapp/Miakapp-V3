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
  readonly grantId: string;
  readonly title: string;
  readonly body: string;
  readonly tag: string | null;
}

export interface PushTransport {
  sendChallenge(delivery: ChallengePushDelivery): Promise<void>;
  sendSemanticNotification(delivery: SemanticNotificationPushDelivery): Promise<void>;
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
