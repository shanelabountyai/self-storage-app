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
    // B-125. A real build, served — not the dev server.
    //
    // A dev server is not the artifact we deploy. It compiles lazily, skips
    // minification and bundle splitting, serves an error overlay in place of
    // our real error boundaries, and caches differently, so a suite that only
    // ever ran against it has never exercised what a renter gets. That is not
    // theoretical here: under a full parallel sweep Turbopack served the
    // checkout a stylesheet that did not yet carry `h-(--control-h,2.75rem)`,
    // so the zip field rendered at its content height of 21px and failed §6.2's
    // 44px assertion — intermittently, across three sweeps, reading exactly
    // like a broken tap target. 21px was the height rule being ABSENT.
    //
    // `E2E_DEV=1` keeps the dev server for debugging a single spec, where the
    // error overlay and source maps are genuinely worth more than fidelity.
    //
    // Either way it is the `:test` variant, NOT the bare script. The server
    // under test has to read the SAME database as the specs, and `npm run dev`
    // and `npm run build` load only .env.local — which points at the deployed
    // dev branch. Two databases is a split brain that produces failures nobody
    // can reproduce: a spec seeds a record the app cannot see.
    command: process.env.E2E_DEV ? 'npm run dev:test' : 'npm run e2e:server',
    url: baseURL,
    // Never adopt a server we did not start on the production path. Playwright
    // reuses whatever is already listening, so a dev server left running on
    // 3000 would be tested INSTEAD of the build, silently — the whole defect
    // class this item exists to close. Refusing to bind is a loud failure; a
    // silently wrong server is not.
    reuseExistingServer: !!process.env.E2E_DEV && !process.env.CI,
    // 120s was sized for a dev server, which is ready in under a second and
    // compiles on demand. A cold build takes longer than that on its own.
    timeout: 300_000,
  },
})
