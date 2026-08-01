import { prisma } from '../packages/db'
import { expireCheckoutSessions } from '../apps/web/lib/checkout/session'

// B-020. Releases the units the suite locked.
//
// Checkout tests hold real inventory for 30 minutes and, unlike a reservation,
// there is no renter-facing way to give a unit back — so without this the demo
// facility quietly loses a unit per run until a size sells out and unrelated
// tests start failing for reasons that have nothing to do with the code.
//
// Scoped to checkout sessions only. Nothing in the demo seed creates one, so
// every session in the database belongs to a test; reservations are left alone
// because the seed does create those and the reservation tests cancel their own.
export default async function globalTeardown(): Promise<void> {
  if (!process.env.DATABASE_URL) return
  try {
    // A date far enough ahead that every lock the run took has lapsed.
    const wellPastEveryLock = new Date(Date.now() + 24 * 60 * 60 * 1000)
    const { expired } = await expireCheckoutSessions(wellPastEveryLock)
    if (expired > 0) console.info(`[e2e teardown] released ${expired} checkout lock(s)`)
  } finally {
    await prisma.$disconnect()
  }
}
