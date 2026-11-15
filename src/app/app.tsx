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
import { hasNoHomeYet, homeWasPickedForThePerson } from './home-pick';
import { HouseShell, type HouseStage, type MountHouseApp } from './house-shell';
import { createHouseSnapshotStore, markOpen, type HouseSnapshotStore } from './house-snapshot';
import type { HomeSummary, TrustedHost } from './host';
import type { PairingAccount, PairingService } from './pairing-client';
import { homePath } from './home-url';

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
  /** The signed-in account and the homes it owns; absent in a preview build. */
  readonly pairing?: PairingService;
}

const NO_ACCOUNT = (): PairingAccount | null | undefined => undefined;
const NO_SUBSCRIPTION = (): (() => void) => () => undefined;

/** The account behind this page and the homes it owns, for the Miakapp bar. */
function useAccount(pairing: PairingService | undefined): {
  readonly account: PairingAccount | null | undefined;
  readonly ownedHomes: readonly HomeSummary[] | undefined;
} {
  const account = useSyncExternalStore(
    pairing?.subscribe ?? NO_SUBSCRIPTION,
    pairing?.getAccount ?? NO_ACCOUNT,
    pairing?.getAccount ?? NO_ACCOUNT,
  );
  const accountId = account?.id;
  const [owned, setOwned] = useState<{ readonly accountId: string; readonly homes: readonly HomeSummary[] }>();
  useEffect(() => {
    if (pairing === undefined || accountId === undefined) return undefined;
    let current = true;
    void pairing.listHomes().then(
      (homes) => {
        if (!current) return;
        setOwned({
          accountId,
          homes: homes.map((home) => ({ id: home.id, name: home.name, detail: '', accent: '#b8d9ff' })),
        });
      },
      () => undefined,
    );
    return () => { current = false; };
  }, [pairing, accountId]);
  return { account, ownedHomes: owned?.accountId === accountId ? owned?.homes : undefined };
}

