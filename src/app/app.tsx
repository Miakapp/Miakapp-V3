import { useEffect, useState, useSyncExternalStore } from 'react';

import { createDemoHost } from './demo-host';
import type { HomeActivity, HostView, TrustedHost } from './host';
import {
  ActivityIcon,
  HomeIcon,
  LockIcon,
  SettingsIcon,
  SparkIcon,
} from './icons';
import { SemanticRenderer } from './semantic-renderer';

interface AppProps {
  readonly createHost?: () => TrustedHost;
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

function SettingsView(): React.JSX.Element {
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
            <p>Preview adapter</p>
            <small>No cloud or home connection is active in this build.</small>
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

export function App({ createHost = createDemoHost }: AppProps): React.JSX.Element {
  const [host] = useState<TrustedHost>(() => createHost());
  const [view, setView] = useState<HostView>('home');
  const snapshot = useSyncExternalStore(host.subscribe, host.getSnapshot, host.getSnapshot);

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
          <span className="home-picker__mode">Preview</span>
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

        <div className="preview-notice" role="status">
          <span><SparkIcon /></span>
          <strong>Interactive product preview</strong>
          <small>No cloud, relay, or home is connected.</small>
        </div>

        {view === 'home' ? (
          <div className="home-layout">
            <SemanticRenderer onInteraction={host.interact} tree={snapshot.uiTree} />
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
          <SettingsView />
        )}

        <footer className="workspace__footer">
          <span>{snapshot.lastSynced}</span>
          <span>Semantic host · ABI 1</span>
        </footer>
      </main>

      <div className="mobile-nav"><Navigation onChange={setView} view={view} /></div>
    </div>
  );
}
