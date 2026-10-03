import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

import type { CopyKey, Locale } from './copy';
import { LockIcon } from './icons';
import {
  HOME_ID_PATTERN,
  PairingError,
  suggestHomeId,
  type IssuedPairingCode,
  type PairingAccount,
  type PairingFailure,
  type PairingHome,
  type PairingHomeKey,
  type PairingService,
} from './pairing-client';
import './pair-page.css';

type Translate = (key: CopyKey) => string;

export interface PairPageProps {
  readonly service: PairingService | undefined;
  readonly locale: Locale;
  readonly t: Translate;
  readonly writeClipboard: (text: string) => Promise<void>;
  readonly now?: () => number;
}

type Step = 'home' | 'confirm' | 'code';

type Loadable<T> =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly value: T }
  | { readonly status: 'failed'; readonly failure: PairingFailure };

const FAILURE_COPY: Readonly<Record<PairingFailure, CopyKey>> = {
  signed_out: 'pairErrorSignedOut',
  stale_sign_in: 'pairErrorStale',
  not_admin: 'pairErrorNotAdmin',
  home_exists: 'pairErrorHomeExists',
  home_limit: 'pairErrorHomeLimit',
  rate_limited: 'pairErrorRateLimited',
  invalid_input: 'pairErrorInvalid',
  unavailable: 'pairErrorUnavailable',
};

function failureOf(error: unknown): PairingFailure {
  return error instanceof PairingError ? error.reason : 'unavailable';
}

function fill(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) => values[name] ?? match);
}