function navigateToHome(homeId: string): void {
  window.location.assign(homePath(homeId));
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
  | { readonly status: 'none'; readonly homeName?: string; readonly viewerIsOwner?: boolean };

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
  homeId: string,
  snapshots: HouseSnapshotStore | undefined,
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
    const active = (activated: ActivatedRelease): ComponentReleaseState => ({
      status: 'active',
      release: activated.pointer.release,
      fellBack: activated.fellBack,
      activated,
    });
    // Stale-while-revalidate: draw the last verified release from this
    // browser's cache at once, while the pointer is read in the background.
    let settled = false;
    const cachedHome = snapshots?.read(homeId);
    void request.coordinator.peek?.(controller.signal).then(
      (peeked) => {
        if (controller.signal.aborted || settled || peeked === undefined) return;
        markOpen('app-cached');
        setOutcome({
          request,
          state: active({
            ...peeked,
            ...(cachedHome?.homeName === undefined ? {} : { homeName: cachedHome.homeName }),
            ...(cachedHome?.viewerIsOwner === true ? { viewerIsOwner: true } : {}),
          }),
        });
      },
      () => undefined,
    );
    void request.coordinator.activate(controller.signal).then(
      (activated) => {
        if (controller.signal.aborted) return;
        settled = true;
        markOpen('pointer');
        snapshots?.write(homeId, {
          ...(activated.homeName === undefined ? {} : { homeName: activated.homeName }),
          viewerIsOwner: activated.viewerIsOwner === true,
        });
        setOutcome((previous) => {
          // Same release already drawn from the cache: keep that frame running.
          const shown = previous?.request === request && previous.state.status === 'active'
            ? previous.state.activated
            : undefined;
          if (shown !== undefined && shown.pointer.sha256 === activated.pointer.sha256
            && shown.homeName === activated.homeName
            && (shown.viewerIsOwner === true) === (activated.viewerIsOwner === true)) {
            return previous;
          }
          return { request, state: active(activated) };
        });
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        settled = true;
        if (error instanceof NoPublishedRelease) {
          snapshots?.write(homeId, {
            ...(error.homeName === undefined ? {} : { homeName: error.homeName }),
            viewerIsOwner: error.viewerIsOwner,
          });
        }
        setOutcome((previous) => {
          // Unreachable home or control plane: keep the cached release drawn.
          if (!(error instanceof NoPublishedRelease) && previous?.request === request
            && previous.state.status === 'active') {
            return previous;
          }
          return {
            request,
            state: error instanceof NoPublishedRelease
              ? {
                status: 'none',
                ...(error.homeName === undefined ? {} : { homeName: error.homeName }),
                ...(error.viewerIsOwner ? { viewerIsOwner: true } : {}),
              }
              : { status: 'unavailable' },
          };
        });
      },
    );

    return () => controller.abort();
  }, [request, homeId, snapshots]);

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
  // Signed in first: the home's answer says whether this person owns it, and an
  // owner never sees the first-visit agreement, on any device.
  if (needsSignIn) return { kind: 'signin' };
  if (release.status === 'activating' || release.status === 'absent') return { kind: 'loading' };
  const owner = (release.status === 'active' && release.activated.viewerIsOwner === true)
    || (release.status === 'none' && release.viewerIsOwner === true);
  if (consent === undefined && !owner) return declined ? { kind: 'declined' } : { kind: 'consent' };
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
  pairing,
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
  const snapshotStore = useMemo<HouseSnapshotStore | undefined>(
    () => preferenceScope === undefined || preferenceScope === 'preview'
      ? undefined
      : createHouseSnapshotStore(preferenceScope),
    [preferenceScope],
  );
  const readConsent = useCallback(() => consentStore.read(homeId), [consentStore, homeId]);
  const consent = useSyncExternalStore(consentStore.subscribe, readConsent, readConsent);
  const [declined, setDeclined] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const needsSignIn = snapshot.signInAvailable && !snapshot.authenticated;
  const componentRelease = useComponentRelease(
    coordinator,
    !needsSignIn,
    attempt,
    snapshot.authorizationEpoch ?? 0,
    homeId,
    snapshotStore,
  );
  const { account, ownedHomes } = useAccount(snapshot.authenticated ? pairing : undefined);
  const [sandboxOrigin] = useState<string | undefined>(() => readSandboxOrigin?.());

  // The status bar of an installed app takes the page's theme colour: match the
  // home (night blue in dark mode) instead of the landing's paper.
  useEffect(() => {
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (meta === null || typeof window.matchMedia !== 'function') return undefined;
    const previous = meta.content;
    const dark = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = (): void => { meta.content = dark.matches ? '#0a1024' : '#f3f0e8'; };
    apply();
    dark.addEventListener('change', apply);
    return () => {
      dark.removeEventListener('change', apply);
      meta.content = previous;
    };
  }, []);

  // The app picked this home (last opened, or the build default) and it does
  // not open: go to one of the person's own homes instead of a dead end.
  useEffect(() => {
    if (!homeWasPickedForThePerson() || ownedHomes === undefined || ownedHomes.length === 0) return;
    if (ownedHomes.some((home) => home.id === homeId)) return;
    // Not one of theirs: open it only if it does open (a home shared with them).
    if (componentRelease.status !== 'unavailable' && componentRelease.status !== 'none') return;
    switchHome((ownedHomes[0] as HomeSummary).id);
  }, [componentRelease.status, ownedHomes, homeId, switchHome]);

  useEffect(() => {
    if (providedHost !== undefined) return undefined;
    return () => host.dispose();
  }, [host, providedHost]);

  // A build without a release coordinator (the offline preview) has no home
  // interface to open, so there is nothing to agree to either.
  // Never opened a home and none asked for: a welcome, not the build default
  // (an owner signed in is taken to their own home by the effect above).
  const houseStage: HouseStage = coordinator === undefined
    ? { kind: 'empty' }
    : hasNoHomeYet() && !(ownedHomes?.length)
      ? { kind: 'welcome' }
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
      homes={ownedHomes === undefined ? snapshot.homes : [...snapshot.homes, ...ownedHomes]}
      account={account ?? undefined}
      isOwner={ownedHomes?.some((owned) => owned.id === homeId) ?? false}
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
      enablePush={snapshot.authenticated ? host.enablePush : undefined}
      signInStatus={snapshot.signInStatus}
      signOut={snapshot.authenticated ? host.signOut : undefined}
      stage={houseStage}
    />
  );
}
