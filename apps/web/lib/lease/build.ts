import { prisma } from '@storage/db'
import { formatRate } from '@/lib/format'
import { storeGeneratedDocument } from '@/lib/documents/store'
import { renderTemplate } from '@/lib/documents/render'
import { currentPlans } from '@/lib/protection/plans'
import { billingDayFor } from '@storage/core/billing'
import { businessDateFor } from '@storage/core/jobs'
import { LEASE_SUMMARY_TEMPLATE, LEASE_TEMPLATE } from './template'
import type { CheckoutSessionView } from '@/lib/checkout/session'

// PRD 01 US-501 step 4. Merging a checkout session into a lease.

/// Gathers every merge value from the session and the facility.
///
/// Every field is filled here or the render throws (B-023's FR-6 rule), so a
/// missing rate or an unnamed facility fails before anything is signed rather
/// than producing a lease with a hole in it.
export async function leaseValuesFor(session: CheckoutSessionView): Promise<Record<string, string>> {
  const facility = await prisma.facility.findUniqueOrThrow({
    where: { id: session.facilityId },
    select: {
      name: true,
      addressLine1: true,
      addressLine2: true,
      city: true,
      state: true,
      postalCode: true,
      gateHours: true,
      timezone: true,
      billingPolicy: true,
      prorateOnMoveIn: true,
    },
  })
  const unitType = await prisma.unitType.findUniqueOrThrow({
    where: { id: session.unitTypeId },
    select: { widthFt: true, lengthFt: true },
  })
  const unit = session.unitId
    ? await prisma.unit.findUnique({ where: { id: session.unitId }, select: { number: true } })
    : null

  const data = session.data as Record<string, string | number | undefined>
  const lateFee = await prisma.feeSchedule.findFirst({
    where: { facilityId: session.facilityId, feeType: 'late' },
    orderBy: { effectiveFrom: 'desc' },
  })

  const protectionTier = typeof data.protection === 'string' ? data.protection : 'waiver'
  const premiumCents = typeof data.protectionPremiumCents === 'number' ? data.protectionPremiumCents : 0
  const plans = await currentPlans(session.facilityId)
  const plan = plans.find((option) => option.tier === protectionTier)

  const protectionSummary = plan
    ? `You have chosen our ${plan.name} protection plan at ${formatRate(plan.premiumCents)} per month, which is added to your rent. This is a protection plan we provide, not an insurance policy.`
    : 'You told us you have your own insurance covering these belongings. You must keep that cover in place for as long as you rent, and tell us if it ends.'

  // The day the tenant is moving in, as a calendar date — the same value the
  // lease will carry as `startDate` and the anchor for the billing day.
  //
  // B-106: the renter's chosen date when there is one, and this MATTERS more
  // here than anywhere else it is read. This document is signed. A lease that
  // hardcoded today would state a start date and a first-payment period the
  // tenant is not agreeing to, on the one artefact whose whole purpose is to
  // record what they agreed to.
  const moveInDate = session.requestedStartDate ?? new Date()
  // The facility-local calendar day the anniversary anchors to. A chosen date
  // is ALREADY such a day (UTC-midnight), so it is not converted again — the
  // same double-conversion that put a Chicago lease on the 19th when the
  // renter picked the 20th. See checkout/provision.ts.
  const localToday = session.requestedStartDate ?? businessDateFor(moveInDate, facility.timezone)

  // B-044. What the first payment actually bought, per the facility's billing
  // policy. Under `anniversary` the period starts today and the tenant pays a
  // full one; the old fixed sentence promised proration and would have been a
  // term the operator had signed up to and does not do.
  const firstPaymentSummary =
    facility.billingPolicy === 'anniversary'
      ? `Your first payment covers a full month from ${new Intl.DateTimeFormat('en-US', {
          dateStyle: 'long',
          // UTC when the renter chose the date, because a chosen date is a
          // CALENDAR day already stored at UTC-midnight — rendering it in a
          // western timezone would print the day before, in a signed document.
          // A same-day move-in is a real instant and is rendered locally.
          timeZone: session.requestedStartDate ? 'UTC' : facility.timezone,
        }).format(moveInDate)}, and every payment after it falls on the same day of the month.`
      : facility.prorateOnMoveIn
        ? 'Your first payment covers the days between your move-in and the first of next month, charged pro rata; after that you pay a full month on the 1st.'
        : 'Your first payment covers a full month; after that you pay on the 1st of each month.'

  const tenantName = `${data.firstName ?? ''} ${data.lastName ?? ''}`.trim()
  const tenantAddress = [data.addressLine1, data.addressLine2, data.city, data.state, data.postalCode]
    .filter((part) => typeof part === 'string' && part.trim() !== '')
    .join(', ')

  return {
    tenantName,
    tenantAddress,
    facilityName: facility.name,
    facilityAddress: [
      facility.addressLine1,
      facility.addressLine2,
      facility.city,
      `${facility.state} ${facility.postalCode}`,
    ]
      .filter(Boolean)
      .join(', '),
    unitNumber: unit?.number ?? 'to be assigned',
    unitSize: `${unitType.widthFt} feet by ${unitType.lengthFt} feet`,
    monthlyRate: `${formatRate(session.quotedRateCents + premiumCents)}`,
    protectionSummary,
    moveInDate: new Intl.DateTimeFormat('en-US', {
      dateStyle: 'long',
      timeZone: facility.timezone,
    }).format(moveInDate),
    billingDay: String(billingDayFor(facility.billingPolicy, localToday)),
    firstPaymentSummary,
    lateFeeSummary: lateFee
      ? `If your rent is not paid on time we charge a late fee of ${formatRate(lateFee.amountCents)}.`
      : 'If your rent is not paid on time we may charge a late fee.',
    gateHoursSummary: 'You can reach your unit during the gate hours published for this facility.',
  }
}

/// Renders the summary and the full lease, and stores the lease as a document.
/// The stored document is what gets signed, so it is created before the
/// signature exists rather than assembled afterwards.
export async function buildLeaseDocument(session: CheckoutSessionView) {
  const values = await leaseValuesFor(session)
  const summaryHtml = renderTemplate(LEASE_SUMMARY_TEMPLATE, values)

  const { id, rendered } = await storeGeneratedDocument({
    facilityId: session.facilityId,
    type: 'lease',
    subjectType: 'CheckoutSession',
    subjectId: session.id,
    title: `Storage rental agreement — ${values.facilityName}, unit ${values.unitNumber}`,
    template: LEASE_TEMPLATE,
    values,
  })

  // `bodyHtml` for the on-page render; the stored `html` stays the complete,
  // hashed, signed document.
  return { documentId: id, html: rendered.bodyHtml, summaryHtml, values }
}

/// The lease already built for this session, if any. Re-rendering on every page
/// view would change the hash under a signer mid-step.
export async function existingLeaseDocument(sessionId: string) {
  return prisma.document.findFirst({
    where: { subjectType: 'CheckoutSession', subjectId: sessionId, type: 'lease', deletedAt: null },
    include: { signature: true },
    orderBy: { createdAt: 'desc' },
  })
}
