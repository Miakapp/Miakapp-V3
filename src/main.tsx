import { createRoot } from 'react-dom/client';

import { App } from './app/app';
import {
  createConfiguredComponentRelease,
  createConfiguredHost,
  readConfiguredDiagnosticsEndpoint,
  readConfiguredSandboxOrigin,
} from './app/configured-host';
import './styles.css';

const root = document.querySelector('#root');

if (!root) throw new Error('Missing #root application container');

createRoot(root).render(
  <App
    createComponentRelease={createConfiguredComponentRelease}
    createHost={createConfiguredHost}
    readDiagnosticsEndpoint={readConfiguredDiagnosticsEndpoint}
    readSandboxOrigin={readConfiguredSandboxOrigin}
  />,
);
