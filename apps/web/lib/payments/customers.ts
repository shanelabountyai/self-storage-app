import { prisma } from '@storage/db'
import { idempotencyKey, requireStripe } from './stripe'

// PRD 01 §7.3: Stripe Customers. One per tenant, created lazily the first time
// we need to charge or save a card.

/// Returns the tenant's Stripe customer id, creating the customer if this is
/// the first time.
///
/// The idempotency key is the tenant id, so two concurrent first-charges cannot
/// produce two Stripe customers for the same person — Stripe returns the first
/// customer to the second caller rather than making another. The unique
/// constraint on `Tenant.stripeCustomerId` is the second line of defence.
export async function ensureStripeCustomer(tenantId: string): Promise<string> {
  const tenant = await prisma.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      phone: true,
      stripeCustomerId: true,
    },
  })
  if (tenant.stripeCustomerId) return tenant.stripeCustomerId

  const stripe = requireStripe()
  const customer = await stripe.customers.create(
    {
      email: tenant.email,
      name: `${tenant.firstName} ${tenant.lastName}`.trim(),
      phone: tenant.phone ?? undefined,
      // Our id travels with the Stripe record so a support conversation that
      // starts in the Stripe dashboard can be traced back here without a
      // reverse lookup.
      metadata: { tenantId: tenant.id },
    },
    { idempotencyKey: idempotencyKey('customer', tenant.id) },
  )

  await prisma.tenant.update({
    where: { id: tenant.id },
    data: { stripeCustomerId: customer.id },
  })
  return customer.id
}
