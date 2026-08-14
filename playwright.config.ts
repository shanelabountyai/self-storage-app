import { defineConfig, devices } from '@playwright/test'

const baseURL = 'http://localhost:3000'

export default defineConfig({
  testDir: './e2e',
  // Releases the units the checkout tests lock, at both ends of the run. The
  // setup is the one that is guaranteed to happen — see e2e/global-setup.ts.
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL, trace: 'on-first-retry' },
  // Mobile-first is a cross-cutting requirement (master PRD §7.3), so the
  // default project is a phone viewport, not a desktop one.
  projects: [
    // B-079. One real sign-in per run, saved for every spec to replay. Staff
    // MFA makes this mandatory rather than merely tidy: a TOTP code is
    // single-use, so parallel specs each doing their own sign-in would be
    // correctly rejected as replays.
    { name: 'setup', testMatch: /.*\.setup\.ts/ },
    { name: 'mobile-chrome', use: { ...devices['Pixel 7'] }, dependencies: ['setup'] },
    { name: 'desktop-chrome', use: { ...devices['Desktop Chrome'] }, dependencies: ['setup'] },
  ],
  webServer: {
    // `dev:test`, NOT `dev`. The server under test has to read the SAME
    // database as the specs do, and `npm run dev` loads only .env.local -
    // which points at the deployed dev branch. Two databases is a split brain
    // that produces failures nobody can reproduce: a spec seeds a record the
    // app cannot see.
    command: 'npm run dev:test',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
