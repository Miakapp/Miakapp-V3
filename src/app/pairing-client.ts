/**
 * The browser half of agent pairing: the owner's own browser lists the homes
 * they administer, optionally creates one, and asks the control plane for a
 * ten-minute single-use code that their agent redeems through the CLI.
 *
 * Nothing here ever holds a Home Key. The code is the only secret the page
 * sees, and it exists only to be shown once and copied.
 */

export interface PairingAccount {
  readonly email: string | null;
  readonly name: string | null;
}

export interface PairingHome {
  readonly id: string;
  readonly name: string;
  readonly icon: string;
}

export interface IssuedPairingCode {
  readonly code: string;
  readonly homeId: string;
  readonly scopes: readonly string[];
  readonly expiresAtMs: number;
}

export interface PairingHomeKey {
  readonly id: string;
  readonly label: string;
  readonly createdAtMs: number;
  readonly lastUsedAtMs: number | null;
}

export interface NewPairingHome {
  readonly id: string;
  readonly name: string;
  readonly relayUrl: string;
}

/**
 * Why a call failed, in the terms the page can act on. Each maps to one
 * instruction for the person, never to the server's raw message.
 */
export type PairingFailure =
  | 'signed_out'
  | 'stale_sign_in'
  | 'not_admin'
  | 'home_exists'
  | 'home_limit'
  | 'rate_limited'
  | 'invalid_input'
  | 'unavailable';

export class PairingError extends Error {
  readonly reason: PairingFailure;

  constructor(reason: PairingFailure) {
    super(`Pairing failed: ${reason}`);
    this.name = 'PairingError';
    this.reason = reason;
  }
}

export interface PairingService {
  /** Where a new home's relay lives unless the person says otherwise. */
  readonly defaultRelayUrl: string | undefined;
  /** `undefined` while the session is still being restored. */
  getAccount(): PairingAccount | null | undefined;
  subscribe(listener: () => void): () => void;
  /** Always offers the account chooser, so the person picks which account pairs. */
  signIn(): Promise<void>;
  signOut(): Promise<void>;
  listHomes(): Promise<readonly PairingHome[]>;
  createHome(input: NewPairingHome): Promise<PairingHome>;
  issueCode(homeId: string): Promise<IssuedPairingCode>;
  /** Active keys only: a revoked key is history, not access. */
  listKeys(homeId: string): Promise<readonly PairingHomeKey[]>;
  revokeKey(homeId: string, keyId: string): Promise<void>;
  dispose(): void;
}

export interface PairingApiOptions {
  /** The control plane origin; every pairing route hangs off it. */
  readonly controlPlaneOrigin: string;
  readonly getIdToken: () => Promise<string | null>;
  readonly fetch?: typeof fetch;
}

export type PairingApi = Pick<
  PairingService,
  'listHomes' | 'createHome' | 'issueCode' | 'listKeys' | 'revokeKey'
>;

export const HOME_ID_PATTERN = /^[a-z][a-z0-9-]{1,61}[a-z0-9]$/;

const FAILURES: Readonly<Record<string, PairingFailure>> = {
  invalid_firebase_token: 'signed_out',
  recent_authentication_required: 'stale_sign_in',
  not_home_owner: 'not_admin',
  home_not_found: 'not_admin',
  home_exists: 'home_exists',
  limit_exceeded: 'home_limit',
  rate_limited: 'rate_limited',
  invalid_request: 'invalid_input',
};

/**
 * Derives a valid home ID from a name a person typed: "Maison de Léa" becomes
 * `maison-de-lea`. The ID is permanent and public in the directory, so it is
 * shown before creation rather than invented silently.
 */
export function suggestHomeId(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^[^a-z]+/, '')
    .replace(/-+$/, '')
    .slice(0, 63)
    .replace(/-+$/, '');
  return HOME_ID_PATTERN.test(slug) ? slug : '';
}

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new PairingError('unavailable');
  }
  return value as Record<string, unknown>;
}

function text(value: unknown): string {
  if (typeof value !== 'string') throw new PairingError('unavailable');
  return value;
}

function home(value: unknown): PairingHome {
  const body = record(value);
  return Object.freeze({ id: text(body.home_id), name: text(body.name), icon: text(body.icon) });
}

export function createPairingApi(options: PairingApiOptions): PairingApi {
  const fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  const origin = options.controlPlaneOrigin.replace(/\/+$/, '');

  async function call(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<unknown> {
    const token = await options.getIdToken();
    if (token === null) throw new PairingError('signed_out');
    let response: Response;
    try {
      response = await fetchImpl(`${origin}${path}`, {
        method,
        cache: 'no-store',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      throw new PairingError('unavailable');
    }
    if (response.status === 204) return null;
    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch {
      throw new PairingError('unavailable');
    }
    if (!response.ok) {
      const code = (parsed as { error?: { code?: unknown } } | null)?.error?.code;
      throw new PairingError(typeof code === 'string' ? FAILURES[code] ?? 'unavailable' : 'unavailable');
    }
    return parsed;
  }

  return Object.freeze({
    async listHomes() {
      const body = record(await call('GET', '/v1/homes'));
      if (body.schema !== 'miakapp.home-list/1' || !Array.isArray(body.homes)) {
        throw new PairingError('unavailable');
      }
      return Object.freeze(body.homes.map(home));
    },

    async createHome(input: NewPairingHome) {
      if (!HOME_ID_PATTERN.test(input.id) || input.name.trim() === '') {
        throw new PairingError('invalid_input');
      }
      const body = record(await call('POST', '/v1/homes', {
        home_id: input.id,
        name: input.name.trim(),
        icon: 'house',
        relay_url: input.relayUrl,
      }));
      if (body.schema !== 'miakapp.home/1') throw new PairingError('unavailable');
      return home(body.home);
    },

    async issueCode(homeId: string) {
      const body = record(await call('POST', `/v1/homes/${encodeURIComponent(homeId)}/pairing-codes`, {
        access: 'full_home',
        confirmation: `grant-full-home-access:${homeId}`,
      }));
      const expiresAtMs = Date.parse(text(body.expires_at));
      if (body.schema !== 'miakapp.pairing-code/1'
        || body.home_id !== homeId
        || !Array.isArray(body.scopes)
        || !Number.isFinite(expiresAtMs)) {
        throw new PairingError('unavailable');
      }
      return Object.freeze({
        code: text(body.code),
        homeId,
        scopes: Object.freeze(body.scopes.map(text)),
        expiresAtMs,
      });
    },

    async listKeys(homeId: string) {
      const body = record(await call('GET', `/v1/homes/${encodeURIComponent(homeId)}/home-keys`));
      if (body.schema !== 'miakapp.home-key-list/1' || !Array.isArray(body.keys)) {
        throw new PairingError('unavailable');
      }
      return Object.freeze(body.keys
        .map(record)
        .filter((key) => key.revoked_at === null)
        .map((key) => Object.freeze({
          id: text(key.key_id),
          label: text(key.label),
          createdAtMs: Date.parse(text(key.created_at)),
          lastUsedAtMs: key.last_used_at === null ? null : Date.parse(text(key.last_used_at)),
        })));
    },

    async revokeKey(homeId: string, keyId: string) {
      await call(
        'DELETE',
        `/v1/homes/${encodeURIComponent(homeId)}/home-keys/${encodeURIComponent(keyId)}`,
      );
    },
  });
}
