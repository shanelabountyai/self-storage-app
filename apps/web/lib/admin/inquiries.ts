import { prisma } from '@storage/db'
import { recordAudit } from '@storage/core/audit'
import { isStaffLeadSource, LEAD_SOURCE_LABELS } from '@storage/core/metrics'
import { calculateMoveInCost } from '@storage/core/pricing'
import { offerFor } from '@/lib/promotions/service'
import { createReservation } from '@/lib/reservations/reserve'
import { publicInventoryForFacility } from '@/lib/inventory/public-inventory'
import { assertFacilityAccess, can, ForbiddenError } from '@/lib/rbac/authorize'
import { toAuditActor } from '@/lib/rbac/audit-actor'
import type { Actor } from '@/lib/rbac/actor'

// PRD 02 §4.8 US-43 (B-097). "Do you have a 10x10 and how much?" is a
// ninety-second call that converts often, and today there is nowhere to put it.
//
// The three acceptance criteria are one flow: capture in under a minute, quote
// from what was captured, hold through the same reservation service the website
// uses. Anything that makes a staffer leave this flow to look something up
// defeats the sixty-second target, which is why the quote is computed here
// rather than linked to.

export type CreateInquiryInput = {
  facilityId: string
  firstName: string
  lastName: string
  phone: string
  email?: string | null
  source: string
  unitTypeId?: string | null
  targetMoveInDate?: Date | null
  message?: string | null
}

export type InquiryResult = { ok: true; leadId: string } | { ok: false; field: string; problem: string }

/// US-43's capture. Name, phone, what they need, target date, unit-type
/// interest, source.
///
/// Email is optional and phone is not — the inverse of the web form, and
/// deliberate. Somebody on the phone will give a number without hesitating and
/// spell an email address badly; a lead with a wrong email is worse than one
/// with none, because the follow-up looks sent.
export async function createInquiry(
  actor: Actor,
  input: CreateInquiryInput,
): Promise<InquiryResult> {
  assertFacilityAccess(actor, input.facilityId)
  if (!can(actor, 'tenants:edit', input.facilityId)) {
    throw new ForbiddenError('Missing permission to record an inquiry', 'tenants:edit', input.facilityId)
  }

  if (!input.firstName.trim() && !input.lastName.trim()) {
    return { ok: false, field: 'firstName', problem: 'A name, even just a first name.' }
  }
  const phone = input.phone.trim()
  if (phone.replace(/\D/g, '').length < 10) {
    return { ok: false, field: 'phone', problem: 'A phone number with at least 10 digits — this is how anyone calls them back.' }
  }
  if (!isStaffLeadSource(input.source)) {
    return { ok: false, field: 'source', problem: 'Choose where this inquiry came from.' }
  }

  const lead = await prisma.lead.create({
    data: {
      facilityId: input.facilityId,
      unitTypeId: input.unitTypeId || null,
      firstName: input.firstName.trim() || null,
      lastName: input.lastName.trim() || null,
      phone,
      email: input.email?.trim().toLowerCase() || null,
      message: input.message?.trim() || null,
      source: input.source,
      targetMoveInDate: input.targetMoveInDate ?? null,
      createdByStaffId: actor.kind === 'staff' ? actor.staffUserId : null,
      status: 'new',
    },
  })

  await recordAudit({
    actor: toAuditActor(actor),
    action: 'lead.created',
    entityType: 'Lead',
    entityId: lead.id,
    facilityId: input.facilityId,
    context: { source: input.source, unitTypeId: input.unitTypeId ?? null },
  })

  return { ok: true, leadId: lead.id }
}

export type QuoteLine = {
  unitTypeId: string
  name: string
  sqFt: number
  availableCount: number
  /// US-43 asks for "current online and in-store price for the type". Both, on
  /// one screen, because the caller is going to ask what the difference is and
  /// a staffer who has to open another tab has already lost the minute.
  webRateCents: number
  streetRateCents: number
  /// What they would actually pay today to walk out with a key — rent, fees,
  /// protection and tax, through the same calculator checkout uses.
  moveInTotalCents: number
  /// The live promotion for this type, or null when none applies. Read through
  /// the same `offerFor` the public facility page calls (B-070/B-109), because
  /// this screen exists so a staffer on the phone cannot quote a price the
  /// website contradicts — and until B-109 it silently could: the quote was
  /// built with no promotion at all while the website priced one.
  promo: { terms: string; firstPeriodCents: number } | null
}

export type LeadQuote = {
  facilityId: string
  lines: QuoteLine[]
  /// Whether any line carries a live promotion. Computed from the lines rather
  /// than declared, so it cannot drift from what the table actually shows —
  /// it was a hardcoded `false` from B-039 until B-109, which is precisely how
  /// it survived B-070 shipping the engine it claimed did not exist.
  promotionsAvailable: boolean
}

