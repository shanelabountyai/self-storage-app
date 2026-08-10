import { createHash, randomBytes } from 'node:crypto'
import { type Prisma, prisma } from '@storage/db'
import { recomputeUnitStatus } from '@/lib/admin/units'
import { sendDirectEmail } from '@/lib/comms/service'

// PRD 01 FR-4.1. The server-side checkout state machine.
//
// Every transition is validated here, not in the browser: a stepper whose
// current step lives in client state is a stepper a renter can skip. The
// session row is the truth, and the page renders whatever step it says.

/// FR-4.1's "30-min unit lock".
export const LOCK_MINUTES = 30

/// §6.8 / 2.2.1: the renter is warned before the lock lapses, with a
/// one-activation extension. Five minutes is enough to finish a step or press
/// the button.
export const LOCK_WARNING_MINUTES = 5

export const STEPS = [
  'details',
  'unit_assign',
  'insurance',
  'lease',
  'payment',
  'provisioned',
] as const

export type Step = (typeof STEPS)[number]

/// Step order is a list, not a graph: FR-4.1 describes one linear path, and a
/// renter may always go back to a step they have already completed. Nothing
/// lets them jump forward past one they have not.
export function canEnter(current: Step, target: Step): boolean {
  return STEPS.indexOf(target) <= STEPS.indexOf(current)
}

export function nextStep(current: Step): Step {
  const index = STEPS.indexOf(current)
  return STEPS[Math.min(index + 1, STEPS.length - 1)]
}

function newToken(): string {
  return randomBytes(32).toString('base64url')
}

/// Only the hash is stored — same rule as reservations and auth tokens, so a
/// database leak hands over no working resume links.
export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function lockUntil(from: Date = new Date()): Date {
  return new Date(from.getTime() + LOCK_MINUTES * 60_000)
}

