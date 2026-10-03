// A house application written with a real UI library, bundled as one IIFE the
// way an agent would publish it. Proves the frame runs framework code — React
// rendering, hooks, CSS-in-JS style injection — under the house-app policy.
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

interface HomeView {
  values: Readonly<Record<string, unknown>>;
  stale: boolean;
}

declare global {
  interface Window {
    miakapp: {
      state: {
        values(): Readonly<Record<string, unknown>>;
        readonly stale: boolean;
        subscribe(listener: (state: HomeView) => void): () => void;
      };
      call(name: string, args?: unknown): Promise<unknown>;
      home: { name: string };
    };
  }
}

const home = window.miakapp;
const style = document.createElement('style');
style.textContent = '.lamp{display:grid;place-items:center;width:180px;height:180px;border-radius:50%;'
  + 'border:0;font:600 18px system-ui;transition:background .3s}.lamp[data-on="true"]{background:#ffd34d}'
  + '.lamp[data-on="false"]{background:#2b2f36;color:#fff}';
document.head.append(style);

function App(): React.JSX.Element {
  const [view, setView] = useState<HomeView>({ values: home.state.values(), stale: home.state.stale });
  const [busy, setBusy] = useState(false);
  useEffect(() => home.state.subscribe((next) => setView(next)), []);
  const on = view.values['zone.living.light.on'] === true;
  return (
    <main>
      <h1 id="react-title">{home.home.name}</h1>
      <button
        className="lamp"
        data-on={String(on)}
        disabled={busy || view.stale}
        id="lamp"
        onClick={() => {
          setBusy(true);
          void home.call('lighting.set', { on: !on }).finally(() => setBusy(false));
        }}
        type="button"
      >
        {on ? 'Lumière allumée' : 'Lumière éteinte'}
      </button>
    </main>
  );
}

const root = document.createElement('div');
document.body.append(root);
createRoot(root).render(<App />);
