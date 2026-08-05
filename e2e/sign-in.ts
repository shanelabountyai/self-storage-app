import type { Page } from '@playwright/test'
import {
  DEMO_STAFF_EMAIL,
  DEMO_STAFF_PASSWORD,
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
async function signInWithPassword(
  page: Page,
  email: string,
  password: string,
  audience: 'staff' | 'tenant',
  callbackUrl: string,
): Promise<void> {
  // Auth.js requires the CSRF token and its paired cookie; fetching it through
  // the page's own request context is what puts the cookie in the jar.
  const csrfResponse = await page.request.get('/api/auth/csrf')
  const { csrfToken } = (await csrfResponse.json()) as { csrfToken: string }

  const response = await page.request.post('/api/auth/callback/password', {
    form: { email, password, audience, csrfToken, callbackUrl },
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

export async function signInAsDemoOwner(page: Page): Promise<void> {
  await signInWithPassword(page, DEMO_STAFF_EMAIL, DEMO_STAFF_PASSWORD, 'staff', '/admin')
}

export async function signInAsDemoTenant(page: Page): Promise<void> {
  await signInWithPassword(page, DEMO_TENANT_EMAIL, DEMO_TENANT_PASSWORD, 'tenant', '/portal')
}
