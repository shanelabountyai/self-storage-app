import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { base32Decode, totpCode } from '../packages/core/auth/totp'
import {
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

export const OWNER_STATE = join(import.meta.dirname, '.auth', 'owner.json')
export const TENANT_STATE = join(import.meta.dirname, '.auth', 'tenant.json')

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

  // Auth.js answers a successful credentials callback with a redirect. A 200
  // here means it re-rendered the sign-in page, i.e. the credentials were
  // rejected — worth failing loudly on, because the alternative is a suite that
  // silently scans the /login page and reports it as clean.
  if (response.status() >= 400) {
    throw new Error(`Demo sign-in failed: ${response.status()} ${await response.text()}`)
  }
}

/// The real staff sign-in, second factor and all. Called only from the setup
/// project. The code is generated from the published demo secret at this
/// instant, exactly as an authenticator app would.
export async function establishOwnerSession(page: Page): Promise<void> {
  await signInWithPassword(
    page,
    {
      email: DEMO_STAFF_EMAIL,
      password: DEMO_STAFF_PASSWORD,
      audience: 'staff',
      code: totpCode(base32Decode(DEMO_STAFF_TOTP_SECRET), Date.now()),
    },
    '/admin',
  )
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
