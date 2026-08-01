import { prisma } from '@storage/db'
import { requireStripe } from '@/lib/payments/stripe'
import { applyStripeEvent } from '@/lib/payments/reconcile'

// PRD 01 §7.3. The Stripe webhook endpoint.
//
// Three rules, in order of how badly getting them wrong ends:
//
// 1. VERIFY THE SIGNATURE FIRST, against the raw body. This endpoint is
//    unauthenticated and public; without verification anyone who knows the URL
//    can post "payment_intent.succeeded" and mark an invoice paid. `req.json()`
//    would reserialise the body and break the signature, so we read text().
// 2. Claim the event id before doing any work. Stripe delivers at-least-once
//    and retries for days, so the same event will arrive twice — the primary
//    key on StripeEvent is what turns the second delivery into a no-op.
// 3. Acknowledge what we cannot handle. A non-2xx makes Stripe retry, so
//    returning an error for an event type we never intended to process would
//    generate load forever.

export async function POST(request: Request): Promise<Response> {
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!secret) {
    // Fail closed. An unconfigured webhook secret means we cannot tell a real
    // Stripe delivery from anyone else's POST, and processing it anyway would
    // be worse than being down.
    return Response.json({ error: 'webhooks_not_configured' }, { status: 503 })
  }

  const signature = request.headers.get('stripe-signature')
  if (!signature) return Response.json({ error: 'missing_signature' }, { status: 400 })

  const body = await request.text()

  let event
  try {
    event = requireStripe().webhooks.constructEvent(body, signature, secret)
  } catch (error) {
    // Includes the timestamp-tolerance check, so this also rejects a replayed
    // capture of a genuine old delivery.
    const message = error instanceof Error ? error.message : 'invalid signature'
    return Response.json({ error: 'invalid_signature', message }, { status: 400 })
  }

  // Claim it. A duplicate delivery loses the race here and returns 200 without
  // touching the ledger, which is exactly what Stripe wants to hear.
  try {
    await prisma.stripeEvent.create({
      data: { id: event.id, type: event.type, payload: event as unknown as object },
    })
  } catch {
    return Response.json({ received: true, duplicate: true })
  }

  try {
    await applyStripeEvent(event)
    await prisma.stripeEvent.update({
      where: { id: event.id },
      data: { processedAt: new Date(), error: null },
    })
  } catch (error) {
    // Record why, then ask Stripe to try again. The row stays unprocessed and
    // shows up in the reconciliation gap until it succeeds or a human looks.
    await prisma.stripeEvent.update({
      where: { id: event.id },
      data: { error: error instanceof Error ? error.message : String(error) },
    })
    return Response.json({ error: 'processing_failed' }, { status: 500 })
  }

  return Response.json({ received: true })
}
