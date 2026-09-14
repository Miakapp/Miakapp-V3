import { defineConfig } from '@playwright/test';
import { SPEC_GLOB } from './test/test-scope';

export default defineConfig({
  testDir: './test',
  // Discovered, not listed: naming one file meant a second spec would sit in
  // the corpus without ever running. See test/test-scope.ts.
  testMatch: SPEC_GLOB,
  timeout: 20_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'line',
  forbidOnly: Boolean(process.env.CI),
  use: {
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'bun run test/server.ts',
    url: 'http://127.0.0.1:4173/health',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'firefox', use: { browserName: 'firefox' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
});
