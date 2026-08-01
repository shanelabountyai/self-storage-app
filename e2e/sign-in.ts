import type { Page } from '@playwright/test'
import { DEMO_STAFF_EMAIL, DEMO_STAFF_PASSWORD } from '../apps/web/scripts/demo-credentials'

// B-094. Signs the browser context in as the demo owner so the admin surface
// can actually be scanned.
//
// Posted to the Auth.js credentials endpoint rather than filled into a form,
// because there is no sign-in form yet — /login is a placeholder until B-033.
// That is not a shortcut around the real thing: the request goes through the
// same `password` provider, the same authenticateWithPassword(), and the same
// throttle the real screen will use, and it comes back with a real session
// cookie. When B-033 ships a form, this helper is the one place to change.
export async function signInAsDemoOwner(page: Page): Promise<void> {
  // Auth.js requires the CSRF token and its paired cookie; fetching it through
  // the page's own request context is what puts the cookie in the jar.
  const csrfResponse = await page.request.get('/api/auth/csrf')
  const { csrfToken } = (await csrfResponse.json()) as { csrfToken: string }

  const response = await page.request.post('/api/auth/callback/password', {
    form: {
      email: DEMO_STAFF_EMAIL,
      password: DEMO_STAFF_PASSWORD,
      audience: 'staff',
      csrfToken,
      callbackUrl: '/admin',
    },
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
