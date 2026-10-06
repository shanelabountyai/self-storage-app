import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { prisma } from '../packages/db'
import { mintToken } from '../apps/web/lib/auth/tokens'

// SEC-08. A sign-in link is spent by the button, not by the visit: a mail
// scanner that opens every link in a message must not burn it.
//
// Own disposable tenant (B-120 discipline 1), suffixed because the desktop and
// mobile projects run this file concurrently.

test('a sign-in link survives being opened twice and signs in on the press', async ({ page, request }) => {
  const email = `sec08-${randomUUID().slice(0, 8)}@example.com`
  const tenant = await prisma.tenant.create({ data: { email, firstName: 'Sec', lastName: 'Eight' } })

  try {
    const { token } = await mintToken({ purpose: 'magic_link', audience: 'tenant', subjectId: tenant.id, email })
    const link = `/login/magic?token=${token}`

    // The scanner: two plain GETs, no cookies kept.
    expect((await request.get(link)).status()).toBe(200)
    expect((await request.get(link)).status()).toBe(200)
    expect((await prisma.authToken.findFirstOrThrow({ where: { subjectId: tenant.id } })).usedAt).toBeNull()

    await page.goto(link)
    await page.getByRole('button', { name: 'Sign in to my account' }).click()
    await expect(page).toHaveURL(/\/portal/)

    // Single use still holds: the same link, pressed again, is refused.
    await page.context().clearCookies()
    await page.goto(link)
    await page.getByRole('button', { name: 'Sign in to my account' }).click()
    await expect(page.getByText('That sign-in link is no longer good.')).toBeVisible()
  } finally {
    await prisma.authToken.deleteMany({ where: { subjectId: tenant.id } })
    await prisma.tenant.delete({ where: { id: tenant.id } })
  }
})
