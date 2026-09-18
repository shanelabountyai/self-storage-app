import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { prisma } from '../packages/db'
import { mintCheckoutResumeToken } from '../apps/web/lib/checkout/resume-token'
import { mintUnsubscribeToken } from '../apps/web/lib/comms/unsubscribe-token'
import { SITE } from '../apps/web/lib/site-config'
import { assertNoAxeViolations } from './a11y-helpers'

// B-321. Every page reachable from a link inside a message renders in the
// language that message was written in — `<html lang>` included (SC 3.1.1),
// asserted the way `i18n.spec.ts` asserts the toggle — and no refusal on
// `/checkout/resume` is a dead end.
//
// Own disposable fixtures (B-120 discipline 1): a facility, a unit type, a
// Spanish-speaking tenant with a completed session, and a Spanish waitlist
// entry, all created and deleted here. A suffix per `beforeAll`, because the
// desktop and mobile projects run this file concurrently.

const suffix = randomUUID().slice(0, 8)
let facilityId = ''
let tenantId = ''
let resumeToken = ''
const cancelToken = `b321-${suffix}`

test.beforeAll(async () => {
  const facility = await prisma.facility.create({
    data: {
      name: `B-321 ${suffix}`,
      slug: `b321-${suffix}`,
      addressLine1: '1 Storage Way',
      city: 'Austin',
      state: 'TX',
      postalCode: '78704',
      timezone: 'America/Chicago',
    },
  })
  facilityId = facility.id
  const unitTypeId = (
    await prisma.unitType.create({ data: { facilityId, name: `5x5 ${suffix}`, widthFt: 5, lengthFt: 5 } })
  ).id
  tenantId = (
    await prisma.tenant.create({
      data: { email: `b321-${suffix}@example.com`, firstName: 'Ana', lastName: 'Inquilina', preferredLocale: 'es' },
    })
  ).id
  const session = await prisma.checkoutSession.create({
    data: {
      facilityId,
      unitTypeId,
      tenantId,
      status: 'completed',
      quotedRateCents: 4_900,
      tokenHash: `b321-${suffix}`,
      lockExpiresAt: new Date(Date.now() + 60_000),
    },
  })
  resumeToken = mintCheckoutResumeToken(session.id)
  await prisma.waitlistEntry.create({
    data: { facilityId, unitTypeId, email: `b321-wl-${suffix}@example.com`, preferredLocale: 'es', cancelToken },
  })
})

test.afterAll(async () => {
  await prisma.checkoutSession.deleteMany({ where: { facilityId } })
  await prisma.waitlistEntry.deleteMany({ where: { facilityId } })
  await prisma.unitType.deleteMany({ where: { facilityId } })
  await prisma.tenant.deleteMany({ where: { id: tenantId } })
  await prisma.facility.deleteMany({ where: { id: facilityId } })
})

test('the abandonment link speaks the tenant\'s language, cookie or not', async ({ page }) => {
  await page.goto(`/checkout/resume/${resumeToken}`)
  await expect(page.locator('html')).toHaveAttribute('lang', 'es')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Esta renta ya está completa')
  await expect(page).toHaveTitle(/Continuar su renta/)
  // Not a dead end: somewhere to go, and a number that dials.
  await expect(page.getByRole('main').getByRole('link', { name: 'Iniciar sesión en su cuenta' })).toHaveAttribute('href', '/portal')
  await expect(page.getByRole('main').getByRole('link', { name: SITE.phone.display })).toHaveAttribute('href', `tel:${SITE.phone.href}`)
  await assertNoAxeViolations(page, { message: 'axe found violations on the Spanish resume refusal' })
})

test('an unreadable resume link still offers a way on', async ({ page }) => {
  await page.goto('/checkout/resume/not.a-real-token')
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText("This link isn't valid")
  await expect(page.getByRole('main').getByRole('link', { name: 'Find a unit' })).toHaveAttribute('href', '/storage/search')
  await expect(page.getByRole('main').getByRole('link', { name: SITE.phone.display })).toHaveAttribute('href', `tel:${SITE.phone.href}`)
})

test('the waitlist cancel link speaks the language the entry was joined in', async ({ page }) => {
  await page.goto(`/waitlist/cancel/${cancelToken}`)
  await expect(page.locator('html')).toHaveAttribute('lang', 'es')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Lista de espera')
  await expect(page.getByText('Ya no está en la lista.')).toBeVisible()
})

test('the unsubscribe link speaks the language its email was written in', async ({ page }) => {
  const address = `b321-unsub-${suffix}@example.com`
  await page.goto(`/unsubscribe/${mintUnsubscribeToken(address, 'es')}`)
  await expect(page.locator('html')).toHaveAttribute('lang', 'es')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(`¿Cancelar la suscripción de ${address}?`)
  await expect(page.getByRole('button', { name: 'Cancelar mi suscripción' })).toBeVisible()
})
