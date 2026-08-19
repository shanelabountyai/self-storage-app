import { prisma } from '../packages/db'
import { expireCheckoutSessions } from '../apps/web/lib/checkout/session'
import { expireReservations } from '../apps/web/lib/reservations/reserve'

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
    // Far enough ahead that every hold any previous run took has lapsed.
    const wellPastEveryLock = new Date(Date.now() + 24 * 60 * 60 * 1000)

    const { expired } = await expireCheckoutSessions(wellPastEveryLock)
    if (expired > 0) {
      console.info(`[e2e setup] released ${expired} stale checkout lock(s) from a previous run`)
    }

    // Reservations too, and scoped to the sandbox facility alone.
    //
    // The checkout release above was not enough on its own: a full run consumes
    // roughly 52 of the sandbox's 60 units in checkout locks, so the handful of
    // held reservations each run leaves behind — the specs cancel most but not
    // all of theirs — took the facility to exactly zero within a couple of
    // runs, and the reserve tests then failed with no unit to hold.
    //
    // Safe to expire every hold here: nothing in the suite reads a pre-seeded
    // reservation (the reservation specs create and cancel their own), and any
    // hold that exists when SETUP runs is by definition from a previous run.
    // Scoped by slug so the demo facility the admin and portal specs assert
    // against is never touched.
    const sandbox = await prisma.facility.findUnique({
      where: { slug: 'demo-e2e' },
      select: { id: true },
    })
    if (sandbox) {
      const { expired: holds } = await expireReservations(wellPastEveryLock, sandbox.id)
      if (holds > 0) {
        console.info(`[e2e setup] released ${holds} stale reservation hold(s) from a previous run`)
      }
    }
    // B-130. Lien notices any previous run generated, on demo facilities only.
    //
    // The third genuinely-disposable state this setup resets, and it qualifies
    // on the same footing as the two above: **nothing in the suite reads a
    // pre-existing notice**, and the seed itself deletes them on every re-run,
    // so a notice in the database when SETUP runs is by definition one a
    // previous run generated.
    //
    // It is needed because generating a notice is NOT idempotent — each one is
    // a new row, deliberately, since a notice is a served document and the
    // product must never rewrite one. Without this the notices spec would find
    // three notices on the third run and assert against a list it did not
    // build. Documents go first: `Notice.document` is `onDelete: Restrict`, so
    // the notice has to release its hash before the document can go.
    const demoFacilities = await prisma.facility.findMany({
      where: { slug: { startsWith: 'demo-' } },
      select: { id: true },
    })
    const demoIds = demoFacilities.map((facility) => facility.id)
    if (demoIds.length > 0) {
      const { count } = await prisma.notice.deleteMany({ where: { facilityId: { in: demoIds } } })
      await prisma.document.deleteMany({
        where: { facilityId: { in: demoIds }, subjectType: 'Notice' },
      })
      if (count > 0) {
        console.info(`[e2e setup] cleared ${count} lien notice(s) from a previous run`)
      }
    }

    // B-091 part 2. Support sessions a previous run started — the fourth
    // disposable state, and the one that reset itself least gracefully.
    //
    // It qualifies on the same footing as the three above: nothing in the suite
    // reads a pre-existing `ImpersonationSession`, and the only thing that
    // creates one is impersonation.spec.ts. What makes it NECESSARY is
    // different, though, and it is SR-7 rather than a lock: session starts are
    // throttled to ten per impersonator per hour, the demo owner is the only
    // impersonator the suite has, and one sweep across two Playwright projects
    // spends two of them. Three consecutive sweeps inside an hour hit the
    // ceiling exactly — measured at 10 rows in a 60-minute window — and the
    // desktop project then failed on a URL assertion, which reads like a broken
    // feature and was the throttle correctly refusing.
    //
    // **Scoped by `auditLogs: { none: {} }`, which is not defensive padding.**
    // `AuditLog.session` is `onDelete: Restrict`, so a session an audit entry
    // points at cannot be deleted. Today none do — `impersonation.started` and
    // `.ended` record the session as their ENTITY, not through the FR-24
    // attribution columns — but the day `impersonation:write` ships, entries
    // written during a session will carry it, and an unscoped `deleteMany` here
    // would start failing every run. This leaves those rows alone by
    // construction rather than by the FK shouting.
    const { count: sessions } = await prisma.impersonationSession.deleteMany({
      where: { auditLogs: { none: {} } },
    })
    if (sessions > 0) {
      console.info(`[e2e setup] cleared ${sessions} support session(s) from a previous run`)
    }
  } finally {
    await prisma.$disconnect()
  }
}
