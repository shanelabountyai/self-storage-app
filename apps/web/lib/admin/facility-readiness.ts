import { prisma } from '@storage/db'
import { NOTICE_TYPES } from '@storage/core/notices'

// B-237. What is still missing before a facility can actually operate.
//
// The silent half of "no way to create a facility" is the dangerous one: a
// facility with no fee schedule, no ladder and no timeline invoices rent
// perfectly and does nothing else. It charges no late fee however far past due
// a tenant runs, runs no dunning step, and `auctionReadiness` blocks every sale
// with `no_timeline` — none of which raises an error anywhere, so the site
// looks healthy on the dashboard for a month.
//
// Every gap here is a table that is EMPTY, never one whose value someone chose.
// A zero-dollar late fee is a real operator decision and is not a gap; no
// ladder at all is a table nobody has filled in. That distinction is the whole
// reason this is a query rather than a comparison against a default.

export type ReadinessGap = {
  kind: string
  /// What is missing, named the way the settings screen names it.
  what: string
  /// What silently does not happen while it is missing. This is the load-
  /// bearing half — the reader already knows the table is empty.
  consequence: string
  /// Where to go and fix it. 1.4.1: the banner is text and links, not a colour.
  href: string
}

/// Ordered cheapest-to-fix first, which is also roughly billing → compliance.
export async function facilityReadiness(facilityId: string): Promise<ReadinessGap[]> {
  const now = new Date()
  const effective = { facilityId, effectiveFrom: { lte: now } }

  const [facility, taxes, fees, ladder, timelines, noticeTemplates] = await Promise.all([
    prisma.facility.findUniqueOrThrow({
      where: { id: facilityId },
      select: { latitude: true, longitude: true },
    }),
    prisma.taxComponent.count({ where: effective }),
    prisma.feeSchedule.count({ where: effective }),
    prisma.lateFeeRule.count({ where: effective }),
    prisma.delinquencyTimeline.count({ where: { facilityId, active: true } }),
    // Same precedence `effectiveNoticeTemplate` applies at generate time — an
    // org-level template resolves here, so a facility inherits it and this is
    // not a gap. Only a type nothing resolves for is.
    prisma.noticeTemplate.findMany({
      where: { type: { in: [...NOTICE_TYPES] }, active: true, OR: [{ facilityId }, { facilityId: null }] },
      select: { type: true },
      distinct: ['type'],
    }),
  ])

  const gaps: ReadinessGap[] = []

  if (taxes === 0) {
    gaps.push({
      kind: 'tax',
      what: 'No tax rate',
      consequence: 'Every invoice bills rent with no tax on it, and the difference is not recoverable later.',
      href: '/admin/settings#tax-heading',
    })
  }
  if (fees === 0) {
    gaps.push({
      kind: 'fee_schedule',
      what: 'No fee schedule',
      consequence:
        'The admin, returned-payment, lien and lock-cut fees all charge nothing, wherever the product raises them.',
      href: '/admin/settings#fees-heading',
    })
  }
  if (ladder === 0) {
    gaps.push({
      kind: 'late_fee_ladder',
      what: 'No late-fee ladder',
      consequence: 'No late fee is ever charged, however far past due a tenant runs.',
      href: '/admin/settings#latefee-heading',
    })
  }
  if (timelines === 0) {
    gaps.push({
      kind: 'delinquency_timeline',
      what: 'No delinquency timeline',
      consequence:
        'No dunning step runs, nothing is overlocked, and every lien sale at this site is blocked outright.',
      href: '/admin/settings/delinquency',
    })
  }
  const missingTypes = NOTICE_TYPES.filter(
    (type) => !noticeTemplates.some((row) => row.type === type),
  )
  if (missingTypes.length > 0) {
    gaps.push({
      kind: 'notice_templates',
      what: missingTypes.length === NOTICE_TYPES.length ? 'No notice templates' : 'A notice template is missing',
      consequence: `A ${missingTypes.map((type) => type.replace('_', '-')).join(' and ')} notice cannot be generated at all, so the lien pipeline stops before it starts.`,
      href: '/admin/settings/notices',
    })
  }
  if (facility.latitude === null || facility.longitude === null) {
    gaps.push({
      kind: 'geo',
      what: 'No map position',
      consequence:
        'The site is left out of the search renters use: a facility with no coordinates is skipped, so nobody nearby can find it.',
      href: '/admin/settings#details-heading',
    })
  }

  return gaps
}
