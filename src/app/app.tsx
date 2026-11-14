import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';

import { APP_ABI } from '../../component-runtime/src/contract';
import {
  NoPublishedRelease,
  type ActivatedRelease,
  type ComponentReleaseCoordinator,
} from './component-release';
import { createPreviewHost } from './preview-host';
import {
  createHouseConsentStore,
  type HouseConsentRecord,
  type HouseConsentStore,
} from './house-consent';
import { createHouseFavoritesStore, type HouseFavoritesStore } from './house-favorites';
import { HouseShell, type HouseStage, type MountHouseApp } from './house-shell';
import type { TrustedHost } from './host';

export interface AppProps {
  /** A host owned by a parent product shell; App will not dispose it. */
  readonly host?: TrustedHost;
  readonly createHost?: () => TrustedHost;
  readonly createComponentRelease?: () => ComponentReleaseCoordinator | undefined;
  readonly readSandboxOrigin?: () => string | undefined;
  /** Where the resident's agreement to open each home's own interface is kept. */
  readonly consentStore?: HouseConsentStore;
  readonly favoritesStore?: HouseFavoritesStore;
  /** Opens another home. Defaults to a full navigation, which tears everything down. */
  readonly switchHome?: (homeId: string) => void;
  readonly mountHouseApp?: MountHouseApp;
}

function navigateToHome(homeId: string): void {
  window.location.assign(`/app?home=${encodeURIComponent(homeId)}`);
}

type ComponentReleaseState =
  | { readonly status: 'absent' }
  | { readonly status: 'activating' }
  | {
    readonly status: 'active';
    readonly release: string;
    readonly fellBack: boolean;
    readonly activated: ActivatedRelease;
  }
  | { readonly status: 'unavailable' }
  /** The home answered, and has published no interface of its own. */
  | { readonly status: 'none'; readonly homeName?: string };

const NO_COMPONENT_RELEASE: ComponentReleaseState = Object.freeze({ status: 'absent' });
const ACTIVATING_RELEASE: ComponentReleaseState = Object.freeze({ status: 'activating' });

/**
 * Activates the verified component release once per shell mount, and not before
 * `enabled`: for a home whose interface needs the resident's agreement, nothing
 * of that interface — pointer, artifact or frame — is requested until then.
 * The artifact is fetched, size- and digest-checked and recorded in the release
 * ledger here; executing it is the runtime host's job, not the shell's.
 */
function useComponentRelease(
  coordinator: ComponentReleaseCoordinator | undefined,
  enabled: boolean,
  attempt: number,
  authorizationEpoch: number,
): ComponentReleaseState {
  // Bind a result to one continuous authorization window. Withdrawal or
  // sign-out or account switch invalidates it immediately; reopening must activate again, even
  // if the retry counter and coordinator did not change.
  const request = useMemo(() => ({ coordinator, enabled, attempt, authorizationEpoch }), [coordinator, enabled, attempt, authorizationEpoch]);
  const [outcome, setOutcome] = useState<
    { readonly request: typeof request; readonly state: ComponentReleaseState } | undefined
  >(undefined);

  useEffect(() => {
    if (request.coordinator === undefined || !request.enabled) return undefined;

    const controller = new AbortController();
    void request.coordinator.activate(controller.signal).then(
      (activated) => {
        if (controller.signal.aborted) return;
        setOutcome({
          request,
          state: {
            status: 'active',
            release: activated.pointer.release,
            fellBack: activated.fellBack,
            activated,
          },
        });
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        setOutcome({
          request,
          state: error instanceof NoPublishedRelease
            ? { status: 'none', ...(error.homeName === undefined ? {} : { homeName: error.homeName }) }
            : { status: 'unavailable' },
        });
      },
    );

    return () => controller.abort();
  }, [request]);

  if (coordinator === undefined || !enabled) return NO_COMPONENT_RELEASE;
  if (outcome === undefined || outcome.request !== request) return ACTIVATING_RELEASE;
  return outcome.state;
}

/**
 * Which house-shell screen the home is on. Only a whole application
 * (`miakapp.app/1`) is drawn; any other published release counts as none.
 */
