import {
  GithubAuthProvider,
  GoogleAuthProvider,
  isSignInWithEmailLink,
  sendSignInLinkToEmail,
  signInWithEmailLink,
  signInWithPopup,
  type Auth,
} from 'firebase/auth';

/**
 * Every way a person can sign in. The control plane accepts any Firebase
 * account, so adding a method here is the whole job.
 */
export type SignInMethod =
  | { readonly kind: 'google' }
  | { readonly kind: 'github' }
  | { readonly kind: 'email'; readonly email: string };

export type SignInKind = SignInMethod['kind'];

/** `link_sent`: the sign-in finishes when the person opens the emailed link. */
export type SignInOutcome = 'signed_in' | 'link_sent';

const ALL_KINDS: readonly SignInKind[] = ['google', 'github', 'email'];
const EMAIL_KEY = 'miakapp.sign-in-email';

/** The methods this deployment offers, from `VITE_MIAKAPP_SIGN_IN` (default: all). */
export function configuredSignInKinds(value: string | undefined = import.meta.env.VITE_MIAKAPP_SIGN_IN): readonly SignInKind[] {
  if (typeof value !== 'string' || value.trim() === '') return ALL_KINDS;
  const wanted = new Set(value.split(',').map((kind) => kind.trim()));
  return ALL_KINDS.filter((kind) => wanted.has(kind));
}

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export async function signInWith(auth: Auth, method: SignInMethod): Promise<SignInOutcome> {
  if (method.kind === 'email') {
    const url = new URL(window.location.href);
    url.hash = '';
    await sendSignInLinkToEmail(auth, method.email, { url: url.href, handleCodeInApp: true });
    storage()?.setItem(EMAIL_KEY, method.email);
    return 'link_sent';
  }
  const provider = method.kind === 'google' ? new GoogleAuthProvider() : new GithubAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  await signInWithPopup(auth, provider);
  return 'signed_in';
}

/**
 * Finishes an email-link sign-in when the page was opened from the link. The
 * address comes from this browser when the link was requested here, otherwise
 * the person types it again (the link alone does not prove who opened it).
 */
export async function completeEmailLinkSignIn(auth: Auth): Promise<void> {
  const href = window.location.href;
  if (!isSignInWithEmailLink(auth, href)) return;
  const email = storage()?.getItem(EMAIL_KEY) ?? window.prompt('Email / E-mail')?.trim();
  if (!email) return;
  try {
    await signInWithEmailLink(auth, email, href);
    storage()?.removeItem(EMAIL_KEY);
  } finally {
    const url = new URL(href);
    for (const key of ['apiKey', 'oobCode', 'mode', 'lang', 'continueUrl', 'tenantId']) url.searchParams.delete(key);
    window.history.replaceState(window.history.state, '', url.href);
  }
}
