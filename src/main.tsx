import { createRoot } from 'react-dom/client';

import {
  createConfiguredComponentRelease,
  createConfiguredHost,
  readConfiguredDiagnosticsEndpoint,
  readConfiguredSandboxOrigin,
} from './app/configured-host';
import { ProductApp } from './app/product-app';
import './styles.css';

const root = document.querySelector('#root');

if (!root) throw new Error('Missing #root application container');

createRoot(root).render(
  <ProductApp
    createComponentRelease={createConfiguredComponentRelease}
    createHost={createConfiguredHost}
    readDiagnosticsEndpoint={readConfiguredDiagnosticsEndpoint}
    readSandboxOrigin={readConfiguredSandboxOrigin}
  />,
);
