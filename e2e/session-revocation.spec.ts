import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { prisma } from '../packages/db'
import { hashPassword } from '../apps/web/lib/auth/password'
import { mintToken } from '../apps/web/lib/auth/tokens'
import { signInAsTenant } from './sign-in'

// SEC-03. A tenant's 30-day JWT used to be believed for all thirty days: a
// password reset changed what would sign you in next and left every cookie
// already out there working. The unit suite proves the watermark arithmetic;
// this proves the part only a browser can — that the real cookie is refused.
//
// A throwaway tenant, created and torn down in the test (as the reset-link
// spec in i18n.spec.ts does): revoking a demo tenant's sessions would sign
// every other spec out mid-sweep.
test('a password reset ends the session that was already signed in', async ({ page, browser }) => {
  const email = `sec03-${randomUUID().slice(0, 8)}@example.com`
  const tenant = await prisma.tenant.create({
    data: {
      email,
      firstName: 'Session',
      lastName: 'Revoked',
      passwordHash: await hashPassword('the-old-password-1'),
    },
  })

  try {
    await signInAsTenant(page, email, 'the-old-password-1')
    await page.goto('/portal')
    await expect(page).toHaveURL(/\/portal/)

    // The reset happens somewhere else — another browser, with no cookie.
    const { token } = await mintToken({
      purpose: 'password_reset',
      audience: 'tenant',
      subjectId: tenant.id,
      email,
    })
    const elsewhere = await browser.newContext()
    const reset = await elsewhere.newPage()
    await reset.goto(`/reset-password?token=${token}`)
    await reset.getByLabel('New password', { exact: true }).fill('the-new-password-2')
    await reset.getByLabel('Confirm new password').fill('the-new-password-2')
    await reset.getByRole('button', { name: 'Set new password' }).click()
    await expect(reset.getByText('Password updated. You can sign in with it now.')).toBeVisible()
    await elsewhere.close()

    // Same cookie, next request.
    await page.goto('/portal')
    await expect(page).toHaveURL(/\/login/)

    // And the new password opens a session the watermark does not reach.
    await signInAsTenant(page, email, 'the-new-password-2')
    await page.goto('/portal')
    await expect(page).toHaveURL(/\/portal/)
  } finally {
    await prisma.authToken.deleteMany({ where: { subjectId: tenant.id } })
    await prisma.loginAttempt.deleteMany({ where: { email } })
    await prisma.tenant.delete({ where: { id: tenant.id } })
  }
})
