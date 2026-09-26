import { defineConfig, devices } from '@playwright/test';

const TIMING = /-timing\.spec\.ts$/;

/**
 * The E2E suite runs against a **production build**, not the dev server.
 *
 * That is not fussiness. The offline tests reload the app with the network gone, which only works
 * if the service worker's app-shell precache is real — and in dev, Vite serves modules the worker
 * never cached, so the app cannot load offline no matter how correct the worker is. Testing the
 * dev server would prove the offline path works when it does not.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  reporter: 'list',
  // The offline specs deliberately wait out network failures; give them room.
  timeout: 60_000,
  use: {
    baseURL: process.env['FOXMAPPER_URL'] ?? 'http://localhost:4173',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      testIgnore: TIMING,
      use: {
        ...devices['Desktop Chrome'],
        // Headless Chromium leaves motion sensors at "ask"; Android Chrome, which this project
        // stands in for, ships them allowed — and the dial goes live without a tap only then.
        permissions: ['accelerometer', 'gyroscope', 'magnetometer'],
      },
    },
    { name: 'mobile-safari', testIgnore: TIMING, use: { ...devices['iPhone 14'] } },
    {
      // Wall-clock budgets (006 SC-002) run alone, after everything else: a timing taken while
      // other browsers share the cores measures the machine, not the app.
      name: 'timing',
      testMatch: TIMING,
      dependencies: ['chromium', 'mobile-safari'],
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: process.env['FOXMAPPER_URL']
    ? undefined
    : {
        command: 'npm run build && npm run preview',
        url: 'http://localhost:4173',
        reuseExistingServer: !process.env['CI'],
        timeout: 120_000,
      },
});
