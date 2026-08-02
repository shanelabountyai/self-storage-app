import { prisma } from '@storage/db'
import { formatRate } from '@/lib/format'
import { storeGeneratedDocument } from '@/lib/documents/store'
import { renderTemplate } from '@/lib/documents/render'
import { currentPlans } from '@/lib/protection/plans'
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
    }).format(new Date()),
    billingDay: '1',
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
