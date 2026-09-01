import { describe, expect, spyOn, test } from 'bun:test';
import type { Firestore } from 'firebase-admin/firestore';

import {
  EMULATOR_PUSH_DELIVERIES_COLLECTION,
  EMULATOR_PUSH_DELIVERY_SCHEMA,
  EMULATOR_PUSH_PROJECT_ID,
  FirestoreRecordingPushTransport,
  type EmulatorPushTransportConfig,
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
