export const PROJECT_ID = 'demo-miakapp-v35';

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) throw new Error(`${name} is required`);
  return value;
}

export const AUTH_HOST = requiredEnvironment('FIREBASE_AUTH_EMULATOR_HOST');
export const FIRESTORE_HOST = requiredEnvironment('FIRESTORE_EMULATOR_HOST');
export const FUNCTIONS_HOST = requiredEnvironment('FUNCTIONS_EMULATOR_HOST');
export const STORAGE_HOST = requiredEnvironment('FIREBASE_STORAGE_EMULATOR_HOST');
export const API_BASE = `http://${FUNCTIONS_HOST}/${PROJECT_ID}/europe-west1/controlPlaneApi`;
export const ALLOWED_ORIGIN = 'https://app.example.test';

export interface EmulatorUser {
  readonly idToken: string;
  readonly userId: string;
}

export async function clearFirestore(): Promise<void> {
  const response = await fetch(
    `http://${FIRESTORE_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
    { method: 'DELETE' },
  );
  if (!response.ok) throw new Error(`Firestore reset failed with ${response.status}`);
}

export async function signUp(email: string): Promise<EmulatorUser> {
  const response = await fetch(
    `http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=synthetic-api-key`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'synthetic-password-123', returnSecureToken: true }),
    },
  );
  const body = await response.json() as { idToken?: string; localId?: string };
  if (!response.ok || body.idToken === undefined || body.localId === undefined) {
    throw new Error(`Auth signup failed with ${response.status}`);
  }
  return Object.freeze({ idToken: body.idToken, userId: body.localId });
}

export interface ApiRequestOptions {
  readonly token?: string;
  readonly homeKey?: string;
  readonly accessToken?: string;
  readonly appCheckToken?: string;
  readonly pushProof?: string;
  readonly body?: unknown;
  readonly rawBody?: string;
  readonly origin?: string;
  readonly cookie?: string;
}

export async function apiRequest(
  method: string,
  path: string,
  options: ApiRequestOptions = {},
): Promise<Response> {
  const headers = new Headers();
  headers.set('Origin', options.origin ?? ALLOWED_ORIGIN);
  if (options.token !== undefined) headers.set('Authorization', `Bearer ${options.token}`);
  if (options.homeKey !== undefined) headers.set('Authorization', `Bearer ${options.homeKey}`);
  if (options.accessToken !== undefined) headers.set('Authorization', `Bearer ${options.accessToken}`);
  if (options.appCheckToken !== undefined) headers.set('X-Firebase-AppCheck', options.appCheckToken);
  if (options.pushProof !== undefined) headers.set('Miakapp-Push-Proof', options.pushProof);
  if (options.cookie !== undefined) headers.set('Cookie', options.cookie);
  let body: string | undefined;
  if (options.rawBody !== undefined) {
    body = options.rawBody;
    headers.set('Content-Type', 'application/json');
  } else if (options.body !== undefined) {
    body = JSON.stringify(options.body);
    headers.set('Content-Type', 'application/json');
  }
  return fetch(`${API_BASE}${path}`, { method, headers, ...(body === undefined ? {} : { body }) });
}

export async function jsonResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Expected JSON response, received ${response.status}: ${text}`);
  }
}

export async function staleAuthenticationToken(user: EmulatorUser): Promise<string> {
  const authenticatedAt = Math.floor(Date.now() / 1_000) - 601;
  const update = await fetch(
    `http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:update?key=synthetic-api-key`,
    {
      method: 'POST',
      headers: {
        Authorization: 'Bearer owner',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        localId: user.userId,
        lastLoginAt: String(authenticatedAt * 1_000),
        validSince: String(authenticatedAt - 1),
      }),
    },
  );
  if (!update.ok) throw new Error(`Auth Emulator setup failed with ${update.status}`);

  const segments = user.idToken.split('.');
  const header = segments[0];
  const payload = segments[1];
  const signature = segments[2];
  if (header === undefined || payload === undefined || signature === undefined) {
    throw new Error('Auth Emulator token is malformed');
  }
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
  claims.auth_time = authenticatedAt;
  return `${header}.${Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url')}.${signature}`;
}

export function parseHost(value: string): { host: string; port: number } {
  const separator = value.lastIndexOf(':');
  if (separator < 1) throw new Error(`Invalid emulator host: ${value}`);
  const port = Number(value.slice(separator + 1));
  if (!Number.isInteger(port)) throw new Error(`Invalid emulator port: ${value}`);
  return { host: value.slice(0, separator), port };
}
