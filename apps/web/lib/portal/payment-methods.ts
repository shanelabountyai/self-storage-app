import { prisma } from '@storage/db'
import { OCCUPYING_LEASE_STATUSES } from '@storage/core/inventory'
import { ensureStripeCustomer } from '@/lib/payments/customers'
import { stripeClient } from '@/lib/payments/stripe'

// PRD 01 §4.7 US-704. The cards a tenant has on file, and which units charge
// themselves against them.
//
// Two separate facts, deliberately stored in two places: WHICH card
// (`Tenant.stripeDefaultPaymentMethodId`, because Stripe's saved methods
// belong to the customer) and WHETHER a unit auto-charges
// (`Lease.autopayEnabled`, because billing runs per lease). Autopay needs
// both — either one missing and nothing is charged automatically, which is
// why `autopayBlocked` below is a state this screen reports rather than one
// it hides.

export type SavedMethod = {
  id: string
  brand: string
  last4: string
  expMonth: number
  expYear: number
  isDefault: boolean
}

/// The tenant's saved cards, newest first.
///
/// Returns `null` — not an empty list — when Stripe is unconfigured, so the
/// screen can tell "you have no cards" apart from "we can't reach the thing
/// that knows", which are different sentences to show a person.
export async function savedMethods(tenantId: string): Promise<SavedMethod[] | null> {
  const stripe = stripeClient()
  if (!stripe) return null

  const tenant = await prisma.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    select: { stripeCustomerId: true, stripeDefaultPaymentMethodId: true },
  })
  // No customer yet means no cards yet — and creating one just to list zero
  // of them would be a write on a read path.
  if (!tenant.stripeCustomerId) return []

  const methods = await stripe.paymentMethods.list({
    customer: tenant.stripeCustomerId,
    type: 'card',
  })

  return methods.data.map((method) => ({
    id: method.id,
    brand: method.card?.brand ?? 'card',
    last4: method.card?.last4 ?? '••••',
    expMonth: method.card?.exp_month ?? 0,
    expYear: method.card?.exp_year ?? 0,
    isDefault: method.id === tenant.stripeDefaultPaymentMethodId,
  }))
}

export type AutopayLease = {
  leaseId: string
  unitNumber: string
  facilityName: string
  autopayEnabled: boolean
  monthlyChargeCents: number
  billingDay: number
}

export async function autopayLeases(tenantId: string): Promise<AutopayLease[]> {
  const leases = await prisma.lease.findMany({
    where: { tenantId, status: { in: [...OCCUPYING_LEASE_STATUSES] } },
    orderBy: { startDate: 'asc' },
    select: {
      id: true,
      autopayEnabled: true,
      monthlyRateCents: true,
      protectionCents: true,
      billingDay: true,
      facility: { select: { name: true } },
      unit: { select: { number: true } },
    },
  })

  return leases.map((lease) => ({
    leaseId: lease.id,
    unitNumber: lease.unit.number,
    facilityName: lease.facility.name,
    autopayEnabled: lease.autopayEnabled,
    monthlyChargeCents: lease.monthlyRateCents + lease.protectionCents,
    billingDay: lease.billingDay,
  }))
}

export type MethodChange =
  | { ok: true }
  | { ok: false; reason: 'unavailable' | 'not_yours' | 'last_method_on_autopay' | 'no_method' }

/// Makes a saved card the one autopay charges.
///
/// Verified against Stripe's own list for this customer before it is stored:
/// the id comes from a form, and writing an arbitrary string into the field
/// autopay reads would point every future charge at nothing.
export async function setDefaultMethod(tenantId: string, methodId: string): Promise<MethodChange> {
  const stripe = stripeClient()
  if (!stripe) return { ok: false, reason: 'unavailable' }

  const customerId = await ensureStripeCustomer(tenantId)
  const methods = await stripe.paymentMethods.list({ customer: customerId, type: 'card' })
  if (!methods.data.some((method) => method.id === methodId)) {
    return { ok: false, reason: 'not_yours' }
  }

  // Both sides: our own field is what B-045's autopay run reads, and Stripe's
  // invoice_settings is what anything raised Stripe-side would use. Leaving
  // them to disagree is how a card gets "removed" in one place only.
  await stripe.customers.update(customerId, {
    invoice_settings: { default_payment_method: methodId },
  })
  await prisma.tenant.update({
    where: { id: tenantId },
    data: { stripeDefaultPaymentMethodId: methodId },
  })
  return { ok: true }
}

/// Detaches a saved card.
///
/// Refuses to remove the last card while any unit is set to charge itself.
/// Autopay with no method is a promise that silently fails on the next
/// billing day and surfaces as a delinquency the tenant did not earn — so the
/// choice is made explicit: turn autopay off first, or add another card.
export async function removeMethod(tenantId: string, methodId: string): Promise<MethodChange> {
  const stripe = stripeClient()
  if (!stripe) return { ok: false, reason: 'unavailable' }

  const customerId = await ensureStripeCustomer(tenantId)
  const methods = await stripe.paymentMethods.list({ customer: customerId, type: 'card' })
  if (!methods.data.some((method) => method.id === methodId)) {
    return { ok: false, reason: 'not_yours' }
  }

  if (methods.data.length === 1) {
    const onAutopay = await prisma.lease.count({
      where: { tenantId, autopayEnabled: true, status: { in: [...OCCUPYING_LEASE_STATUSES] } },
    })
    if (onAutopay > 0) return { ok: false, reason: 'last_method_on_autopay' }
  }

  await stripe.paymentMethods.detach(methodId)

  // If that was the default, promote another rather than leaving the field
  // pointing at a detached card.
  const tenant = await prisma.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    select: { stripeDefaultPaymentMethodId: true },
  })
  if (tenant.stripeDefaultPaymentMethodId === methodId) {
    const remaining = methods.data.find((method) => method.id !== methodId)
    await prisma.tenant.update({
      where: { id: tenantId },
      data: { stripeDefaultPaymentMethodId: remaining?.id ?? null },
    })
    if (remaining) {
      await stripe.customers.update(customerId, {
        invoice_settings: { default_payment_method: remaining.id },
      })
    }
  }
  return { ok: true }
}

/// Turns a unit's automatic payments on or off.
///
/// Scoped to `tenantId` so a lease id in a form cannot toggle someone else's
/// unit. Enabling with no card on file is refused rather than stored: it
/// would read as "on" on the dashboard and charge nothing on the billing day.
export async function setLeaseAutopay(
  tenantId: string,
  leaseId: string,
  enabled: boolean,
): Promise<MethodChange> {
  const lease = await prisma.lease.findFirst({
    where: { id: leaseId, tenantId, status: { in: [...OCCUPYING_LEASE_STATUSES] } },
    select: { id: true },
  })
  if (!lease) return { ok: false, reason: 'not_yours' }

  if (enabled) {
    const tenant = await prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { stripeDefaultPaymentMethodId: true },
    })
    if (!tenant.stripeDefaultPaymentMethodId) return { ok: false, reason: 'no_method' }
  }

  await prisma.lease.update({ where: { id: lease.id }, data: { autopayEnabled: enabled } })
  return { ok: true }
}
