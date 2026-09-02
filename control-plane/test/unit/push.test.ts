import { describe, expect, spyOn, test } from 'bun:test';
import type { Credential } from 'firebase-admin/app';
import type { Firestore } from 'firebase-admin/firestore';

import {
  EMULATOR_PUSH_DELIVERIES_COLLECTION,
  EMULATOR_PUSH_DELIVERY_SCHEMA,
  EMULATOR_PUSH_PROJECT_ID,
  FirebaseFcmClient,
  FirebaseFidPushTransport,
  FirestoreRecordingPushTransport,
  type EmulatorPushTransportConfig,
  type FirebaseFidMessage,
  type FirebaseFcmRequest,
  type FirebaseFcmRequestInit,
  type FirebaseMessagingClient,
} from '../../src/push.js';

interface CapturedWrite {
  readonly collectionPath: string;
  readonly data: Record<string, unknown>;
}

function recordingFirestore(): {
  readonly firestore: Firestore;
  readonly writes: CapturedWrite[];
  readonly collectionCalls: () => number;
} {
  const writes: CapturedWrite[] = [];
  let collectionCallCount = 0;
  const firestore = {
    collection(collectionPath: string) {
      collectionCallCount += 1;
      return {
        add(data: Record<string, unknown>) {
          writes.push({ collectionPath, data });
          return Promise.resolve({ id: `delivery-${writes.length}` });
        },
      };
    },
  } as unknown as Firestore;
  return {
    firestore,
    writes,
    collectionCalls: () => collectionCallCount,
  };
}

const VALID_CONFIG: EmulatorPushTransportConfig = Object.freeze({
  projectId: EMULATOR_PUSH_PROJECT_ID,
  functionsEmulator: true,
  firestoreEmulatorHost: '127.0.0.1:8080',
});

describe('FirestoreRecordingPushTransport', () => {
  test('rejects every non-demo or non-emulator configuration before touching Firestore', () => {
    const invalidConfigs: readonly EmulatorPushTransportConfig[] = [
      { ...VALID_CONFIG, projectId: 'production-project' },
      { ...VALID_CONFIG, functionsEmulator: false },
      { ...VALID_CONFIG, firestoreEmulatorHost: undefined },
      { ...VALID_CONFIG, firestoreEmulatorHost: '   ' },
    ];

    for (const config of invalidConfigs) {
      const recorder = recordingFirestore();
      expect(() => new FirestoreRecordingPushTransport(recorder.firestore, config))
        .toThrow('restricted to the demo Firebase Emulator project');
      expect(recorder.collectionCalls()).toBe(0);
      expect(recorder.writes).toHaveLength(0);
    }
  });

  test('has no Firestore effect until a delivery method is called', () => {
    const recorder = recordingFirestore();
    new FirestoreRecordingPushTransport(recorder.firestore, VALID_CONFIG);

    expect(recorder.collectionCalls()).toBe(0);
    expect(recorder.writes).toHaveLength(0);
  });

  test('records one challenge delivery with a closed emulator schema', async () => {
    const recorder = recordingFirestore();
    const transport = new FirestoreRecordingPushTransport(recorder.firestore, VALID_CONFIG);

    await transport.sendChallenge({
      fid: 'firebase-installation-id',
      challengeId: 'challenge-id',
      challengeSecret: 'challenge-secret',
    });

    expect(recorder.collectionCalls()).toBe(1);
    expect(recorder.writes).toEqual([{
      collectionPath: EMULATOR_PUSH_DELIVERIES_COLLECTION,
      data: {
        schema: EMULATOR_PUSH_DELIVERY_SCHEMA,
        delivery_type: 'challenge',
        provider: 'fcm',
        fid: 'firebase-installation-id',
        payload: {
          challenge_id: 'challenge-id',
          challenge_secret: 'challenge-secret',
        },
        recorded_at: expect.anything(),
      },
    }]);
  });

  test('records one semantic notification and preserves an absent tag as null', async () => {
    const recorder = recordingFirestore();
    const transport = new FirestoreRecordingPushTransport(recorder.firestore, VALID_CONFIG);

    await transport.sendSemanticNotification({
      fid: 'firebase-installation-id',
      homeId: 'synthetic-home',
      grantId: 'grant-id',
      title: 'Window opened',
      body: 'The kitchen window is open.',
      tag: null,
    });

    expect(recorder.collectionCalls()).toBe(1);
    expect(recorder.writes).toEqual([{
      collectionPath: EMULATOR_PUSH_DELIVERIES_COLLECTION,
      data: {
        schema: EMULATOR_PUSH_DELIVERY_SCHEMA,
        delivery_type: 'semantic_notification',
        provider: 'fcm',
        fid: 'firebase-installation-id',
        payload: {
          grant_id: 'grant-id',
          notification: {
            title: 'Window opened',
            body: 'The kitchen window is open.',
            tag: null,
          },
        },
        recorded_at: expect.anything(),
      },
    }]);
  });

  test('never writes push payloads to console methods', async () => {
    const debug = spyOn(console, 'debug').mockImplementation(() => undefined);
    const error = spyOn(console, 'error').mockImplementation(() => undefined);
    const info = spyOn(console, 'info').mockImplementation(() => undefined);
    const log = spyOn(console, 'log').mockImplementation(() => undefined);
    const warn = spyOn(console, 'warn').mockImplementation(() => undefined);

    try {
      const recorder = recordingFirestore();
      const transport = new FirestoreRecordingPushTransport(recorder.firestore, VALID_CONFIG);
      await transport.sendChallenge({
        fid: 'private-fid',
        challengeId: 'private-challenge-id',
        challengeSecret: 'private-challenge-secret',
      });
      await transport.sendSemanticNotification({
        fid: 'private-fid',
        homeId: 'synthetic-home',
        grantId: 'private-grant-id',
        title: 'private-title',
        body: 'private-body',
        tag: 'private-tag',
      });

      for (const consoleSpy of [debug, error, info, log, warn]) {
        expect(consoleSpy).not.toHaveBeenCalled();
      }
    } finally {
      debug.mockRestore();
      error.mockRestore();
      info.mockRestore();
      log.mockRestore();
      warn.mockRestore();
    }
  });
});