/// US-43's quote: every type, both prices, and what today would cost.
///
/// Reads through `publicInventoryForFacility` — the same function the public
/// page calls — so a staffer quoting on the phone cannot name a price the
/// website contradicts. It is keyed by SLUG rather than id, which is the one
/// awkward seam in reusing it here and is worth the trade.
export async function quoteForFacility(actor: Actor, facilityId: string): Promise<LeadQuote> {
  assertFacilityAccess(actor, facilityId)

  const facility = await prisma.facility.findUniqueOrThrow({
    where: { id: facilityId },
    select: { slug: true },
  })
  const inventory = await publicInventoryForFacility(facility.slug)
  const lines: QuoteLine[] = await Promise.all((inventory?.unitTypes ?? []).map(async (unitType) => {
    // The same calculator the public page and checkout use, so the number a
    // staffer reads down the phone is the number the caller will see online.
    const cost = calculateMoveInCost({
      webRateCents: unitType.webRateCents,
      streetRateCents: unitType.streetRateCents,
      adminFeeCents: inventory!.pricing.adminFeeCents,
      taxRates: inventory!.pricing.taxRates,
    })
    // Same call, same arguments as the public facility page, so the two agree
    // by construction rather than by two developers remembering to. A caller on
    // the phone and the same person on the website now see one number.
    const lookup = await offerFor({
      facilityId,
      unitTypeId: unitType.unitTypeId,
      monthlyRateCents: unitType.webRateCents,
      isNewTenant: true,
    })

    return {
      unitTypeId: unitType.unitTypeId,
      name: unitType.name,
      sqFt: unitType.sqFt,
      availableCount: unitType.availableCount,
      webRateCents: unitType.webRateCents,
      streetRateCents: unitType.streetRateCents,
      moveInTotalCents: cost.totalDueTodayCents,
      promo: lookup.offer
        ? { terms: lookup.offer.terms, firstPeriodCents: lookup.offer.firstPeriodCents }
        : null,
    }
  }))

  return { facilityId, lines, promotionsAvailable: lines.some((line) => line.promo !== null) }
}

export type HoldResult =
  | { ok: true; reservationId: string; expiresAt: Date }
  | { ok: false; problem: string }

/// US-43's hold: "one click to place a free hold through the same reservation
/// service the website uses, with `source = phone`. No card, no account."
///
/// The same service, not a parallel one. A second reservation path would need
/// its own copy of the unit-claiming concurrency (`FOR UPDATE SKIP LOCKED`),
/// its own expiry sweep and its own availability rules — and would be the one
/// that eventually double-books a unit.
export async function holdForLead(actor: Actor, leadId: string, unitTypeId: string): Promise<HoldResult> {
  const lead = await prisma.lead.findUniqueOrThrow({
    where: { id: leadId },
    select: {
      id: true,
      facilityId: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      source: true,
      targetMoveInDate: true,
    },
  })
  if (!lead.facilityId) return { ok: false, problem: 'This inquiry is not attached to a facility.' }

  assertFacilityAccess(actor, lead.facilityId)
  if (!can(actor, 'tenants:edit', lead.facilityId)) {
    throw new ForbiddenError('Missing permission to hold a unit', 'tenants:edit', lead.facilityId)
  }

  const facility = await prisma.facility.findUniqueOrThrow({
    where: { id: lead.facilityId },
    select: { slug: true },
  })
  const inventory = await publicInventoryForFacility(facility.slug)
  const unitType = inventory?.unitTypes.find((row) => row.unitTypeId === unitTypeId)
  if (!unitType) return { ok: false, problem: 'That size is not on sale at this facility.' }

  const result = await createReservation({
    facilityId: lead.facilityId,
    unitTypeId,
    firstName: lead.firstName ?? 'Guest',
    lastName: lead.lastName ?? 'Caller',
    // The reservation service requires an email — it sends a hold confirmation
    // and a 24h expiry reminder. A caller who did not give one gets a hold with
    // a placeholder that cannot receive mail, which is honest: the hold is real,
    // the reminder is not, and the follow-up task is what covers it.
    email: lead.email ?? `lead-${lead.id}@no-email.invalid`,
    phone: lead.phone,
    moveInDate: lead.targetMoveInDate ?? new Date(),
    quotedRateCents: unitType.webRateCents,
    // US-43's own words. This is the column the moves report splits on.
    source: lead.source ?? 'phone',
  })

  if (!result.ok) {
    return {
      ok: false,
      problem:
        result.reason === 'sold_out'
          ? 'Somebody took the last one of that size. Try another size.'
          : `That move-in date is too far out — the furthest we hold is ${result.maxDays} days.`,
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.reservation.update({ where: { id: result.reservationId }, data: { leadId: lead.id } })
    // Holding a unit for somebody IS contact, and it is a disposition. Leaving
    // the lead in `new` would keep raising a follow-up task for a caller who
    // has already been served.
    await tx.lead.update({
      where: { id: lead.id },
      data: { status: 'reserved', contactedAt: new Date(), unitTypeId },
    })
  })

  return { ok: true, reservationId: result.reservationId, expiresAt: result.expiresAt }
}

