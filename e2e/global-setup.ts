import { prisma } from '../packages/db'
import { expireCheckoutSessions } from '../apps/web/lib/checkout/session'

// Releases stale checkout locks BEFORE the suite runs.
//
// `global-teardown.ts` already does this at the end, and the reason to do it at
// both ends is that only this end is guaranteed to happen. A run that is
// interrupted, that times out, or whose teardown is cut short as the dev server
// shuts down leaks a handful of locked units — and since each lock holds a real
// unit for 30 minutes, a few such runs in one session exhaust the demo
// facility's inventory. What that looks like from the outside is a dozen
// unrelated tests failing with "no Reserve for free link", which reads exactly
// like a code regression and is not one. It cost three separate diagnoses in a
// single evening before this file existed.
//
// Idempotent and safe to run against a clean database: with no stale sessions
// it expires nothing. Scoped to checkout sessions only, for the same reason the
// teardown is — nothing in the demo seed creates one, so every session in the
// database belongs to a test, while the seed does create reservations and the
// reservation tests cancel their own.
export default async function globalSetup(): Promise<void> {
  if (!process.env.DATABASE_URL) return
  try {
    // Far enough ahead that every lock any previous run took has lapsed.
    const wellPastEveryLock = new Date(Date.now() + 24 * 60 * 60 * 1000)
    const { expired } = await expireCheckoutSessions(wellPastEveryLock)
    if (expired > 0) {
      console.info(`[e2e setup] released ${expired} stale checkout lock(s) from a previous run`)
    }
  } finally {
    await prisma.$disconnect()
  }
}