function selectHouseStage(
  consent: HouseConsentRecord | undefined,
  declined: boolean,
  needsSignIn: boolean,
  release: ComponentReleaseState,
): HouseStage {
  if (consent === undefined) return declined ? { kind: 'declined' } : { kind: 'consent' };
  if (needsSignIn) return { kind: 'signin' };
  if (release.status === 'activating' || release.status === 'absent') return { kind: 'loading' };
  if (release.status === 'unavailable') return { kind: 'unavailable' };
  if (release.status === 'none') return { kind: 'empty' };
  if (release.activated.pointer.abi === APP_ABI) return { kind: 'app', release: release.activated };
  return { kind: 'empty' };
}

export function App({
  host: providedHost,
  createHost = createPreviewHost,
  createComponentRelease,
  readSandboxOrigin,
  consentStore: providedConsentStore,
  favoritesStore: providedFavoritesStore,
  switchHome = navigateToHome,
  mountHouseApp,
}: AppProps): React.JSX.Element {
  const [host] = useState<TrustedHost>(() => providedHost ?? createHost());
  const snapshot = useSyncExternalStore(host.subscribe, host.getSnapshot, host.getSnapshot);
  // Creating the coordinator requests nothing; only `activate` does.
  const [coordinator] = useState<ComponentReleaseCoordinator | undefined>(
    () => createComponentRelease?.(),
  );
  const preferenceScope = snapshot.preview ? 'preview'
    : snapshot.authenticated ? host.getPreferencesScope?.() : undefined;
  const consentStore = useMemo<HouseConsentStore>(
    () => providedConsentStore ?? createHouseConsentStore(undefined, undefined, preferenceScope),
    [providedConsentStore, preferenceScope],
  );
  const favoritesStore = useMemo<HouseFavoritesStore>(
    () => providedFavoritesStore ?? createHouseFavoritesStore(undefined, preferenceScope),
    [providedFavoritesStore, preferenceScope],
  );
  const homeId = snapshot.activeHome.id;
  const readConsent = useCallback(() => consentStore.read(homeId), [consentStore, homeId]);
  const consent = useSyncExternalStore(consentStore.subscribe, readConsent, readConsent);
  const [declined, setDeclined] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const needsSignIn = snapshot.signInAvailable && !snapshot.authenticated;
  const componentRelease = useComponentRelease(
    coordinator,
    consent !== undefined && !needsSignIn,
    attempt,
    snapshot.authorizationEpoch ?? 0,
  );
  const [sandboxOrigin] = useState<string | undefined>(() => readSandboxOrigin?.());

  useEffect(() => {
    if (providedHost !== undefined) return undefined;
    return () => host.dispose();
  }, [host, providedHost]);

  // A build without a release coordinator (the offline preview) has no home
  // interface to open, so there is nothing to agree to either.
  const houseStage: HouseStage = coordinator === undefined
    ? { kind: 'empty' }
    : selectHouseStage(consent, declined, needsSignIn, componentRelease);
  const homeName = componentRelease.status === 'active'
    ? componentRelease.activated.homeName
    : componentRelease.status === 'none' ? componentRelease.homeName : undefined;
  return (
    <HouseShell
      call={host.call}
      connection={snapshot.connection}
      consent={consent}
      favorites={favoritesStore}
      home={homeName === undefined ? snapshot.activeHome : { ...snapshot.activeHome, name: homeName }}
      homeState={snapshot.homeState}
      homes={snapshot.homes}
      {...(mountHouseApp === undefined ? {} : { mountHouseApp })}
      onAcceptConsent={() => {
        setDeclined(false);
        consentStore.grant(homeId);
      }}
      onDeclineConsent={() => setDeclined(true)}
      onReopen={() => setDeclined(false)}
      onRetry={() => setAttempt((value) => value + 1)}
      onRevokeConsent={() => {
        consentStore.revoke(homeId);
      }}
      onSwitchHome={switchHome}
      sandboxOrigin={sandboxOrigin}
      reconnect={snapshot.authenticated ? host.reconnect : undefined}
      signIn={host.signIn}
      signInWith={host.signInWith}
      signInStatus={snapshot.signInStatus}
      signOut={snapshot.authenticated ? host.signOut : undefined}
      stage={houseStage}
    />
  );
}
