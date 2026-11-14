import type { FirebaseApp } from 'firebase/app';
import { getToken as getAppCheckToken, type AppCheck } from 'firebase/app-check';
import type { Auth } from 'firebase/auth';
import { getMessaging, getToken as getMessagingToken } from 'firebase/messaging';

export interface PushSetup {
  readonly app: FirebaseApp;
  readonly auth: Auth;
  readonly appCheck: AppCheck;
  readonly controlPlaneOrigin: string;
}

const CHALLENGE_TIMEOUT_MILLISECONDS = 60_000;

export function pushSupported(): boolean {
  return typeof window !== 'undefined'
    && 'serviceWorker' in navigator
    && 'PushManager' in window
    && 'Notification' in window;
}

/** Waits for the service worker to forward the challenge the control plane pushed. */
function nextChallenge(challengeId: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      navigator.serviceWorker.removeEventListener('message', listener);
      reject(new Error('The push challenge did not arrive'));
    }, CHALLENGE_TIMEOUT_MILLISECONDS);
    function listener(event: MessageEvent): void {
      const data = event.data as { type?: unknown; challenge_id?: unknown; challenge_secret?: unknown } | null;
      if (data?.type !== 'miakapp-push-challenge' || data.challenge_id !== challengeId) return;
      if (typeof data.challenge_secret !== 'string') return;
      window.clearTimeout(timer);
      navigator.serviceWorker.removeEventListener('message', listener);
      resolve(data.challenge_secret);
    }
    navigator.serviceWorker.addEventListener('message', listener);
  });
}

/**
 * Turns on notifications for one home on this device: browser permission, FCM
 * registration, proof that this device receives pushes, then a grant that lets
 * the home's agent notify it (`miakapp notify`).
 */
export async function enablePush(setup: PushSetup, homeId: string): Promise<void> {
  if (!pushSupported()) throw new Error('This browser cannot receive notifications');
  if (await Notification.requestPermission() !== 'granted') throw new Error('Notifications were not allowed');
  const registration = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;
  // Sent as the destination `fid` field; the control plane targets it as an FCM token.
  const fid = await getMessagingToken(getMessaging(setup.app), { serviceWorkerRegistration: registration });

  const user = setup.auth.currentUser;
  if (user === null) throw new Error('Sign in first');
  const call = async (method: string, path: string, body: unknown, headers: Record<string, string> = {}) => {
    const response = await fetch(`${setup.controlPlaneOrigin}${path}`, {
      method,
      cache: 'no-store',
      credentials: 'omit',
      headers: {
        Authorization: `Bearer ${await user.getIdToken()}`,
        'X-Firebase-AppCheck': (await getAppCheckToken(setup.appCheck)).token,
        'Content-Type': 'application/json',
        ...headers,
      },
      body: JSON.stringify(body),
    });
    const parsed = await response.json() as Record<string, unknown>;
    if (!response.ok) throw new Error(`Push setup failed: ${JSON.stringify(parsed.error ?? response.status)}`);
    return parsed;
  };

  const challenge = await call('POST', '/v1/push-destinations:challenge', { provider: 'fcm', fid });
  const challengeId = challenge.challenge_id as string;
  const secret = await nextChallenge(challengeId);
  const created = await call('POST', '/v1/push-destinations:complete', {}, {
    'Miakapp-Push-Proof': `${challengeId}.${secret}`,
  });
  const destination = created.destination as { destination_id: string };
  await call('POST', `/v1/homes/${encodeURIComponent(homeId)}/push-grants`, {
    destination_id: destination.destination_id,
  });
}
