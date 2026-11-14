import { useState, type FormEvent } from 'react';

import type { Locale } from './copy';
import { configuredSignInKinds, type SignInMethod, type SignInOutcome } from './sign-in';

const COPY = {
  fr: {
    google: 'Continuer avec Google',
    or: 'ou',
    emailLabel: 'Adresse e-mail',
    emailCta: 'Recevoir un lien de connexion',
    sent: 'Lien envoyé à {email}. Ouvrez-le sur cet appareil pour vous connecter.',
    failed: 'La connexion n’a pas abouti. Réessayez.',
  },
  en: {
    google: 'Continue with Google',
    or: 'or',
    emailLabel: 'Email address',
    emailCta: 'Email me a sign-in link',
    sent: 'Link sent to {email}. Open it on this device to sign in.',
    failed: 'Sign-in did not complete. Try again.',
  },
} as const;

function GoogleMark() {
  return (
    <svg aria-hidden="true" height="18" viewBox="0 0 48 48" width="18">
      <path d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" fill="#FFC107" />
      <path d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" fill="#FF3D00" />
      <path d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" fill="#4CAF50" />
      <path d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" fill="#1976D2" />
    </svg>
  );
}

export interface SignInChoicesProps {
  readonly locale: Locale;
  readonly signIn: (method: SignInMethod) => Promise<SignInOutcome>;
  readonly disabled?: boolean;
}

/** Google and email-link sign-in, as configured for this deployment. */
export function SignInChoices({ locale, signIn, disabled = false }: SignInChoicesProps) {
  const t = COPY[locale];
  const kinds = configuredSignInKinds();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const run = (method: SignInMethod): void => {
    setBusy(true);
    setFailed(false);
    signIn(method).then((outcome) => {
      if (outcome === 'link_sent' && method.kind === 'email') setSentTo(method.email);
    }, () => setFailed(true)).finally(() => setBusy(false));
  };

  const submitEmail = (event: FormEvent): void => {
    event.preventDefault();
    const address = email.trim();
    if (address !== '') run({ kind: 'email', email: address });
  };

  const off = disabled || busy;
  return (
    <div className="sign-in-choices">
      {kinds.includes('google') ? (
        <button className="sign-in-choices__google" disabled={off} onClick={() => run({ kind: 'google' })} type="button">
          <GoogleMark />
          {t.google}
        </button>
      ) : null}
      {kinds.includes('email') ? (
        <>
          {kinds.length > 1 ? <p className="sign-in-choices__or"><span>{t.or}</span></p> : null}
          {sentTo === null ? (
            <form className="sign-in-choices__email" onSubmit={submitEmail}>
              <input
                aria-label={t.emailLabel}
                autoComplete="email"
                disabled={off}
                onChange={(event) => setEmail(event.target.value)}
                placeholder={t.emailLabel}
                required
                type="email"
                value={email}
              />
              <button aria-label={t.emailCta} disabled={off} title={t.emailCta} type="submit">
                <span aria-hidden="true">→</span>
              </button>
            </form>
          ) : (
            <p className="sign-in-choices__sent" role="status">{t.sent.replace('{email}', sentTo)}</p>
          )}
        </>
      ) : null}
      {failed ? <p role="alert">{t.failed}</p> : null}
    </div>
  );
}
