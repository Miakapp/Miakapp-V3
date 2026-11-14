import { createRoot } from 'react-dom/client';

import {
  createConfiguredComponentRelease,
  createConfiguredHost,
  createConfiguredPairingService,
  readConfiguredSandboxOrigin,
} from './app/configured-host';
import { markOpen } from './app/house-snapshot';
import { canonicalizeHomeAddress } from './app/home-url';
import { ProductApp } from './app/product-app';
import './styles.css';

// A Home Screen launch starts at the front door, not the page that was open
// when the app was added (iOS keeps that URL whatever the manifest says).
if (window.matchMedia('(display-mode: standalone)').matches
  && sessionStorage.getItem('miakapp.launched') === null) {
  sessionStorage.setItem('miakapp.launched', '1');
  const deepLink = /[?&](oobCode|from=push)/.test(window.location.search);
  if (window.location.pathname !== '/' && !deepLink) window.location.replace('/');
}

markOpen('boot');

// Legacy `/app?home=<id>` links keep working and show the new `/app/<id>` address.
canonicalizeHomeAddress(window.location, window.history);

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
