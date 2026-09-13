import { createRoot } from 'react-dom/client';

import { App } from './app/app';
import { createConfiguredHost } from './app/configured-host';
import './styles.css';

const root = document.querySelector('#root');

if (!root) throw new Error('Missing #root application container');

createRoot(root).render(
  <App createHost={createConfiguredHost} />,
);
