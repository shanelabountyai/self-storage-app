import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { test as setup } from '@playwright/test'
import { OWNER_STATE, TENANT_STATE, establishOwnerSession, establishTenantSession } from './sign-in'

// B-079. Signs in ONCE per run and saves the session, instead of once per spec.
//
// Forced by staff MFA, and correct anyway. A TOTP code may be spent exactly
// once (RFC 6238 §5.2, enforced by `StaffUser.totpLastStep`), so twenty
// fully-parallel specs all signing in inside the same 30-second window would
// have nineteen of them correctly rejected as replays. Reusing one session is
// the standard Playwright answer and takes twenty argon2 verifications out of
// every run as a side benefit.
//
// This runs as a project dependency rather than in `globalSetup` because it
// needs a browser context and a started web server, and because a failure here
// should read as a failed setup test rather than a crash before the reporter
// exists.

setup('authenticate as the demo owner', async ({ page }) => {
  mkdirSync(dirname(OWNER_STATE), { recursive: true })
  await establishOwnerSession(page)
  await page.context().storageState({ path: OWNER_STATE })
})

setup('authenticate as the demo tenant', async ({ page }) => {
  mkdirSync(dirname(TENANT_STATE), { recursive: true })
  await establishTenantSession(page)
  await page.context().storageState({ path: TENANT_STATE })
})
