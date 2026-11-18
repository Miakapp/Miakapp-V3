import { createRoot } from 'react-dom/client';

import {
  createConfiguredComponentRelease,
  createConfiguredHost,
  createConfiguredPairingService,
  readConfiguredSandboxOrigin,
  rememberOpenedHome,
} from './app/configured-host';
import { markOpen } from './app/house-snapshot';
import { captureHomeLink } from './app/home-link';
import { requestedHomeId } from './app/home-url';
import { ProductApp } from './app/product-app';
import './styles.css';

// Before anything can rewrite the address: what a home's link carried
// (`?invite=…`, `#…`) is handed to that home's app once it opens.
captureHomeLink(window.location);

// A Home Screen launch starts at the front door, not the page that was open
// when the app was added (iOS keeps that URL whatever the manifest says).
if (window.matchMedia('(display-mode: standalone)').matches
  && sessionStorage.getItem('miakapp.launched') === null) {
  sessionStorage.setItem('miakapp.launched', '1');
  const deepLink = /[?&](oobCode|from=push)/.test(window.location.search);
  // Installed from a home's page: that home becomes the one `/` reopens. The
  // installed app may not share the browser's storage (iOS), so without this
  // its first launch lands on the default home instead.
  const launchedHome = requestedHomeId(window.location.pathname);
  if (launchedHome !== null && !deepLink) rememberOpenedHome(launchedHome);
  if (window.location.pathname !== '/' && !deepLink) window.location.replace('/');
}

markOpen('boot');

// Safari's own pinch gestures, which touch-action alone does not stop on iOS.
for (const gesture of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(gesture, (event) => event.preventDefault(), { passive: false });
}

// The worker keeps the shell openable without the internet (and carries push).
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  }, { once: true });
}

const root = document.querySelector('#root');

if (!root) throw new Error('Missing #root application container');

createRoot(root).render(
  <ProductApp
    createComponentRelease={createConfiguredComponentRelease}
    createHost={createConfiguredHost}
    createPairingService={createConfiguredPairingService}
    readSandboxOrigin={readConfiguredSandboxOrigin}
  />,
);
