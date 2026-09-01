import { defineConfig, devices } from '@playwright/test';

// Keep the default URL aligned with the explicit 127.0.0.1 webServer bind.
// On Windows, localhost may resolve to ::1 while the spawned Vinext process
// listens only on IPv4, which makes Playwright wait until webServer timeout.
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3001';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 45_000,
  expect: { timeout: 8_000 },
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  // WebKit becomes timing-sensitive under the default host parallelism.
  // Keep local runs aligned with CI so `npm run e2e` is reproducible.
  workers: 2,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'output/playwright/report', open: 'never' }],
  ],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium-desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'chromium-mobile', use: { ...devices['iPhone 13'], browserName: 'chromium' } },
    { name: 'webkit-desktop', use: { ...devices['Desktop Safari'], browserName: 'webkit' } },
  ],
  webServer: process.env.PLAYWRIGHT_SKIP_WEBSERVER === '1'
    ? undefined
    : {
        command: 'npm run build && npm run start -- --host 127.0.0.1 --port 3001',
        url: baseURL,
        reuseExistingServer: false,
        timeout: 120_000,
        env: {
          ...process.env,
          FURIMA_LOCAL_FIXTURE_MODE: 'true',
          FURIMA_LOCAL_FIXTURE_REQUIRE_AUTH: 'true',
          FURIMA_D1_API_TOKEN: 'playwright-api-token',
          FURIMA_D1_API_ACTOR_ID: 'buyer_01',
          FURIMA_D1_CONTROL_TOKEN: 'playwright-control-token',
          FURIMA_STORAGE_MODE: 'memory',
        },
        stdout: 'pipe',
        stderr: 'pipe',
      },
});