function remaining(milliseconds: number): string {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1_000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

const noSubscription = (): (() => void) => () => undefined;
const noAccount = (): undefined => undefined;

/**
 * One failure, said once, with the single thing the person can do about it.
 * A stale or ended session is the only failure a click fixes, so it is the only
 * one that gets a button: it re-opens the account chooser, then repeats what
 * the person was doing.
 */
function FailureNotice({
  failure,
  onReauthenticate,
  t,
}: {
  readonly failure: PairingFailure;
  readonly onReauthenticate: () => void;
  readonly t: Translate;
}): React.JSX.Element {
  const reauthenticate = failure === 'stale_sign_in' || failure === 'signed_out';
  return (
    <div className="pair-alert" role="alert">
      <p>{t(FAILURE_COPY[failure])}</p>
      {reauthenticate ? (
        <button className="product-button product-button--compact" onClick={onReauthenticate} type="button">
          {t('pairErrorStaleCta')}
        </button>
      ) : null}
    </div>
  );
}

function Steps({ current, t }: { readonly current: number; readonly t: Translate }): React.JSX.Element {
  const labels: CopyKey[] = ['pairStepAccount', 'pairStepHome', 'pairStepConfirm', 'pairStepCode'];
  return (
    <ol className="pair-steps">
      {labels.map((label, index) => (
        <li
          aria-current={index === current ? 'step' : undefined}
          className={index < current ? 'is-done' : index === current ? 'is-current' : undefined}
          key={label}
        >
          <span>{index + 1}</span> {t(label)}
        </li>
      ))}
    </ol>
  );
}

function KeyList({
  home,
  locale,
  onFailure,
  service,
  t,
}: {
  readonly home: PairingHome;
  readonly locale: Locale;
  readonly onFailure: (failure: PairingFailure, retry: () => void) => void;
  readonly service: PairingService;
  readonly t: Translate;
}): React.JSX.Element {
  const [keys, setKeys] = useState<Loadable<readonly PairingHomeKey[]> | null>(null);
  const [revoked, setRevoked] = useState(false);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);
  const format = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });

  function load(): void {
    setKeys({ status: 'loading' });
    service.listKeys(home.id).then(
      (value) => { if (active.current) setKeys({ status: 'ready', value }); },
      (error: unknown) => {
        if (!active.current) return;
        const failure = failureOf(error);
        setKeys({ status: 'failed', failure });
        onFailure(failure, load);
      },
    );
  }

  function revoke(keyId: string): void {
    service.revokeKey(home.id, keyId).then(
      () => {
        if (!active.current) return;
        setRevoked(true);
        load();
      },
      (error: unknown) => {
        if (active.current) onFailure(failureOf(error), () => revoke(keyId));
      },
    );
  }

  return (
    <details
      className="pair-keys"
      onToggle={(event) => {
        if (event.currentTarget.open && keys === null) load();
      }}
    >
      <summary>{t('pairKeysTitle')}</summary>
      {keys?.status === 'loading' ? <p className="pair-muted">{t('pairLoading')}</p> : null}
      {keys?.status === 'failed' ? (
        <button className="text-button" onClick={load} type="button">{t('pairRetry')}</button>
      ) : null}
      {revoked ? <p className="pair-muted" role="status">{t('pairKeysRevoked')}</p> : null}
      {keys?.status === 'ready' && keys.value.length === 0 ? (
        <p className="pair-muted">{t('pairKeysEmpty')}</p>
      ) : null}
      {keys?.status === 'ready' && keys.value.length > 0 ? (
        <ul>
          {keys.value.map((key) => (
            <li key={key.id}>
              <div>
                <strong>{key.label}</strong>
                <small>
                  {fill(t('pairKeysCreated'), { date: format.format(key.createdAtMs) })}
                  {' · '}
                  {key.lastUsedAtMs === null
                    ? t('pairKeysNeverUsed')
                    : fill(t('pairKeysLastUsed'), { date: format.format(key.lastUsedAtMs) })}
                </small>
              </div>
              <button
                aria-label={`${t('pairKeysRevoke')} ${key.label}`}
                className="pair-revoke"
                onClick={() => revoke(key.id)}
                type="button"
              >
                {t('pairKeysRevoke')}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </details>
  );
}

export function PairPage({
  service,
  locale,
  t,
  writeClipboard,
  now = Date.now,
}: PairPageProps): React.JSX.Element {
  const account = useSyncExternalStore(
    service?.subscribe ?? noSubscription,
    service?.getAccount ?? noAccount,
    service?.getAccount ?? noAccount,
  );

  if (service === undefined) {
    return (
      <main className="product-centered">
        <section className="auth-card">
          <span className="auth-card__icon"><LockIcon /></span>
          <p className="product-kicker">{t('pairKicker')}</p>
          <h1>{t('pairUnavailableTitle')}</h1>
          <p>{t('pairUnavailableBody')}</p>
        </section>
      </main>
    );
  }

  // A different account is a different set of homes and a different grant, so
  // the flow is keyed by it: nothing chosen under the previous one carries over.
  const accountKey = account === undefined ? 'restoring' : account === null ? 'none' : `account:${account.id}`;
  return (
    <PairFlow
      account={account}
      key={accountKey}
      locale={locale}
      now={now}
      service={service}
      t={t}
      writeClipboard={writeClipboard}
    />
  );
}

function PairFlow({
  account,
  locale,
  now,
  service,
  t,
  writeClipboard,
}: {
  readonly account: PairingAccount | null | undefined;
  readonly locale: Locale;
  readonly now: () => number;
  readonly service: PairingService;
  readonly t: Translate;
  readonly writeClipboard: (text: string) => Promise<void>;
}): React.JSX.Element {
  const signedIn = account !== undefined && account !== null;
  const [homes, setHomes] = useState<Loadable<readonly PairingHome[]>>({ status: 'loading' });
  const [homesAttempt, setHomesAttempt] = useState(0);
  const [selected, setSelected] = useState<PairingHome | null>(null);
  const [step, setStep] = useState<Step>('home');
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newId, setNewId] = useState('');
  const [idEdited, setIdEdited] = useState(false);
  const [newRelay, setNewRelay] = useState(service.defaultRelayUrl ?? '');
  const [confirmed, setConfirmed] = useState(false);
  const [issued, setIssued] = useState<IssuedPairingCode | null>(null);
  const [copied, setCopied] = useState<'message' | 'code' | null>(null);
  // The exact command, with the issuer this page was served for. The code is
  // never part of it: the CLI reads it from a hidden prompt or a pipe, so it
  // does not land in a shell history or a process list.
  const pairCommand = service?.issuer === undefined ? undefined : `miakapp pair --issuer ${service.issuer}`;
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<PairingFailure | null>(null);
  const [clock, setClock] = useState(now);
  const retry = useRef<(() => void) | null>(null);
  const active = useRef(true);
  const generation = useRef(0);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);

  function resetPending(): void {
    generation.current += 1;
    retry.current = null;
    setBusy(false);
    setFailure(null);
    setIssued(null);
    setCopied(null);
  }

  const fail = useCallback((next: PairingFailure, again: () => void): void => {
    retry.current = again;
    setFailure(next);
  }, []);

  useEffect(() => {
    if (!signedIn) return undefined;
    let current = true;
    service.listHomes().then(
      (value) => {
        if (!current) return;
        setHomes({ status: 'ready', value });
        if (value.length === 0) setCreating(true);
      },
      (error: unknown) => {
        if (!current) return;
        const reason = failureOf(error);
        setHomes({ status: 'failed', failure: reason });
        fail(reason, () => {
          setHomes({ status: 'loading' });
          setHomesAttempt((attempt) => attempt + 1);
        });
      },
    );
    return () => {
      current = false;
    };
  }, [fail, homesAttempt, service, signedIn]);

  useEffect(() => {
    if (issued === null) return undefined;
    const timer = window.setInterval(() => setClock(now()), 1_000);
    return () => window.clearInterval(timer);
  }, [issued, now]);

  const reloadHomes = (): void => {
    setHomes({ status: 'loading' });
    setHomesAttempt((attempt) => attempt + 1);
  };

  function run(action: (isCurrent: () => boolean) => Promise<void>): void {
    const attempt = ++generation.current;
    const accountId = account?.id;
    const isCurrent = (): boolean => active.current
      && generation.current === attempt
      && service.getAccount()?.id === accountId;
    setBusy(true);
    setFailure(null);
    retry.current = null;
    action(isCurrent).catch((error: unknown) => {
      if (isCurrent()) fail(failureOf(error), () => run(action));
    }).finally(() => {
      if (isCurrent()) setBusy(false);
    });
  }

  const reauthenticate = (): void => {
    const again = retry.current;
    const attempt = generation.current;
    const accountId = account?.id;
    setFailure(null);
    service.signIn().then(() => {
      // Reauthentication may select a different account. Its grant starts from
      // scratch; it must never replay the previous account's mutation.
      if (!active.current || generation.current !== attempt
        || service.getAccount()?.id !== accountId || retry.current !== again) return;
      retry.current = null;
      again?.();
    }, () => undefined);
  };

  const issue = (home: PairingHome): void => run(async (isCurrent) => {
    const code = await service.issueCode(home.id);
    if (!isCurrent()) return;
    if (code.homeId !== home.id) throw new PairingError('unavailable');
    setClock(now());
    setIssued(code);
    setCopied(null);
    setStep('code');
  });

  const createHome = (): void => run(async (isCurrent) => {
    const created = await service.createHome({ id: newId, name: newName, relayUrl: newRelay.trim() });
    if (!isCurrent()) return;
    setHomes((previous) => ({
      status: 'ready',
      value: [...(previous.status === 'ready' ? previous.value : []), created],
    }));
    setCreating(false);
    setSelected(created);
    setConfirmed(false);
    setStep('confirm');
  });

  const currentStep = !signedIn ? 0 : step === 'home' ? 1 : step === 'confirm' ? 2 : 3;
  const expired = issued !== null && clock >= issued.expiresAtMs;
  const canCreate = newName.trim() !== '' && HOME_ID_PATTERN.test(newId) && newRelay.trim() !== '';

  return (
    <main className="pair-page">
      <header className="onboarding-heading">
        <p className="product-kicker"><span /> {t('pairKicker')}</p>
        <h1>{t('pairTitle')}</h1>
        <p>{t('pairLede')}</p>
      </header>

      <section className="pair-card" aria-busy={busy || account === undefined}>
        <Steps current={currentStep} t={t} />

        {failure !== null ? <FailureNotice failure={failure} onReauthenticate={reauthenticate} t={t} /> : null}

        {account === undefined ? <p className="pair-muted">{t('pairLoading')}</p> : null}

        {account === null ? (
          <div className="pair-section">
            <h2>{t('pairAccountTitle')}</h2>
            <p className="pair-muted">{t('pairAccountBody')}</p>
            <button className="google-button" onClick={() => run(service.signIn)} type="button">
              <span aria-hidden="true">G</span> {t('pairAccountCta')}
            </button>
          </div>
        ) : null}

        {signedIn ? (
          <div className="pair-account">
            <span>{t('pairSignedInAs')} <strong>{account.email ?? account.name}</strong></span>
            <button
              className="text-button"
              onClick={() => run(async () => {
                await service.signOut();
                await service.signIn();
              })}
              type="button"
            >
              {t('pairSwitchAccount')}
            </button>
          </div>
        ) : null}

        {signedIn && step === 'home' ? (
          <div className="pair-section">
            <h2>{t('pairHomesTitle')}</h2>
            {homes.status === 'loading' ? <p className="pair-muted">{t('pairLoading')}</p> : null}
            {homes.status === 'failed' ? (
              <p className="pair-muted">
                {t('pairHomesError')}{' '}
                <button className="text-button" onClick={reloadHomes} type="button">{t('pairRetry')}</button>
              </p>
            ) : null}
            {homes.status === 'ready' && homes.value.length === 0 ? (
              <p className="pair-muted">{t('pairHomesEmpty')}</p>
            ) : null}
            {homes.status === 'ready' && homes.value.length > 0 ? (
              <ul className="pair-homes">
                {homes.value.map((home) => (
                  <li key={home.id}>
                    <button
                      onClick={() => {
                        resetPending();
                        setSelected(home);
                        setConfirmed(false);
                        setFailure(null);
                        setStep('confirm');
                      }}
                      type="button"
                    >
                      <strong>{home.name}</strong>
                      <small>{home.id}</small>
                      <span aria-hidden="true">→</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}

            {homes.status === 'ready' && !creating ? (
              <button className="text-button pair-create-toggle" onClick={() => setCreating(true)} type="button">
                + {t('pairCreateToggle')}
              </button>
            ) : null}

            {homes.status === 'ready' && creating ? (
              <form
                className="pair-create"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (canCreate && !busy) createHome();
                }}
              >
                <h3>{t('pairCreateToggle')}</h3>
                <label>
                  <span>{t('pairCreateName')}</span>
                  <input
                    autoComplete="off"
                    maxLength={128}
                    onChange={(event) => {
                      setNewName(event.target.value);
                      if (!idEdited) setNewId(suggestHomeId(event.target.value));
                    }}
                    required
                    value={newName}
                  />
                </label>
                <label>
                  <span>{t('pairCreateId')}</span>
                  <input
                    aria-describedby="pair-id-hint"
                    autoCapitalize="none"
                    autoComplete="off"
                    maxLength={63}
                    onChange={(event) => {
                      setIdEdited(true);
                      setNewId(event.target.value.toLowerCase());
                    }}
                    pattern="[a-z][a-z0-9\-]{1,61}[a-z0-9]"
                    required
                    spellCheck={false}
                    value={newId}
                  />
                </label>
                <small className="pair-hint" id="pair-id-hint">{t('pairCreateIdHint')}</small>
                {service.defaultRelayUrl === undefined ? (
                  <label>
                    <span>{t('pairCreateRelay')}</span>
                    <input onChange={(event) => setNewRelay(event.target.value)} required type="url" value={newRelay} />
                  </label>
                ) : (
                  <details className="pair-advanced">
                    <summary>{t('pairCreateAdvanced')}</summary>
                    <label>
                      <span>{t('pairCreateRelay')}</span>
                      <input onChange={(event) => setNewRelay(event.target.value)} required type="url" value={newRelay} />
                    </label>
                  </details>
                )}
                <button className="product-button" disabled={!canCreate || busy} type="submit">
                  {t('pairCreateSubmit')}
                </button>
              </form>
            ) : null}
          </div>
        ) : null}

        {signedIn && step === 'confirm' && selected !== null ? (
          <div className="pair-section">
            <h2>{fill(t('pairConfirmTitle'), { home: selected.name })}</h2>
            <p>{t('pairConfirmIntro')}</p>
            <ul className="pair-grants">
              <li>{t('pairGrantCoordinator')}</li>
              <li>{t('pairGrantCli')}</li>
              <li>{t('pairGrantPush')}</li>
              <li>{t('pairGrantComponents')}</li>
            </ul>
            <p><strong>{t('pairDenyTitle')}</strong> {t('pairDenyBody')}</p>
            <label className="pair-consent">
              <input checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} type="checkbox" />
              <span>{fill(t('pairConfirmCheck'), { home: selected.name })}</span>
            </label>
            <div className="pair-actions">
              <button className="product-button" disabled={!confirmed || busy} onClick={() => issue(selected)} type="button">
                {t('pairConfirmSubmit')}
              </button>
              <button className="text-button" onClick={() => { resetPending(); setStep('home'); }} type="button">{t('pairBack')}</button>
            </div>
            <KeyList key={selected.id} home={selected} locale={locale} onFailure={fail} service={service} t={t} />
          </div>
        ) : null}

        {signedIn && step === 'code' && selected !== null && issued !== null ? (
          <div className="pair-section">
            <h2>{t('pairCodeTitle')}</h2>
            <p>{t('pairCodeBody')}</p>
            {expired ? (
              <div className="pair-alert" role="alert">
                <p>{t('pairCodeExpired')}</p>
                <button className="product-button product-button--compact" onClick={() => issue(selected)} type="button">
                  {t('pairCodeAgain')}
                </button>
              </div>
            ) : (
              <>
                <output className="pair-code" aria-label={t('pairStepCode')}>{issued.code}</output>
                {pairCommand === undefined ? null : (
                  <div className="pair-command">
                    <span className="pair-muted">{t('pairCommandLabel')}</span>
                    <pre><code>{pairCommand}</code></pre>
                  </div>
                )}
                <div className="pair-actions">
                  {pairCommand === undefined ? null : (
                    <button
                      className="product-button"
                      onClick={() => {
                        const message = fill(t('pairAgentMessage'), {
                          home: selected.name,
                          command: pairCommand,
                          code: issued.code,
                        });
                        void writeClipboard(message).then(() => setCopied('message'), () => setCopied(null));
                      }}
                      type="button"
                    >
                      {copied === 'message' ? t('pairCodeCopied') : t('pairCopyMessage')}
                    </button>
                  )}
                  <button
                    className={pairCommand === undefined ? 'product-button' : 'product-button product-button--ghost'}
                    onClick={() => {
                      void writeClipboard(issued.code).then(() => setCopied('code'), () => setCopied(null));
                    }}
                    type="button"
                  >
                    {copied === 'code' ? t('pairCodeCopied') : pairCommand === undefined ? t('pairCodeCopy') : t('pairCopyCode')}
                  </button>
                  <span className="pair-muted" role="timer">
                    {fill(t('pairCodeExpiresIn'), { time: remaining(issued.expiresAtMs - clock) })}
                  </span>
                </div>
              </>
            )}
            <KeyList key={selected.id} home={selected} locale={locale} onFailure={fail} service={service} t={t} />
          </div>
        ) : null}
      </section>
    </main>
  );
}
