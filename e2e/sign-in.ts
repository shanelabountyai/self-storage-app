import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { SESSION_COOKIE } from '../apps/web/auth.config'
import { base32Decode, TOTP_STEP_SECONDS, totpCode } from '../packages/core/auth/totp'
import {
  DEMO_PLAN_TENANT_EMAIL,
  DEMO_STAFF_EMAIL,
  DEMO_STAFF_PASSWORD,
  DEMO_STAFF_TOTP_SECRET,
  DEMO_TENANT_EMAIL,
  DEMO_TENANT_PASSWORD,
} from '../apps/web/scripts/demo-credentials'

// B-094 (staff) / B-034 (tenant). Signs the browser context in so a protected
// surface can actually be scanned.
//
// Posted to the Auth.js credentials endpoint rather than filled into a form —
// the request goes through the same `password` provider, the same
// authenticateWithPassword(), and the same throttle a real form submission
// would, and it comes back with a real session cookie. Login/actions.ts's
// signInWithPasswordAction (B-033) is this same call from inside a Server
// Action; nothing here bypasses it.
//
// B-079 split this in two. The real sign-in now happens ONCE per run, in
// auth.setup.ts, and every spec replays the resulting cookies. A staff TOTP
// code may be spent exactly once, so twenty parallel specs each doing a real
// sign-in would have nineteen correctly rejected as replays.

// Resolved from the working directory, not from this module's own path. The
// root package.json declares no `"type": "module"`, so Playwright transpiles
// these specs to CommonJS and `import.meta` is a syntax error there — the whole
// suite failed to load at the `setup` project with "Cannot use 'import.meta'
// outside a module", which reads like a broken auth helper and is a module
// system. `testDir: './e2e'` already resolves the same way.
export const OWNER_STATE = join(process.cwd(), 'e2e', '.auth', 'owner.json')
export const TENANT_STATE = join(process.cwd(), 'e2e', '.auth', 'tenant.json')

async function signInWithPassword(
  page: Page,
  credentials: Record<string, string>,
  callbackUrl: string,
): Promise<void> {
  // Auth.js requires the CSRF token and its paired cookie; fetching it through
  // the page's own request context is what puts the cookie in the jar.
  const csrfResponse = await page.request.get('/api/auth/csrf')
  const { csrfToken } = (await csrfResponse.json()) as { csrfToken: string }

  const response = await page.request.post('/api/auth/callback/password', {
    form: { ...credentials, csrfToken, callbackUrl },
    maxRedirects: 0,
  })

  if (response.status() >= 400) {
    throw new Error(`Demo sign-in failed: ${response.status()} ${await response.text()}`)
  }

  // And then assert the OUTCOME, not a proxy for it. The previous check was
  // `>= 400` under a comment explaining that a 200 means the credentials were
  // rejected — so a rejection sailed through as success, `storageState` saved a
  // jar with no session in it, and every spec that replayed it landed on the
  // sign-in page. It cost this suite 87 failures across 30 admin, portal and
  // POS specs, none of which had anything wrong with them, all reported as
  // 30-second timeouts on unrelated locators. Auth.js answers both outcomes
  // with a 302 here, so the status line cannot tell them apart and the cookie
  // jar can.
  const cookies = await page.context().cookies()
  if (!cookies.some((cookie) => cookie.name === SESSION_COOKIE)) {
    throw new Error(
      `Demo sign-in for ${credentials.email} returned ${response.status()} but set no ${SESSION_COOKIE} cookie — the credentials were rejected.`,
    )
  }
}

/// The real staff sign-in, second factor and all. Called only from the setup
/// project. The code is generated from the published demo secret at this
/// instant, exactly as an authenticator app would.
export async function establishOwnerSession(page: Page): Promise<void> {
  const secret = base32Decode(DEMO_STAFF_TOTP_SECRET)
  const attempt = () =>
    signInWithPassword(
      page,
      {
        email: DEMO_STAFF_EMAIL,
        password: DEMO_STAFF_PASSWORD,
        audience: 'staff',
        code: totpCode(secret, Date.now()),
      },
      '/admin',
    )

  try {
    await attempt()
  } catch {
    // A TOTP code is single-use and every code inside one 30-second window is
    // the SAME code, so two runs started inside one window present a code the
    // first run already spent — and the second is correctly rejected. That is
    // the product working; it is the suite that has to cope, because running
    // the sweep twice in quick succession is the normal local rhythm.
    // Measured: four setup-only runs at 11:17:03, :23, :52 and 11:18:19 — only
    // the second failed, and it was the only one inside a predecessor's window.
    //
    // So wait out the window and present the next code. One retry, not a loop:
    // if a fresh code is also refused, the credentials or the account are
    // genuinely wrong and the run should stop saying so.
    const period = TOTP_STEP_SECONDS * 1_000
    await page.waitForTimeout(period - (Date.now() % period) + 1_000)
    await attempt()
  }
}

export async function establishTenantSession(page: Page): Promise<void> {
  await signInWithPassword(
    page,
    { email: DEMO_TENANT_EMAIL, password: DEMO_TENANT_PASSWORD, audience: 'tenant' },
    '/portal',
  )
}

async function replay(page: Page, statePath: string, who: string): Promise<void> {
  if (!existsSync(statePath)) {
    throw new Error(
      `No saved ${who} session at ${statePath}. The "setup" project should have created it — run the suite through playwright.config.ts rather than invoking a spec directly.`,
    )
  }
  const state = JSON.parse(readFileSync(statePath, 'utf8')) as {
    cookies: Parameters<ReturnType<Page['context']>['addCookies']>[0]
  }
  await page.context().addCookies(state.cookies)
}

export async function signInAsDemoOwner(page: Page): Promise<void> {
  await replay(page, OWNER_STATE, 'owner')
}

export async function signInAsDemoTenant(page: Page): Promise<void> {
  await replay(page, TENANT_STATE, 'tenant')
}

/// B-196. The tenant whose lease is on an agreed payment plan.
///
/// A live sign-in rather than a third replayed `storageState`, deliberately.
/// The owner session is established once and replayed because a TOTP code may
/// be spent exactly once; a tenant password carries no second factor, so the
/// only thing a setup project would buy here is a third stored jar for the two
/// screens this account exists to reach.
export async function signInAsPlanTenant(page: Page): Promise<void> {
  await signInWithPassword(
    page,
    { email: DEMO_PLAN_TENANT_EMAIL, password: DEMO_TENANT_PASSWORD, audience: 'tenant' },
    '/portal',
  )
}
