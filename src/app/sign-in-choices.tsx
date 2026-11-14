import { useState, type FormEvent } from 'react';

import type { Locale } from './copy';
import { configuredSignInKinds, type SignInMethod, type SignInOutcome } from './sign-in';

const COPY = {
  fr: {
    google: 'Continuer avec Google',
    github: 'Continuer avec GitHub',
    or: 'ou',
    emailLabel: 'Adresse e-mail',
    emailCta: 'Recevoir un lien de connexion',
    sent: 'Lien envoyé à {email}. Ouvrez-le sur cet appareil pour vous connecter.',
    failed: 'La connexion n’a pas abouti. Réessayez.',
  },
  en: {
    google: 'Continue with Google',
    github: 'Continue with GitHub',
    or: 'or',
    emailLabel: 'Email address',
    emailCta: 'Email me a sign-in link',
    sent: 'Link sent to {email}. Open it on this device to sign in.',
    failed: 'Sign-in did not complete. Try again.',
  },
} as const;

export interface SignInChoicesProps {
  readonly locale: Locale;
  readonly signIn: (method: SignInMethod) => Promise<SignInOutcome>;
  readonly disabled?: boolean;
}

/** Google, GitHub and email-link sign-in, as configured for this deployment. */
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
        <button className="house-button" disabled={off} onClick={() => run({ kind: 'google' })} type="button">
          {t.google}
        </button>
      ) : null}
      {kinds.includes('github') ? (
        <button className="house-button house-button--ghost" disabled={off} onClick={() => run({ kind: 'github' })} type="button">
          {t.github}
        </button>
      ) : null}
      {kinds.includes('email') ? (
        <>
          {kinds.length > 1 ? <p className="sign-in-choices__or">{t.or}</p> : null}
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
              <button className="house-button house-button--ghost" disabled={off} type="submit">{t.emailCta}</button>
            </form>
          ) : (
            <p role="status">{t.sent.replace('{email}', sentTo)}</p>
          )}
        </>
      ) : null}
      {failed ? <p role="alert">{t.failed}</p> : null}
    </div>
  );
}
