import { GoogleAuthProvider, onAuthStateChanged, signOut, type User, type Auth } from 'firebase/auth';
import { describe, expect, it, vi } from 'vitest';

import { FirebaseLiveIdentity, resolveRequestedHome, signInWithGoogle } from './configured-host';

vi.mock('firebase/auth', async (original) => ({ ...await original<typeof import('firebase/auth')>(), onAuthStateChanged: vi.fn(), signOut: vi.fn() }));

describe('configured staging host', () => {
  it('notifies a direct UID change even while both accounts are signed in', () => {
    let notify!: (user: User | null) => void;
    const remove = vi.fn();
    vi.mocked(onAuthStateChanged).mockImplementation((_auth, next) => { notify = next as typeof notify; return remove; });
    const auth = { currentUser: { uid: 'resident-a' } } as Auth;
    const identity = new FirebaseLiveIdentity(auth, {} as never);
    const listener = vi.fn();
    identity.subscribe(listener);
    notify({ uid: 'resident-a' } as User);
    expect(listener).not.toHaveBeenCalled();
    notify({ uid: 'resident-b' } as User);
    expect(listener).toHaveBeenCalledExactlyOnceWith(true);
    expect(identity.getUserId()).toBe('resident-b');
    notify(null);
    expect(identity.isSignedIn()).toBe(false);
    identity.dispose();
    expect(remove).toHaveBeenCalledOnce();
  });

  it('rejects a Firebase token arriving after an account transition', async () => {
    let notify!: (user: User | null) => void;
    vi.mocked(onAuthStateChanged).mockImplementation((_auth, next) => { notify = next as typeof notify; return vi.fn(); });
    let resolve!: (token: string) => void;
    const user = { uid: 'resident-a', getIdToken: () => new Promise<string>((done) => { resolve = done; }) } as User;
    const auth = { currentUser: user };
    const identity = new FirebaseLiveIdentity(auth as Auth, {} as never);
    const pending = identity.getFirebaseIdToken({ homeId: 'synthetic-home', reason: 'initial', signal: new AbortController().signal });
    auth.currentUser = { uid: 'resident-b' } as User;
    notify(auth.currentUser);
    resolve('synthetic-retired-token');
    await expect(pending).rejects.toThrow('identity changed');
    identity.dispose();
  });

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


it('signs out the shared Firebase identity and propagates errors', async () => {
  vi.mocked(onAuthStateChanged).mockReturnValue(vi.fn());
  const auth = { currentUser: { uid: 'synthetic-resident' } } as Auth;
  const identity = new FirebaseLiveIdentity(auth, {} as never);
  vi.mocked(signOut).mockResolvedValueOnce(undefined);
  await identity.signOut();
  expect(signOut).toHaveBeenCalledWith(auth);
  vi.mocked(signOut).mockRejectedValueOnce(new Error('synthetic failure'));
  await expect(identity.signOut()).rejects.toThrow('synthetic failure');
  identity.dispose();
});
