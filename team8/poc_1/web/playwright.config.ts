import { defineConfig, devices } from '@playwright/test';

/**
 * One browser, one viewport, no retries.
 *
 * 1512x900 is not a taste call — it is the projector the demo runs on, and the
 * two things this suite guards (the Context popover clearing the map, the week
 * chart's day axis and scrubber staying on screen) are both viewport-dependent.
 * A test at a different size would pass while the demo screen was broken.
 *
 * `reuseExistingServer` matters during a build day: agents leave `just poc-dev`
 * running, and a config that insisted on owning the port would fail on
 * --strictPort instead of testing the app that is already up.
 */
const PORT = 5199;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  timeout: 30_000,
  use: {
    // Spread FIRST: Desktop Chrome carries its own 1280x720 viewport, and
    // spreading it last silently threw away the projector size above.
    ...devices['Desktop Chrome'],
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1512, height: 900 },
    deviceScaleFactor: 2,
    // The landing explainer covers the app on first paint and suppresses the
    // tab keys by design. Every spec starts past it.
    storageState: { cookies: [], origins: [{ origin: `http://localhost:${PORT}`, localStorage: [{ name: 'pp:seen-landing', value: '1' }] }] },
    trace: 'off',
  },
  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
