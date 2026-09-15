import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

import type { ActivatedRelease, ComponentReleaseCoordinator } from './component-release';
import {
  mountComponentRuntime,
  type ComponentRuntimeSession,
  type RuntimeFailure,
  type RuntimeLifecycle,
} from './component-runtime-host';
import { createDemoHost } from './demo-host';
import type { HomeActivity, HostView, SemanticInteraction, TrustedHost } from './host';
import {
  ActivityIcon,
  HomeIcon,
  LockIcon,
  SettingsIcon,
  SparkIcon,
} from './icons';
import {
  classifyRuntimeFailure,
  createRuntimeDiagnostics,
  type RuntimeDiagnostics,
} from './runtime-diagnostics';
import { SemanticRenderer } from './semantic-renderer';

type MountComponentRuntime = typeof mountComponentRuntime;

interface AppProps {
  readonly createHost?: () => TrustedHost;
  readonly createComponentRelease?: () => ComponentReleaseCoordinator | undefined;
  readonly readSandboxOrigin?: () => string | undefined;
  readonly readDiagnosticsEndpoint?: () => string | undefined;
  readonly mountRuntime?: MountComponentRuntime;
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
  | { readonly status: 'unavailable' };

const NO_COMPONENT_RELEASE: ComponentReleaseState = Object.freeze({ status: 'absent' });

/**
 * Activates the verified component release once per shell mount. The artifact
 * is fetched, size- and digest-checked and recorded in the release ledger here;
 * executing it is the component runtime host's job, not the shell's.
 */
function useComponentRelease(
  createComponentRelease: (() => ComponentReleaseCoordinator | undefined) | undefined,
): ComponentReleaseState {
  const [coordinator] = useState<ComponentReleaseCoordinator | undefined>(
    () => createComponentRelease?.(),
  );
  const [state, setState] = useState<ComponentReleaseState>(
    () => (coordinator === undefined ? NO_COMPONENT_RELEASE : { status: 'activating' }),
  );

  useEffect(() => {
    if (coordinator === undefined) return undefined;

    const controller = new AbortController();
    void coordinator.activate(controller.signal).then(
      (activated) => {
        if (controller.signal.aborted) return;
        setState({
          status: 'active',
          release: activated.pointer.release,
          fellBack: activated.fellBack,
          activated,
        });
      },
      () => {
        if (controller.signal.aborted) return;
        setState({ status: 'unavailable' });
      },
    );

    return () => controller.abort();
  }, [coordinator]);

  return state;
}

function componentReleaseLabel(state: ComponentReleaseState): string {
  if (state.status === 'activating') return 'Verifying component release';
  if (state.status === 'active') {
    return state.fellBack
      ? `Component ${state.release} · last known good`
      : `Component ${state.release} · verified`;
  }
  if (state.status === 'unavailable') return 'Component release unavailable';
  return 'Semantic host · ABI 1';
}

type ComponentRuntimeState =
  | { readonly status: 'idle' }
  | { readonly status: 'starting' }
  | { readonly status: 'active'; readonly tree: unknown; readonly revision: number }
  | { readonly status: 'failed'; readonly code: string };

type RuntimeOutcome =
  | { readonly kind: 'pending' }
  | { readonly kind: 'tree'; readonly tree: unknown; readonly revision: number }
  | { readonly kind: 'failed'; readonly code: string };

const PENDING_RUNTIME: RuntimeOutcome = Object.freeze({ kind: 'pending' });
const IDLE_RUNTIME: ComponentRuntimeState = Object.freeze({ status: 'idle' });
const STARTING_RUNTIME: ComponentRuntimeState = Object.freeze({ status: 'starting' });

interface ComponentRuntimeBinding {
  readonly state: ComponentRuntimeState;
  readonly interact: (interaction: SemanticInteraction) => void;
}

/**
 * Runs the verified artifact in the sandbox site once a release is active and
 * the deployment declares that site's origin. Both are required: without a
 * verified artifact there is nothing to run, and without a separate sandbox
 * origin `mountComponentRuntime` refuses to mount at all. A build that declares
 * neither behaves exactly as before.
 *
 * The frame is only the compute surface. It renders nothing the user sees: the
 * semantic tree comes back as data and is revalidated by `SemanticRenderer`
 * into trusted DOM, so the component never reaches the session's origin.
 */
function useComponentRuntime(
  activated: ActivatedRelease | undefined,
  readSandboxOrigin: (() => string | undefined) | undefined,
  diagnostics: RuntimeDiagnostics | undefined,
  mountRuntime: MountComponentRuntime,
  containerRef: React.RefObject<HTMLDivElement | null>,
): ComponentRuntimeBinding {
  const sessionRef = useRef<ComponentRuntimeSession | undefined>(undefined);
  const [sandboxOrigin] = useState<string | undefined>(() => readSandboxOrigin?.());
  const [outcome, setOutcome] = useState<RuntimeOutcome>(PENDING_RUNTIME);

  useEffect(() => {
    const container = containerRef.current;
    if (activated === undefined || sandboxOrigin === undefined || container === null) {
      return undefined;
    }

    let released = false;
    let session: ComponentRuntimeSession | undefined;

    // The fallback below keeps the shell usable, which is also what makes a
    // broken sandbox invisible. Report before falling back, and report the
    // classified code: `failure.code` may be the component's own text.
    const stopped = (code: string): void => {
      diagnostics?.report(code, activated.pointer.release);
      setOutcome({ kind: 'failed', code: classifyRuntimeFailure(code) });
    };

    const onLifecycle = (lifecycle: RuntimeLifecycle, failure?: RuntimeFailure): void => {
      if (released) return;
      if (lifecycle !== 'failed' && lifecycle !== 'terminated') return;
      stopped(failure?.code ?? lifecycle);
    };

    void mountRuntime(
      { pointer: activated.pointer, artifact: { bytes: activated.artifact.bytes } },
      {
        sandboxOrigin,
        container,
        onLifecycle,
        onTree: (tree, revision) => {
          if (released) return;
          setOutcome({ kind: 'tree', tree, revision });
        },
      },
    ).then(
      (mounted) => {
        // A mount that lands after the shell unmounted would otherwise leave an
        // orphan frame and its port alive with nothing left to dispose them.
        if (released) {
          mounted.dispose();
          return;
        }
        session = mounted;
        sessionRef.current = mounted;
      },
      () => {
        if (released) return;
        stopped('mount_failed');
      },
    );

    return () => {
      released = true;
      sessionRef.current = undefined;
      session?.dispose();
    };
  }, [activated, sandboxOrigin, diagnostics, mountRuntime, containerRef]);

  const interact = useCallback((interaction: SemanticInteraction): void => {
    sessionRef.current?.interact(interaction.handler, interaction.event, interaction.value);
  }, []);

  const mounting = activated !== undefined && sandboxOrigin !== undefined;
  const state: ComponentRuntimeState = !mounting
    ? IDLE_RUNTIME
    : outcome.kind === 'pending'
      ? STARTING_RUNTIME
      : outcome.kind === 'tree'
        ? { status: 'active', tree: outcome.tree, revision: outcome.revision }
        : { status: 'failed', code: outcome.code };

  return { state, interact };
}

function componentRuntimeLabel(state: ComponentRuntimeState): string | undefined {
  if (state.status === 'starting') return 'Component runtime starting';
  if (state.status === 'active') return `Component runtime · revision ${state.revision}`;
  if (state.status === 'failed') return `Component runtime stopped · ${state.code}`;
  return undefined;
}

const NAV_ITEMS: ReadonlyArray<{
  view: HostView;
  label: string;
  icon: typeof HomeIcon;
}> = [
  { view: 'home', label: 'Home', icon: HomeIcon },
  { view: 'activity', label: 'Activity', icon: ActivityIcon },
  { view: 'settings', label: 'Settings', icon: SettingsIcon },
];

function Brand(): React.JSX.Element {
  return (
    <div className="brand" aria-label="Miakapp">
      <span className="brand__mark"><SparkIcon /></span>
      <span>miakapp</span>
      <small>v4</small>
    </div>
  );
}

function ConnectionPill({ detail }: { readonly detail: string }): React.JSX.Element {
  return (
    <div className="connection-pill">
      <span />
      <strong>{detail}</strong>
    </div>
  );
}

function Navigation({
  view,
  onChange,
}: {
  readonly view: HostView;
  readonly onChange: (view: HostView) => void;
}): React.JSX.Element {
  return (
    <nav aria-label="Primary" className="primary-nav">
      {NAV_ITEMS.map((item) => {
        const Icon = item.icon;
        return (
          <button
            aria-current={view === item.view ? 'page' : undefined}
            className={view === item.view ? 'primary-nav__item is-active' : 'primary-nav__item'}
            key={item.view}
            onClick={() => onChange(item.view)}
            type="button"
          >
            <Icon />
            <span>{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

function ActivityItem({ item }: { readonly item: HomeActivity }): React.JSX.Element {
  const Icon = item.tone === 'agent'
    ? SparkIcon
    : item.tone === 'security'
      ? LockIcon
      : HomeIcon;

  return (
    <article className="activity-item">
      <span className={`activity-item__icon activity-item__icon--${item.tone}`}>
        <Icon />
      </span>
      <div>
        <strong>{item.title}</strong>
        <p>{item.detail}</p>
        <time>{item.time}</time>
      </div>
    </article>
  );
}

function ActivityList({
  activity,
  compact = false,
}: {
  readonly activity: readonly HomeActivity[];
  readonly compact?: boolean;
}): React.JSX.Element {
  const visibleActivity = compact ? activity.slice(0, 3) : activity;
  return (
    <div className={compact ? 'activity-list activity-list--compact' : 'activity-list'}>
      {visibleActivity.map((item) => <ActivityItem item={item} key={item.id} />)}
    </div>
  );
}

function ActivityView({
  activity,
}: {
  readonly activity: readonly HomeActivity[];
}): React.JSX.Element {
  return (
    <section className="static-view">
      <header className="static-view__heading">
        <p className="eyebrow">Clear by design</p>
        <h1>Home activity</h1>
        <p>Decisions, actions, and security-sensitive changes remain understandable.</p>
      </header>
      <div className="static-panel">
        <ActivityList activity={activity} />
      </div>
    </section>
  );
}

function SettingsView({ preview }: { readonly preview: boolean }): React.JSX.Element {
  return (
    <section className="static-view">
      <header className="static-view__heading">
        <p className="eyebrow">Trust is a setting</p>
        <h1>Connection & privacy</h1>
        <p>The V4 host will make infrastructure choices explicit instead of hiding them.</p>
      </header>
      <div className="settings-grid">
        <article className="static-panel settings-card">
          <span className="settings-card__icon"><HomeIcon /></span>
          <div>
            <h2>Home coordinator</h2>
            <p>{preview ? 'Preview adapter' : 'Bun coordinator'}</p>
            <small>
              {preview
                ? 'No cloud or home connection is active in this build.'
                : 'Live state and actions travel through MiakAPI without a Node-RED dependency.'}
            </small>
          </div>
        </article>
        <article className="static-panel settings-card">
          <span className="settings-card__icon"><SettingsIcon /></span>
          <div>
            <h2>Relay routing</h2>
            <p>Control-plane selection</p>
            <small>
              Official and self-hosted relays remain part of the protocol design.
              User-facing selection follows live relay acceptance.
            </small>
          </div>
        </article>
        <article className="static-panel settings-card settings-card--wide">
          <span className="settings-card__icon"><SparkIcon /></span>
          <div>
            <h2>Agent permissions</h2>
            <p>Capability-bound by the trusted host</p>
            <small>
              A home component cannot inject HTML, CSS, URLs, or credentials.
              This preview already renders through that closed semantic contract.
            </small>
          </div>
        </article>
      </div>
    </section>
  );
}

export function App({
  createHost = createDemoHost,
  createComponentRelease,
  readSandboxOrigin,
  readDiagnosticsEndpoint,
  mountRuntime = mountComponentRuntime,
}: AppProps): React.JSX.Element {
  const [host] = useState<TrustedHost>(() => createHost());
  const [view, setView] = useState<HostView>('home');
  const snapshot = useSyncExternalStore(host.subscribe, host.getSnapshot, host.getSnapshot);
  const componentRelease = useComponentRelease(createComponentRelease);
  const runtimeContainer = useRef<HTMLDivElement | null>(null);
  const [diagnostics] = useState<RuntimeDiagnostics | undefined>(() => {
    const endpoint = readDiagnosticsEndpoint?.();
    return endpoint === undefined ? undefined : createRuntimeDiagnostics({ endpoint });
  });
  const runtime = useComponentRuntime(
    componentRelease.status === 'active' ? componentRelease.activated : undefined,
    readSandboxOrigin,
    diagnostics,
    mountRuntime,
    runtimeContainer,
  );
  const runtimeState = runtime.state;
  const runtimeLabel = componentRuntimeLabel(runtimeState);

  useEffect(() => () => host.dispose(), [host]);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Brand />
        <div className="home-picker">
          <span className="home-picker__avatar" style={{ background: snapshot.activeHome.accent }}>
            {snapshot.activeHome.name.slice(0, 1)}
          </span>
          <span>
            <strong>{snapshot.activeHome.name}</strong>
            <small>{snapshot.activeHome.detail}</small>
          </span>
          <span className="home-picker__mode">{snapshot.modeLabel}</span>
        </div>
        <Navigation onChange={setView} view={view} />
        <div className="sidebar__footer">
          <ConnectionPill detail={snapshot.connectionDetail} />
          <p>Private by architecture.<br />Useful by intention.</p>
        </div>
      </aside>

      <main className="workspace">
        <header className="mobile-header">
          <Brand />
          <ConnectionPill detail={snapshot.connectionDetail} />
        </header>

        <div
          aria-label={snapshot.noticeTitle}
          className={snapshot.preview ? 'preview-notice' : 'preview-notice preview-notice--live'}
          role="status"
        >
          <span><SparkIcon /></span>
          <strong>{snapshot.noticeTitle}</strong>
          <small>{snapshot.noticeDetail}</small>
          {snapshot.signInAvailable ? (
            <button onClick={host.signIn} type="button">Sign in with Google</button>
          ) : null}
        </div>

        {view === 'home' ? (
          <div className="home-layout">
            {runtimeState.status === 'active' ? (
              <SemanticRenderer
                onInteraction={runtime.interact}
                tree={runtimeState.tree}
              />
            ) : (
              <SemanticRenderer onInteraction={host.interact} tree={snapshot.uiTree} />
            )}
            <aside className="activity-rail">
              <header>
                <div>
                  <p className="eyebrow">Now & next</p>
                  <h2>Activity</h2>
                </div>
                <button
                  aria-label="Open all activity"
                  onClick={() => setView('activity')}
                  type="button"
                >
                  View all
                </button>
              </header>
              <ActivityList activity={snapshot.activity} compact />
              <div className="agent-note">
                <span><SparkIcon /></span>
                <div>
                  <strong>Home agent</strong>
                  <p>“Everything looks settled. I’ll keep an eye on the rain.”</p>
                </div>
              </div>
            </aside>
          </div>
        ) : view === 'activity' ? (
          <ActivityView activity={snapshot.activity} />
        ) : (
          <SettingsView preview={snapshot.preview} />
        )}

        <footer className="workspace__footer">
          <span>{snapshot.lastSynced}</span>
          <span>{componentReleaseLabel(componentRelease)}</span>
          {runtimeLabel === undefined ? null : <span>{runtimeLabel}</span>}
        </footer>
      </main>

      {/*
        The sandbox frame computes; it never shows. Kept out of the flow rather
        than `display: none`, which browsers are free to treat as a reason not to
        load the document at all.
      */}
      <div
        aria-hidden="true"
        className="component-runtime-surface"
        data-testid="component-runtime-surface"
        ref={runtimeContainer}
      />

      <div className="mobile-nav"><Navigation onChange={setView} view={view} /></div>
    </div>
  );
}