/// Claims one available unit of a type. Identical to the reservation claim
/// (B-018) and for the same reason: `FOR UPDATE SKIP LOCKED` lets two
/// simultaneous checkouts take different units, and gives exactly one of them
/// the last unit rather than overselling it.
async function claimUnit(
  tx: Prisma.TransactionClient,
  facilityId: string,
  unitTypeId: string,
): Promise<string | null> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "unit"
    WHERE "facilityId" = ${facilityId}
      AND "unitTypeId" = ${unitTypeId}
      AND "status" = 'available'
    ORDER BY "id"
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  `
  return rows[0]?.id ?? null
}

export type StartInput = {
  facilityId: string
  unitTypeId: string
  quotedRateCents: number
  /// Set when the renter is converting a free hold. The reservation's unit is
  /// used instead of claiming a new one — they were already promised that unit,
  /// and taking a second would hold two.
  reservationId?: string
}

export type StartResult =
  | { ok: true; sessionId: string; token: string; unitId: string; lockExpiresAt: Date }
  | { ok: false; reason: 'sold_out' }

export async function startCheckout(input: StartInput): Promise<StartResult> {
  const token = newToken()

  return prisma.$transaction(async (tx) => {
    let unitId: string | null = null
    // Only kept if the reservation is real and still live. Carrying the caller's
    // id through regardless would write a dangling FK for an unknown id, and
    // would link the session to a hold that no longer holds anything.
    let reservationId: string | null = null

    if (input.reservationId) {
      const reservation = await tx.reservation.findUnique({
        where: { id: input.reservationId },
        select: { unitId: true, status: true },
      })
      // A hold that has since expired or been cancelled gives us nothing, so
      // fall through and claim a unit like any other checkout.
      if (reservation?.status === 'held') {
        unitId = reservation.unitId
        reservationId = input.reservationId
      }
    }

    unitId ??= await claimUnit(tx, input.facilityId, input.unitTypeId)
    if (!unitId) return { ok: false as const, reason: 'sold_out' as const }

    const session = await tx.checkoutSession.create({
      data: {
        facilityId: input.facilityId,
        unitTypeId: input.unitTypeId,
        unitId,
        reservationId,
        quotedRateCents: input.quotedRateCents,
        tokenHash: hashSessionToken(token),
        lockExpiresAt: lockUntil(),
      },
    })

    await recomputeUnitStatus(unitId, tx)
    return {
      ok: true as const,
      sessionId: session.id,
      token,
      unitId,
      lockExpiresAt: session.lockExpiresAt,
    }
  })
}

export type CheckoutSessionView = {
  id: string
  step: Step
  status: string
  facilityId: string
  unitTypeId: string
  unitId: string | null
  tenantId: string | null
  email: string | null
  quotedRateCents: number
  /// PRD 04 US-12 AC2 (B-070). The promotion carried from the facility page,
  /// so the total shown before payment is the one that gets redeemed.
  promotionId: string | null
  promoCodeId: string | null
  lockExpiresAt: Date
  data: Record<string, unknown>
  /// True when the lock has lapsed. Derived rather than stored, so it is right
  /// the moment it happens instead of when a sweep next runs.
  lockLapsed: boolean
}

function toView(session: {
  id: string
  step: string
  status: string
  facilityId: string
  unitTypeId: string
  unitId: string | null
  tenantId: string | null
  email: string | null
  quotedRateCents: number
  promotionId: string | null
  promoCodeId: string | null
  lockExpiresAt: Date
  data: unknown
}): CheckoutSessionView {
  return {
    ...session,
    step: session.step as Step,
    data: (session.data ?? {}) as Record<string, unknown>,
    lockLapsed: session.lockExpiresAt.getTime() <= Date.now(),
  }
}

export async function sessionByToken(token: string): Promise<CheckoutSessionView | null> {
  if (!token) return null
  const session = await prisma.checkoutSession.findUnique({
    where: { tokenHash: hashSessionToken(token) },
  })
  return session ? toView(session) : null
}

/// By id rather than token — for server-side callers like the webhook
/// reconciler, which knows the session from a PaymentIntent's metadata and has
/// no token to hand.
export async function sessionById(sessionId: string): Promise<CheckoutSessionView | null> {
  const session = await prisma.checkoutSession.findUnique({ where: { id: sessionId } })
  return session ? toView(session) : null
}

export type AdvanceResult =
  | { ok: true; session: CheckoutSessionView }
  | { ok: false; reason: 'not_found' | 'not_active' | 'lock_lapsed' | 'out_of_order' }

/// Records a step's data and moves to the next one.
///
/// Refuses when the lock has lapsed: the unit may already belong to someone
/// else, and letting the renter carry on to a payment step for a unit we cannot
/// give them is the failure this whole state machine exists to prevent. The
/// caller renders the unit-lost fallback.
export async function advance(
  token: string,
  from: Step,
  data: Record<string, unknown> = {},
): Promise<AdvanceResult> {
  return prisma.$transaction(async (tx) => {
    const session = await tx.checkoutSession.findUnique({
      where: { tokenHash: hashSessionToken(token) },
    })
    if (!session) return { ok: false as const, reason: 'not_found' as const }
    if (session.status !== 'active') return { ok: false as const, reason: 'not_active' as const }
    if (session.lockExpiresAt.getTime() <= Date.now()) {
      return { ok: false as const, reason: 'lock_lapsed' as const }
    }
    // Posting step 4's form while the session says step 2 means a stale tab or
    // a forged request. Either way the server's step is the truth.
    if (session.step !== from) return { ok: false as const, reason: 'out_of_order' as const }

    const merged = { ...((session.data ?? {}) as Record<string, unknown>), ...data }
    const target = nextStep(session.step as Step)

    const updated = await tx.checkoutSession.update({
      where: { id: session.id },
      data: {
        step: target,
        data: merged as Prisma.InputJsonValue,
        // Advancing is activity, so it renews the lock. A renter working
        // through the steps never sees the warning.
        lockExpiresAt: lockUntil(),
        ...(typeof data.email === 'string' ? { email: data.email } : {}),
        ...(target === 'provisioned' ? { status: 'completed' as const } : {}),
      },
    })

    return { ok: true as const, session: toView(updated) }
  })
}

/// PRD 05 CN-22 / PRD 01 FR-4.1. "Sent when the checkout session is created and
/// the renter's email is captured (end of step 1)" — a real link back into a
/// resumable draft, which FR-4.1 promises and nothing sent until this item.
/// Direct and synchronous, not through the rule/template pipeline: the raw
/// session token exists only in this call (never persisted — same rule as the
/// reservation token and B-029's gate codes), and a renter mid-lease-step who
/// closes the tab is exactly who is looking at their inbox right now, not
/// waiting for the next hourly tick.
///
/// The link always resolves to whatever step the session is *currently* on —
/// `sessionByToken` already resumes at `session.step` (B-020) — so there is no
/// step to encode here, just the token.
export async function sendCheckoutResumeLink(sessionId: string, token: string): Promise<void> {
  const session = await prisma.checkoutSession.findUnique({
    where: { id: sessionId },
    select: {
      email: true,
      lockExpiresAt: true,
      facility: { select: { id: true, name: true, timezone: true } },
    },
  })
  if (!session?.email) return

  const base = (process.env.AUTH_URL ?? 'http://localhost:3000').replace(/\/$/, '')
  const link = `${base}/checkout?token=${encodeURIComponent(token)}`
  const holdUntil = new Intl.DateTimeFormat('en-US', {
    timeZone: session.facility.timezone,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(session.lockExpiresAt)

  const text = [
    `We're holding this unit for you until ${holdUntil}. After that it goes back on sale.`,
    '',
    `Finish moving in where you left off: ${link}`,
  ].join('\n')

  await sendDirectEmail({
    idempotencyKey: `checkout-resume-link:${sessionId}`,
    eventId: sessionId,
    templateKey: 'checkout_resume_link',
    classification: 'transactional',
    to: session.email,
    fromName: session.facility.name,
    subject: 'Finish moving in online',
    html: `<p>${text.replace(/\n/g, '<br>')}</p>`,
    text,
    facilityId: session.facility.id,
    recipientTenantId: null,
  })
}

