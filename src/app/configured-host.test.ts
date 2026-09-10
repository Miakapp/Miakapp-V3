import { GoogleAuthProvider, type Auth } from 'firebase/auth';
import { describe, expect, it, vi } from 'vitest';

import { signInWithGoogle } from './configured-host';

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
});
