import Stripe from 'stripe'

// PRD 01 §7.3 / master PRD §7.4. The Stripe client, and the one place that
// decides whether we are talking to Stripe at all.
//
// D-6 settled the shape: our ledger is the source of truth and it creates
// PaymentIntents. No Stripe Billing subscriptions, no Stripe-side schedules —
// if the ledger and Stripe ever disagree about what is owed, the ledger wins
// and Stripe is reconciled to it.
//
// PCI scope is SAQ-A and stays there: card details go from the renter's browser
// to Stripe directly via the Payment Element, and nothing in this repo ever
// receives a PAN. Everything below deals in tokens and ids.

/// Pinned deliberately. Stripe evolves its API and an unpinned client silently
/// changes behaviour under you on their schedule rather than yours; the upgrade
/// is then a deliberate change with its own test run.
const API_VERSION = '2026-07-29.dahlia' as const

export class StripeNotConfiguredError extends Error {
  constructor() {
    super('STRIPE_SECRET_KEY is not set')
    this.name = 'StripeNotConfiguredError'
  }
}

let client: Stripe | null = null

/// Returns null rather than throwing when Stripe is unconfigured, so a caller
/// that only wants to know "can we take a card right now" does not have to
/// catch. Callers that genuinely need Stripe use `requireStripe`.
export function stripeClient(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) return null
  if (!client) {
    client = new Stripe(key, {
      apiVersion: API_VERSION,
      // Identifies our traffic in Stripe's logs, which is what you want at 2am
      // when you are trying to tell a webhook retry from a fresh charge.
      appInfo: { name: 'storage-platform' },
      // Stripe retries network-level failures itself. Two is enough to ride out
      // a blip without turning a slow request into a long one.
      maxNetworkRetries: 2,
    })
  }
  return client
}

export function requireStripe(): Stripe {
  const stripe = stripeClient()
  if (!stripe) throw new StripeNotConfiguredError()
  return stripe
}

/// True when the platform can actually take a payment. The UI uses this to
/// decide between showing a payment step and telling the renter to call — which
/// is the honest thing to do rather than rendering a form that cannot submit.
export function paymentsEnabled(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET)
}

/// Idempotency key for a Stripe write.
///
/// Stripe deduplicates by this key for 24 hours, which is what makes a retried
/// request safe: the same key returns the original result instead of charging
/// again. The key must therefore be derived from *what the money is for*, never
/// from a timestamp or a random value — a fresh key on retry is exactly the bug
/// idempotency exists to prevent.
export function idempotencyKey(...parts: (string | number)[]): string {
  return parts.map(String).join(':')
}
