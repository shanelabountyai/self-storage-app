import { randomBytes } from 'node:crypto'
import { prisma } from '@storage/db'
import { absoluteUrl } from '@storage/core/marketing'
import {
  CLAIM_WINDOW_HOURS,
  isPlausibleEmail,
  normaliseEmail,
  notifiableCount,
  positionOf,
  type WaitlistPosition,
} from '@storage/core/waitlist'
import { sendDirectEmail } from '@/lib/comms/service'
import { siteOrigin } from '@/lib/marketing/origin'
import { facilityPagePath } from '@/lib/marketing/paths'

// PRD 01 §9 Phase 3 (B-090 part 1). Joining a waitlist, leaving one, and the
// sweep that tells people a unit is free.
//
// No tenant is involved at any point. A waitlist entry is a stranger who left
// an email address, so the notification goes out through `sendDirectEmail` —
// the path B-073's abandonment mail and B-020's resume links already use —
// rather than through the rule engine, which resolves its recipients from
// `Tenant` and has nowhere to put a prospect.

/// Local, matching `tasks.ts`, `invoices.ts` and `late-fees.ts`, which each
/// carry their own copy. Deduplicating the four into a shared module is a
/// worthwhile chore and is not this item's business — a canonical copy that
/// three call sites still ignore is worse than four honest ones.
function isUniqueConstraintError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'P2002')
}

export type JoinResult =
  | { ok: true; alreadyOn: boolean }
  | { ok: false; problem: string }

/// Adds somebody to the list for one unit type.
///
/// Idempotent by address: joining twice is "you are already on this list"
/// rather than a second entry or an error, because the second submit is nearly
/// always a double-click or a second tab, and telling somebody their perfectly
/// reasonable action failed is worse than doing nothing.
export async function joinWaitlist(input: {
  facilityId: string
  unitTypeId: string
  email: string
  phone?: string | null
  firstName?: string | null
}): Promise<JoinResult> {
  if (!isPlausibleEmail(input.email)) {
    return { ok: false, problem: 'Enter an email address we can reach you at.' }
  }

  const email = normaliseEmail(input.email)

  // The unit type has to belong to the facility being named. Both arrive from
  // a form, so neither is trusted: without this, a crafted post puts somebody
  // on a list for a unit type at a different site, and the mail they eventually
  // get names a facility they never asked about.
  const unitType = await prisma.unitType.findFirst({
    where: { id: input.unitTypeId, facilityId: input.facilityId, facility: { status: 'active' } },
    select: { id: true },
  })
  if (!unitType) return { ok: false, problem: 'That unit is no longer listed.' }

  try {
    await prisma.waitlistEntry.create({
      data: {
        facilityId: input.facilityId,
        unitTypeId: input.unitTypeId,
        email,
        phone: input.phone?.trim() || null,
        firstName: input.firstName?.trim() || null,
        // 32 bytes of base64url. The only credential a non-tenant has for their
        // own record, so it is generated rather than derived from anything
        // guessable — an id-based cancel link would let anybody cancel anybody.
        cancelToken: randomBytes(32).toString('base64url'),
      },
    })
    return { ok: true, alreadyOn: false }
  } catch (error) {
    // `waitlist_one_live_entry_per_email_per_type`. The read-then-write race
    // this catches is a double-submitted form, which is common enough that the
    // constraint is the real guard and there is deliberately no findFirst
    // fast path above it.
    if (isUniqueConstraintError(error)) return { ok: true, alreadyOn: true }
    throw error
  }
}

export type CancelResult = { ok: boolean; alreadyClosed: boolean }

/// Leaves the list, from the link in the mail.
///
/// The token is the whole authorisation, and it is single-use in effect: once
/// the row is `cancelled` a second visit reports "already off the list" rather
/// than failing, so a prospect who clicks twice is not told something went
/// wrong.
export async function cancelWaitlist(token: string): Promise<CancelResult> {
  if (!token.trim()) return { ok: false, alreadyClosed: false }

  const entry = await prisma.waitlistEntry.findUnique({
    where: { cancelToken: token },
    select: { id: true, status: true },
  })
  if (!entry) return { ok: false, alreadyClosed: false }
  if (entry.status === 'cancelled') return { ok: true, alreadyClosed: true }

  await prisma.waitlistEntry.update({
    where: { id: entry.id },
    data: { status: 'cancelled' },
  })
  return { ok: true, alreadyClosed: false }
}

/// Where somebody sits in the queue for their unit type.
export async function waitlistPosition(entryId: string): Promise<WaitlistPosition | null> {
  const entry = await prisma.waitlistEntry.findUnique({
    where: { id: entryId },
    select: { unitTypeId: true },
  })
  if (!entry) return null

  const waiting = await prisma.waitlistEntry.findMany({
    where: { unitTypeId: entry.unitTypeId, status: 'waiting' },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  })
  return positionOf(entryId, waiting.map((row) => row.id))
}

export type SweepResult = { notified: number; expired: number }

