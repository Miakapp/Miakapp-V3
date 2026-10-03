import { GoogleAuthProvider, type Auth } from 'firebase/auth';
import { describe, expect, it, vi } from 'vitest';

import { resolveRequestedHome, signInWithGoogle } from './configured-host';

describe('configured staging host', () => {
  it('starts Google sign-in with a popup in the user click', async () => {
    const popupSignIn = vi.fn(async (auth: Auth, provider: GoogleAuthProvider) => {
      void auth;
      void provider;
    });

    await signInWithGoogle({} as Auth, popupSignIn);

    expect(popupSignIn).toHaveBeenCalledOnce();
    expect(popupSignIn.mock.calls[0]?.[1]).toBeInstanceOf(GoogleAuthProvider);
  });

  describe('home requested by the house shell switcher', () => {
    const fallback = { id: 'staging-home', name: 'Staging home', detail: 'Configured', accent: '#b8d9ff' };
    const favorites = [{ id: 'chalet-annecy', name: 'Chalet d’Annecy', accent: '#ff8d6b' }];

    it('opens a favorite under the name the resident pinned', () => {
      expect(resolveRequestedHome('/app', '?home=chalet-annecy', fallback, favorites)).toEqual({
        id: 'chalet-annecy', name: 'Chalet d’Annecy', detail: '', accent: '#ff8d6b',
      });
    });

    it('takes no name from the URL', () => {
      expect(resolveRequestedHome('/app', '?home=other-home&name=Bank', fallback, favorites).name).toBe('other-home');
    });

    it('keeps the configured home for anything that is not a home id on /app', () => {
      for (const [path, search] of [
        ['/app', ''],
        ['/app', '?home=../admin'],
        ['/app', '?home=Upper-Case'],
        ['/', '?home=chalet-annecy'],
      ] as const) {
        expect(resolveRequestedHome(path, search, fallback, favorites)).toBe(fallback);
      }
    });
  });
});