export type LeadRow = {
  id: string
  facilityId: string | null
  facilityName: string | null
  name: string
  phone: string | null
  email: string | null
  source: string
  sourceLabel: string
  status: string
  unitTypeName: string | null
  targetMoveInDate: Date | null
  message: string | null
  createdAt: Date
  contactedAt: Date | null
  takenByName: string | null
  /// Uncontacted past the facility's window. US-43: "a lead with no disposition
  /// is visible, never silently ageing in `new`."
  overdue: boolean
  /// B-068. The derived marketing channel for a web lead — `paid_search`,
  /// `organic`, `aggregator`. Null for a counter lead, where `source` already
  /// says everything.
  channel: string | null
  /// PRD 04 FR-LEAD-1. How many times this person has asked. One means once;
  /// more means the dedup rule folded repeats into this row rather than
  /// creating a second lead for somebody to call in parallel.
  askedTimes: number
}

export async function facilityLeads(
  actor: Actor,
  facilityId: string,
  options: { includeClosed?: boolean } = {},
): Promise<LeadRow[]> {
  assertFacilityAccess(actor, facilityId)
  if (!can(actor, 'tenants:view', facilityId)) {
    throw new ForbiddenError('Missing permission to read leads', 'tenants:view', facilityId)
  }

  const facility = await prisma.facility.findUniqueOrThrow({
    where: { id: facilityId },
    select: { name: true, leadFollowUpHours: true },
  })

  const leads = await prisma.lead.findMany({
    where: {
      facilityId,
      status: options.includeClosed ? undefined : { in: ['new', 'contacted'] },
    },
    orderBy: [{ contactedAt: { sort: 'asc', nulls: 'first' } }, { createdAt: 'asc' }],
    take: 200,
    include: {
      unitType: { select: { name: true } },
      createdByStaff: { select: { firstName: true, lastName: true } },
      _count: { select: { activities: true } },
    },
  })

  const cutoff = Date.now() - facility.leadFollowUpHours * 3_600_000

  return leads.map((lead) => ({
    id: lead.id,
    facilityId: lead.facilityId,
    facilityName: facility.name,
    name: [lead.firstName, lead.lastName].filter(Boolean).join(' ') || 'Unnamed',
    phone: lead.phone,
    email: lead.email,
    source: lead.source ?? 'unknown',
    sourceLabel:
      LEAD_SOURCE_LABELS[(lead.source ?? '') as keyof typeof LEAD_SOURCE_LABELS] ??
      (lead.source === 'web' ? 'Website' : 'Unknown'),
    status: lead.status,
    unitTypeName: lead.unitType?.name ?? null,
    targetMoveInDate: lead.targetMoveInDate,
    message: lead.message,
    createdAt: lead.createdAt,
    contactedAt: lead.contactedAt,
    takenByName: lead.createdByStaff
      ? `${lead.createdByStaff.firstName} ${lead.createdByStaff.lastName}`
      : null,
    overdue: lead.contactedAt === null && lead.createdAt.getTime() < cutoff,
    channel: lead.channel,
    // The lead itself is the first ask; each activity row is a repeat.
    askedTimes: lead._count.activities + 1,
  }))
}

/// The disposition US-43 insists every lead eventually gets.
export async function setLeadStatus(
  actor: Actor,
  leadId: string,
  status: 'contacted' | 'lost' | 'new',
): Promise<void> {
  const lead = await prisma.lead.findUniqueOrThrow({
    where: { id: leadId },
    select: { facilityId: true, contactedAt: true },
  })
  if (!lead.facilityId) throw new ForbiddenError('Lead has no facility')
  assertFacilityAccess(actor, lead.facilityId)
  if (!can(actor, 'tenants:edit', lead.facilityId)) {
    throw new ForbiddenError('Missing permission to update a lead', 'tenants:edit', lead.facilityId)
  }

  await prisma.lead.update({
    where: { id: leadId },
    data: {
      status,
      // Stamped once and never moved. `contactedAt` is what the follow-up
      // window measures against, so re-stamping it on every status change
      // would let a lead be nudged out of overdue without anyone calling.
      contactedAt: status === 'new' ? null : (lead.contactedAt ?? new Date()),
    },
  })
}