/// The sweep: expire stale claims, then tell as many people as there are units
/// genuinely free.
///
/// Called every cron tick rather than through `SCHEDULED_JOBS`, and for the
/// same reason `sendExpiringSoonReminders` and `raiseAbandonmentFollowUps`
/// are: a unit becomes available when somebody moves out or a hold lapses,
/// which happens at an arbitrary hour. A once-per-business-date job would
/// either miss the window or deliver a whole day's backlog at once — and a
/// free unit sitting unadvertised overnight is the exact revenue this feature
/// exists to stop losing.
export async function sweepWaitlists(now: Date = new Date()): Promise<SweepResult> {
  // Claims first. A window that lapsed since the last tick has to free its slot
  // BEFORE availability is counted, or the next person waits an extra tick for
  // no reason.
  const { count: expired } = await prisma.waitlistEntry.updateMany({
    where: {
      status: 'notified',
      notifiedAt: { lte: new Date(now.getTime() - CLAIM_WINDOW_HOURS * 3_600_000) },
    },
    data: { status: 'expired' },
  })

  // Only unit types somebody is actually waiting for — the sweep is bounded by
  // the length of the waitlist, not by the size of the portfolio.
  const wanted = await prisma.waitlistEntry.groupBy({
    by: ['unitTypeId'],
    where: { status: 'waiting' },
  })
  if (wanted.length === 0) return { notified: 0, expired }

  const unitTypeIds = wanted.map((row) => row.unitTypeId)

  const [availability, outstanding, unitTypes] = await Promise.all([
    prisma.unit.groupBy({
      by: ['unitTypeId'],
      where: { unitTypeId: { in: unitTypeIds }, status: 'available' },
      _count: { _all: true },
    }),
    prisma.waitlistEntry.groupBy({
      by: ['unitTypeId'],
      where: { unitTypeId: { in: unitTypeIds }, status: 'notified' },
      _count: { _all: true },
    }),
    prisma.unitType.findMany({
      where: { id: { in: unitTypeIds } },
      select: {
        id: true,
        name: true,
        widthFt: true,
        lengthFt: true,
        facility: { select: { id: true, name: true, slug: true, city: true, state: true, phone: true } },
      },
    }),
  ])

  const availableBy = new Map(availability.map((row) => [row.unitTypeId, row._count._all]))
  const outstandingBy = new Map(outstanding.map((row) => [row.unitTypeId, row._count._all]))
  const typeBy = new Map(unitTypes.map((row) => [row.id, row]))

  let notified = 0

  for (const { unitTypeId } of wanted) {
    const unitType = typeBy.get(unitTypeId)
    if (!unitType) continue

    const waiting = await prisma.waitlistEntry.findMany({
      where: { unitTypeId, status: 'waiting' },
      select: { id: true, email: true, firstName: true, cancelToken: true },
      // FIFO. Not a ranking of prospects — see the note in the core module.
      orderBy: { createdAt: 'asc' },
    })

    const slots = notifiableCount(
      availableBy.get(unitTypeId) ?? 0,
      outstandingBy.get(unitTypeId) ?? 0,
      waiting.length,
    )

    for (const entry of waiting.slice(0, slots)) {
      // Stamped BEFORE the send, and guarded on the status it was read in.
      // A second tick overlapping this one finds the row already `notified`
      // and skips it; the alternative ordering sends first and can send twice.
      const claimed = await prisma.waitlistEntry.updateMany({
        where: { id: entry.id, status: 'waiting' },
        data: { status: 'notified', notifiedAt: now },
      })
      if (claimed.count === 0) continue

      await sendAvailabilityEmail(entry, unitType)
      notified += 1
    }
  }

  return { notified, expired }
}

async function sendAvailabilityEmail(
  entry: { id: string; email: string; firstName: string | null; cancelToken: string },
  unitType: {
    name: string
    widthFt: number
    lengthFt: number
    facility: { id: string; name: string; slug: string; city: string; state: string; phone: string | null }
  },
): Promise<void> {
  const origin = siteOrigin()
  const size = `${unitType.widthFt} × ${unitType.lengthFt}`
  const facilityUrl = absoluteUrl(origin, facilityPagePath(unitType.facility))
  const cancelUrl = absoluteUrl(origin, `/waitlist/cancel/${entry.cancelToken}`)

  const text = [
    entry.firstName ? `Hi ${entry.firstName},` : 'Hi,',
    '',
    `A ${size} unit has come free at ${unitType.facility.name}.`,
    '',
    `You asked us to tell you. We are holding your place for ${CLAIM_WINDOW_HOURS} hours — after that we let the next person on the list know.`,
    '',
    `Rent it online: ${facilityUrl}`,
    ...(unitType.facility.phone ? ['', `Or call us on ${unitType.facility.phone}.`] : []),
    '',
    `If you no longer need a unit, take yourself off the list: ${cancelUrl}`,
  ].join('\n')

  await sendDirectEmail({
    // Keyed on the entry, so the whole pipeline refuses a second send for one
    // notification even if the sweep is somehow run twice for the same row.
    idempotencyKey: `waitlist-available:${entry.id}`,
    eventId: entry.id,
    templateKey: 'waitlist_unit_available',
    // **Transactional, and this is a decision rather than a default (D-80).**
    // The recipient asked to be told about one named unit type at one named
    // facility, and this is the single message that answers that request. It
    // carries a cancel link regardless.
    classification: 'transactional',
    to: entry.email,
    fromName: unitType.facility.name,
    subject: `A ${size} unit is free at ${unitType.facility.name}`,
    html: `<p>${text.replace(/\n/g, '<br>')}</p>`,
    text,
    facilityId: unitType.facility.id,
    recipientTenantId: null,
  })
}