describe('FirebaseFidPushTransport', () => {
  test('sends one exact data-only challenge to the verified FID', async () => {
    const calls: unknown[][] = [];
    const messaging: FirebaseMessagingClient = {
      async send(...args: [FirebaseFidMessage]) {
        calls.push(args);
      },
    };
    const transport = new FirebaseFidPushTransport(messaging, {
      environment: 'staging',
      projectId: 'miakapp-v4-staging',
    });

    await transport.sendChallenge({
      fid: 'registered-firebase-installation-id',
      challengeId: 'challenge-id',
      challengeSecret: 'challenge-secret',
    });

    expect(calls).toEqual([[{
      fid: 'registered-firebase-installation-id',
      data: {
        schema: 'miakapp.push-challenge-delivery/1',
        challenge_id: 'challenge-id',
        challenge_secret: 'challenge-secret',
      },
    }]]);
  });

  test('sends one closed semantic notification without caller-supplied FCM options', async () => {
    const messages: FirebaseFidMessage[] = [];
    const transport = new FirebaseFidPushTransport({
      async send(message) {
        messages.push(message);
      },
    }, {
      environment: 'production',
      projectId: 'miakapp-v4',
    });

    await transport.sendSemanticNotification({
      fid: 'registered-firebase-installation-id',
      homeId: 'synthetic-home',
      grantId: 'grant-id',
      title: 'Window opened',
      body: 'The kitchen window is open.',
      tag: null,
    });

    expect(messages).toEqual([{
      fid: 'registered-firebase-installation-id',
      notification: {
        title: 'Window opened',
        body: 'The kitchen window is open.',
      },
      data: {
        schema: 'miakapp.semantic-notification/1',
        home_id: 'synthetic-home',
        grant_id: 'grant-id',
        tag: '',
      },
    }]);
  });

  test('normalizes one failed send without retrying or exposing provider details', async () => {
    let calls = 0;
    const transport = new FirebaseFidPushTransport({
      async send() {
        calls += 1;
        throw new Error('private FID and provider response');
      },
    }, {
      environment: 'staging',
      projectId: 'miakapp-v4-staging',
    });

    await expect(transport.sendChallenge({
      fid: 'private-fid',
      challengeId: 'challenge-id',
      challengeSecret: 'challenge-secret',
    })).rejects.toMatchObject({
      name: 'PushTransportError',
      message: 'Push delivery is unavailable',
    });
    expect(calls).toBe(1);
  });

  test('rejects cross-environment configuration and malformed delivery before sending', async () => {
    let calls = 0;
    const messaging: FirebaseMessagingClient = {
      async send() {
        calls += 1;
      },
    };
    expect(() => new FirebaseFidPushTransport(messaging, {
      environment: 'staging',
      projectId: 'miakapp-v4',
    })).toThrow(/configuration is invalid/);

    const transport = new FirebaseFidPushTransport(messaging, {
      environment: 'staging',
      projectId: 'miakapp-v4-staging',
    });
    await expect(transport.sendSemanticNotification({
      fid: 'fid',
      homeId: 'Synthetic-Home',
      grantId: 'grant-id',
      title: '<b>private</b>',
      body: 'body',
      tag: null,
    })).rejects.toMatchObject({ name: 'PushTransportError' });
    expect(calls).toBe(0);
  });
});

