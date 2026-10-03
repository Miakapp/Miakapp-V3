import { describe, expect, it, vi } from 'vitest';

import { createPairingApi, PairingError, suggestHomeId } from './pairing-client';

const ORIGIN = 'https://control.example.test';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function api(responses: Response[], token: string | null = 'id-token') {
  const fetch = vi.fn(async () => {
    const next = responses.shift();
    if (next === undefined) throw new Error('unexpected request');
    return next;
  });
  return { fetch, api: createPairingApi({ controlPlaneOrigin: `${ORIGIN}/`, getIdToken: async () => token, fetch }) };
}

async function failure(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(PairingError);
    return (error as PairingError).reason;
  }
  throw new Error('expected a failure');
}

describe('pairing control-plane client', () => {
  it('asks for the code with the exact confirmation for the chosen home', async () => {
    const { fetch, api: client } = api([json(201, {
      schema: 'miakapp.pairing-code/1',
      code: 'MIAK-01234-56789-ABCDE-FGHJK-MNPQR',
      home_id: 'maison-lea',
      access: 'full_home',
      scopes: ['relay:coordinator', 'relay:cli', 'push:send', 'components:publish'],
      expires_at: '2026-10-03T10:10:00.000Z',
      redeem_endpoint: `${ORIGIN}/v1/pairing/redeem`,
    })]);

    await expect(client.issueCode('maison-lea')).resolves.toEqual({
      code: 'MIAK-01234-56789-ABCDE-FGHJK-MNPQR',
      homeId: 'maison-lea',
      scopes: ['relay:coordinator', 'relay:cli', 'push:send', 'components:publish'],
      expiresAtMs: Date.parse('2026-10-03T10:10:00.000Z'),
    });
    expect(fetch).toHaveBeenCalledWith(`${ORIGIN}/v1/homes/maison-lea/pairing-codes`, expect.objectContaining({
      method: 'POST',
      cache: 'no-store',
      credentials: 'omit',
      headers: { Authorization: 'Bearer id-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ access: 'full_home', confirmation: 'grant-full-home-access:maison-lea' }),
    }));
  });

  it('lists homes and only active keys', async () => {
    const { api: client } = api([
      json(200, {
        schema: 'miakapp.home-list/1',
        homes: [{ home_id: 'maison-lea', name: 'Maison de Léa', icon: 'house', relay_url: 'wss://r/ws' }],
      }),
      json(200, {
        schema: 'miakapp.home-key-list/1',
        keys: [
          { key_id: 'a', label: 'Agent', scopes: [], created_at: '2026-10-01T00:00:00Z', revoked_at: null, last_used_at: null },
          { key_id: 'b', label: 'Old', scopes: [], created_at: '2026-09-01T00:00:00Z', revoked_at: '2026-09-02T00:00:00Z', last_used_at: null },
        ],
      }),
      new Response(null, { status: 204 }),
    ]);
    expect(await client.listHomes()).toEqual([{ id: 'maison-lea', name: 'Maison de Léa', icon: 'house' }]);
    expect((await client.listKeys('maison-lea')).map((key) => key.id)).toEqual(['a']);
    await expect(client.revokeKey('maison-lea', 'a')).resolves.toBeUndefined();
  });

  it('turns server errors into instructions, never raw messages', async () => {
    const error = (code: string, status: number) => json(status, { error: { code, message: 'x', retryable: false } });
    const { api: client } = api([
      error('recent_authentication_required', 401),
      error('not_home_owner', 403),
      error('home_exists', 409),
      error('rate_limited', 429),
      error('something_new', 418),
      new Response('<html>', { status: 502 }),
    ]);
    expect(await failure(client.issueCode('maison-lea'))).toBe('stale_sign_in');
    expect(await failure(client.issueCode('maison-lea'))).toBe('not_admin');
    expect(await failure(client.createHome({ id: 'maison-lea', name: 'Léa', relayUrl: 'wss://r/ws' }))).toBe('home_exists');
    expect(await failure(client.listHomes())).toBe('rate_limited');
    expect(await failure(client.listHomes())).toBe('unavailable');
    expect(await failure(client.listHomes())).toBe('unavailable');
  });

  it('refuses to call without a session or with an invalid new home', async () => {
    const signedOut = api([], null);
    expect(await failure(signedOut.api.listHomes())).toBe('signed_out');
    expect(signedOut.fetch).not.toHaveBeenCalled();
    const { fetch, api: client } = api([]);
    expect(await failure(client.createHome({ id: 'Bad ID', name: 'x', relayUrl: 'wss://r/ws' }))).toBe('invalid_input');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('suggests a valid permanent identifier from a typed name', () => {
    expect(suggestHomeId('Maison de Léa')).toBe('maison-de-lea');
    expect(suggestHomeId('  12 rue des Lilas !')).toBe('rue-des-lilas');
    expect(suggestHomeId('é')).toBe('');
    expect(suggestHomeId('x'.repeat(80))).toHaveLength(63);
  });
});
