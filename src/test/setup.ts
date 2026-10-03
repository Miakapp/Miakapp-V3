import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  // Vitest globals are disabled, so Testing Library cannot register its own
  // afterEach. Unmount React trees before removing DOM nodes and timers.
  cleanup();
  document.body.replaceChildren();
});