describe('FirebaseFcmClient', () => {
  const credential: Credential = {
    async getAccessToken() {
      return { access_token: 'metadata-access-token', expires_in: 3_600 };
    },
  };

  test('makes one exact FCM v1 request with the metadata credential', async () => {
    const calls: Array<Readonly<{ url: string; init: FirebaseFcmRequestInit }>> = [];
    const request: FirebaseFcmRequest = {
      async send(url, init) {
        calls.push({ url, init });
        return { ok: true, status: 200 };
      },
    };
    const client = new FirebaseFcmClient(credential, {
      environment: 'staging',
      projectId: 'miakapp-v4-staging',
    }, request);
    const message: FirebaseFidMessage = {
      fid: 'registered-firebase-installation-id',
      data: { schema: 'miakapp.push-challenge-delivery/1' },
    };

    await client.send(message);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url)
      .toBe('https://fcm.googleapis.com/v1/projects/miakapp-v4-staging/messages:send');
    expect(calls[0]?.init).toMatchObject({
      method: 'POST',
      headers: {
        Authorization: 'Bearer metadata-access-token',
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({ message }),
    });
    expect(calls[0]?.init.signal).toBeInstanceOf(AbortSignal);
  });

  test('normalizes provider failures after exactly one attempted request', async () => {
    for (const behavior of ['response', 'transport'] as const) {
      let calls = 0;
      const request: FirebaseFcmRequest = {
        async send() {
          calls += 1;
          if (behavior === 'transport') throw new Error('private provider detail');
          return { ok: false, status: 503 };
        },
      };
      const client = new FirebaseFcmClient(credential, {
        environment: 'production',
        projectId: 'miakapp-v4',
      }, request);

      await expect(client.send({
        fid: 'registered-firebase-installation-id',
        data: { schema: 'miakapp.push-challenge-delivery/1' },
      })).rejects.toMatchObject({
        name: 'PushTransportError',
        message: 'Push delivery is unavailable',
      });
      expect(calls).toBe(1);
    }
  });

  test('rejects malformed credentials and cross-project configuration before a request', async () => {
    let requests = 0;
    const request: FirebaseFcmRequest = {
      async send() {
        requests += 1;
        return { ok: true, status: 200 };
      },
    };
    expect(() => new FirebaseFcmClient(credential, {
      environment: 'staging',
      projectId: 'miakapp-v4',
    }, request)).toThrow(/configuration is invalid/);

    const invalidCredential: Credential = {
      async getAccessToken() {
        return { access_token: '', expires_in: 3_600 };
      },
    };
    const client = new FirebaseFcmClient(invalidCredential, {
      environment: 'staging',
      projectId: 'miakapp-v4-staging',
    }, request);
    await expect(client.send({ fid: 'fid', data: {} }))
      .rejects.toMatchObject({ name: 'PushTransportError' });
    expect(requests).toBe(0);
  });
});