/// Extends the lock. Called by the renter pressing "keep it" and by the
/// heartbeat alike.
///
/// 2.2.1 requires an extension the user can actually reach, and the heartbeat
/// must not be the only thing keeping the lock alive: a screen-reader user
/// reading a long lease generates no interaction events, and an idle-based
/// heartbeat would drop precisely them. So this is exposed as an explicit
/// control, not just a timer.
export async function extendLock(token: string): Promise<AdvanceResult> {
  const session = await prisma.checkoutSession.findUnique({
    where: { tokenHash: hashSessionToken(token) },
  })
  if (!session) return { ok: false, reason: 'not_found' }
  if (session.status !== 'active') return { ok: false, reason: 'not_active' }
  // A lapsed lock is not extendable: the unit may already be someone else's,
  // and pretending otherwise would sell it twice.
  if (session.lockExpiresAt.getTime() <= Date.now()) return { ok: false, reason: 'lock_lapsed' }

  const updated = await prisma.checkoutSession.update({
    where: { id: session.id },
    data: { lockExpiresAt: lockUntil() },
  })
  return { ok: true, session: toView(updated) }
}

export type RelockResult =
  | { ok: true; session: CheckoutSessionView }
  | { ok: false; reason: 'sold_out' }

/// FR-4.1's "unit-lost fallback offer". After a lock lapses, tries to put the
/// renter back on another unit of the same type so they keep their progress
/// instead of starting over. Returns sold_out when the type is genuinely gone,
/// which the page turns into an honest offer of something else.
export async function relock(sessionId: string): Promise<RelockResult> {
  return prisma.$transaction(async (tx) => {
    const session = await tx.checkoutSession.findUniqueOrThrow({ where: { id: sessionId } })
    const previousUnitId = session.unitId

    const unitId = await claimUnit(tx, session.facilityId, session.unitTypeId)
    if (!unitId) return { ok: false as const, reason: 'sold_out' as const }

    const updated = await tx.checkoutSession.update({
      where: { id: session.id },
      data: { unitId, status: 'active', lockExpiresAt: lockUntil() },
    })

    await recomputeUnitStatus(unitId, tx)
    // The unit they lost goes back on the market if nothing else took it.
    if (previousUnitId && previousUnitId !== unitId) {
      await recomputeUnitStatus(previousUnitId, tx)
    }
    return { ok: true as const, session: toView(updated) }
  })
}

/// PRD 04 US-9 AC1 (B-073). Mints a fresh session token for the abandonment
/// email's resume link to redeem — the original token was never stored
/// (`tokenHash` only), so there is nothing left to hand back days later. Only
/// the hash changes; nothing about the session's progress does, so the
/// renter lands exactly where `sessionByToken` already resumes them.
export async function reissueCheckoutToken(sessionId: string): Promise<string | null> {
  const session = await prisma.checkoutSession.findUnique({
    where: { id: sessionId },
    select: { status: true },
  })
  if (!session || session.status === 'completed') return null

  const token = newToken()
  await prisma.checkoutSession.update({
    where: { id: sessionId },
    data: { tokenHash: hashSessionToken(token) },
  })
  return token
}

/// Marks lapsed sessions expired and returns their units. Idempotent, and safe
/// to run repeatedly — availability already ignores a lapsed lock, so a missed
/// run costs nothing but tidiness.
export async function expireCheckoutSessions(
  now: Date = new Date(),
  facilityId?: string,
): Promise<{ expired: number }> {
  const due = await prisma.checkoutSession.findMany({
    where: { status: 'active', lockExpiresAt: { lte: now }, ...(facilityId ? { facilityId } : {}) },
    select: { id: true, unitId: true },
  })

  let expired = 0
  for (const session of due) {
    await prisma.$transaction(async (tx) => {
      const fresh = await tx.checkoutSession.findUnique({
        where: { id: session.id },
        select: { status: true },
      })
      if (fresh?.status !== 'active') return

      await tx.checkoutSession.update({ where: { id: session.id }, data: { status: 'expired' } })
      // The unit is released, but the session is kept: it is the record of what
      // the renter had chosen, and B-073's abandonment follow-up reads it.
      if (session.unitId) await recomputeUnitStatus(session.unitId, tx)
      expired += 1
    })
  }
  return { expired }
}
