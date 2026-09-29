import { prisma } from '@storage/db'
import { effectiveByGroup } from '@storage/core/facility-settings'
import { NOTICE_TYPES } from '@storage/core/notices'
import { normalizeJurisdiction, sameJurisdiction } from '@storage/core/org'

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
//
// B-413 adds the one exception, and it is not a chosen value either: a ladder
// or a timeline written for another state. Nobody chose Texas notice days for
// a site in Oklahoma; the site was handed them, or it moved. It is named as
// the same gap, "No delinquency timeline for OK", with a consequence that says
// what is running in its place.

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
      select: { latitude: true, longitude: true, state: true },
    }),
    prisma.taxComponent.count({ where: effective }),
    prisma.feeSchedule.count({ where: effective }),
    // The rows, not a count: which steps are in force is decided per step, and
    // one step written for the right state does not make the ladder so.
    prisma.lateFeeRule.findMany({
      where: effective,
      orderBy: { effectiveFrom: 'desc' },
      select: { step: true, jurisdiction: true, effectiveFrom: true },
    }),
    prisma.delinquencyTimeline.findMany({
      where: { facilityId, active: true },
      select: { jurisdiction: true },
    }),
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
  const state = normalizeJurisdiction(facility.state) ?? facility.state
  const stepsInForce = [...effectiveByGroup(ladder, now, (row) => String(row.step)).values()]
  const foreignSteps = stepsInForce.filter((row) => !sameJurisdiction(row.jurisdiction, facility.state))
  const foreignTimelines = timelines.filter((row) => !sameJurisdiction(row.jurisdiction, facility.state))
  const states = (rows: { jurisdiction: string }[]) =>
    [...new Set(rows.map((row) => row.jurisdiction))].sort().join(' and ')

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
  if (stepsInForce.length === 0) {
    gaps.push({
      kind: 'late_fee_ladder',
      what: `No late-fee ladder for ${state}`,
      consequence: 'No late fee is ever charged, however far past due a tenant runs.',
      href: '/admin/settings#latefee-heading',
    })
  } else if (foreignSteps.length > 0) {
    gaps.push({
      kind: 'late_fee_ladder',
      what: `No late-fee ladder for ${state}`,
      consequence: `The ladder in force was written for ${states(foreignSteps)} (step ${foreignSteps
        .map((row) => row.step)
        .sort((a, b) => a - b)
        .join(', ')}), so late fees are being charged on another state's days and caps. Add each step again for ${state}.`,
      href: '/admin/settings#latefee-heading',
    })
  }
  if (timelines.length === 0) {
    gaps.push({
      kind: 'delinquency_timeline',
      what: `No delinquency timeline for ${state}`,
      consequence:
        'No dunning step runs, nothing is overlocked, and every lien sale at this site is blocked outright.',
      href: '/admin/settings/delinquency',
    })
  } else if (foreignTimelines.length > 0) {
    gaps.push({
      kind: 'delinquency_timeline',
      what: `No delinquency timeline for ${state}`,
      consequence: `The timeline in force was written for ${states(foreignTimelines)}, so notices go out on another state's days, and every lien sale that ran on it is blocked outright. Save a timeline for ${state}.`,
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
