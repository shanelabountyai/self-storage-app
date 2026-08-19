import { prisma } from '@storage/db'
import { recordAudit } from '@storage/core/audit'
import {
  periodFor,
  renderReportEmail,
  sendIdempotencyKey,
  sendsOn,
  type EmailDocument,
  type EmailSection,
  type ReportCadence,
  type ReportPeriod,
} from '@storage/core/comms'
import { localParts } from '@storage/core/jobs'
import { requirePermission, assertFacilityAccess } from '@/lib/rbac/authorize'
import { toAuditActor } from '@/lib/rbac/audit-actor'
import type { Actor } from '@/lib/rbac/actor'
import {
  agingForFacility,
  movesForFacility,
  occupancyForFacility,
  unitOccupancyNote,
} from '@/lib/admin/reports'
import { billedTotal, collectedTotal, facilityRevenue } from '@/lib/admin/revenue-report'
import { periodLabel } from '@/lib/admin/accounting-close'
import { buildManagementPack } from '@/lib/admin/management-pack'
import { formatCents } from '@/lib/format'
import { sendDirectEmail } from '@/lib/comms/service'
import { siteOrigin } from '@/lib/marketing/origin'
import { SITE } from '@/lib/site-config'

// PRD 02 US-40 (B-084 part 3). Reports that arrive without anybody asking.
//
// Every figure comes from the same report functions the screens use — the same
// rule part 1 followed, and for the same reason: a report emailed to an owner
// that disagrees with the dashboard it links to is worse than no email.

export const REPORT_CATALOG = [
  {
    key: 'occupancy',
    label: 'Occupancy',
    blurb: 'Unit and economic occupancy, and what changed.',
    path: '/admin/reports',
  },
  {
    key: 'revenue',
    label: 'Revenue',
    blurb: 'Billed against collected, with discounts and write-offs.',
    path: '/admin/reports/revenue',
  },
  {
    key: 'delinquency',
    label: 'Money owed',
    blurb: 'The aging buckets, oldest-invoice anchored.',
    path: '/admin/reports/delinquency',
  },
  {
    key: 'moves',
    label: 'Move-ins and move-outs',
    blurb: 'Counts and the net for the period.',
    path: '/admin/reports',
  },
  {
    // B-084 part 4. Monthly only — see `MONTHLY_ONLY` below.
    key: 'pack',
    label: 'Management pack',
    blurb: 'The whole month on one page: how full, what it earned, what it gave away, what was owed.',
    path: '/admin/reports/pack',
  },
] as const

/// Reports that only make sense for a whole calendar month.
///
/// The management pack reads a CLOSED month's filed figures, and a period is
/// closed per calendar month — a weekly pack would have nothing filed to read
/// and would silently fall back to live numbers, which is the exact confusion
/// the close exists to remove.
const MONTHLY_ONLY: readonly string[] = ['pack']

export type ReportKey = (typeof REPORT_CATALOG)[number]['key']

export function isReportKey(value: string): value is ReportKey {
  return REPORT_CATALOG.some((report) => report.key === value)
}

function reportMeta(key: string) {
  return REPORT_CATALOG.find((report) => report.key === key) ?? REPORT_CATALOG[0]
}

// ------------------------------------------------------- the documents ----

function percent(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`
}

/// Builds the sections for one report over one period, for one facility.
///
/// Returns null when the report has nothing to say about this facility, so a
/// subscription for a site with no data sends nothing rather than an empty
/// table — an email that arrives every morning saying nothing is one that
/// trains its reader to delete it unopened.
async function sectionsFor(
  facilityId: string,
  facilityName: string,
  key: string,
  period: ReportPeriod,
): Promise<EmailSection[] | null> {
  if (key === 'occupancy') {
    const row = await occupancyForFacility(facilityId, facilityName, period.start, period.end)
    if (!row) return null
    return [
      {
        heading: 'Occupancy',
        // B-131. The same sentence the screen prints, from the same function.
        // An email is read away from the report it came from, so the figure has
        // to carry its own instant — and it must not be a second wording of the
        // caveat, or a reader who checks one against the other trusts neither.
        paragraphs: [unitOccupancyNote(row.unitOccupancy, period.label)],
        table: {
          caption: `Occupancy for ${period.label}`,
          columns: ['Measure', 'Value'],
          rows: [
            ['Unit occupancy', percent(row.occupancy.ratio)],
            ['Occupied of rentable', `${row.occupancy.occupiedCount} of ${row.occupancy.rentableCount}`],
            ['Square-foot occupancy', percent(row.occupancy.squareFootRatio)],
            ['Economic occupancy', percent(row.economic.ratio)],
            ['Gross potential', formatCents(row.economic.grossPotentialCents)],
          ],
        },
      },
    ]
  }

  if (key === 'revenue') {
    const row = await facilityRevenue(facilityId, facilityName, period.start, period.end)
    if (!row) return null
    return [
      {
        heading: 'Revenue',
        table: {
          caption: `Billed and collected in ${period.label}`,
          columns: ['Measure', 'Amount'],
          rows: [
            ['Billed', formatCents(billedTotal(row))],
            ['Collected', formatCents(collectedTotal(row))],
            ['Discounts given', formatCents(row.discountsCents)],
            ['Referral rewards', formatCents(row.referralRewardsCents)],
            ['Written off', formatCents(row.writeOffsCents)],
            ['Unapplied', formatCents(row.unappliedCents)],
          ],
        },
        // Stated rather than left to be inferred from a figure that looks like
        // it should be subtracted. The revenue report carries the same note.
        paragraphs: [
          `Refunded in the period: ${formatCents(row.refundsCents)}. This is already deducted from collected — adding it again would count it twice.`,
        ],
      },
    ]
  }

  if (key === 'delinquency') {
    const row = await agingForFacility(facilityId, facilityName)
    const aging = row.aging
    return [
      {
        heading: 'Money owed',
        // Point-in-time, and it says so: this figure is as of the moment the
        // email was built, not as of the end of the period above it (D-65).
        paragraphs: ['As of this morning, not as of the end of the period covered above.'],
        table: {
          caption: 'Outstanding balances by age',
          columns: ['Age', 'Amount'],
          rows: [
            ['Not yet 11 days', formatCents(aging.d0to10)],
            ['11 to 30 days', formatCents(aging.d11to30)],
            ['31 to 60 days', formatCents(aging.d31to60)],
            ['61 to 90 days', formatCents(aging.d61to90)],
            // The word, not a colour — FR-9a, and the one bucket somebody has
            // to act on.
            ['Over 90 days — needs attention', formatCents(aging.over90)],
            ['Total owed', formatCents(aging.totalCents)],
          ],
        },
      },
    ]
  }

  if (key === 'pack') {
    // Built by the pack module, which reads the FILED figures when the month is
    // closed — so the emailed pack and the pack on screen are the same document
    // rather than two renderings that can drift apart.
    const [year, month] = period.key.split('-').map(Number)
    const pack = await buildManagementPack(facilityId, year, month)
    return pack.document.sections
  }

  const row = await movesForFacility(facilityId, facilityName, period.start, period.end)
  return [
    {
      heading: 'Move-ins and move-outs',
      table: {
        caption: `Moves in ${period.label}`,
        columns: ['Measure', 'Count'],
        rows: [
          ['Move-ins', String(row.moves.moveIns)],
          ['Move-outs', String(row.moves.moveOuts)],
          ['Net', String(row.moves.net)],
        ],
      },
    },
  ]
}

/// Whether the month this report covers has been filed (part 1), so the email
/// can say whether its figures can still change.
///
/// This is the link that makes the close pay for itself: a monthly report
/// showing numbers that quietly differ from the filed ones is exactly the
/// confusion the close exists to remove.
async function closedNote(
  facilityId: string,
  cadence: ReportCadence,
  period: ReportPeriod,
): Promise<string> {
  if (cadence !== 'monthly') {
    return 'These figures are read live and can still change.'
  }
  const [year, month] = period.key.split('-').map(Number)
  const closed = await prisma.accountingPeriod.findUnique({
    where: { facilityId_year_month: { facilityId, year, month } },
    select: { closedAt: true },
  })
  return closed?.closedAt
    ? `${periodLabel(year, month)} is closed, so these figures are filed and will not change unless somebody reopens the month.`
    : `${periodLabel(year, month)} has not been closed yet, so these figures are read live and can still change. Close the month to fix them.`
}

export type BuiltReport = { subject: string; html: string; text: string } | null

/// The whole email for one subscription and one period.
export async function buildReportEmail(
  subscription: { id: string; facilityId: string; reportKey: string; cadence: ReportCadence },
  facilityName: string,
  period: ReportPeriod,
): Promise<BuiltReport> {
  const sections = await sectionsFor(
    subscription.facilityId,
    facilityName,
    subscription.reportKey,
    period,
  )
  if (!sections) return null

  const meta = reportMeta(subscription.reportKey)
  const document: EmailDocument = {
    title: `${meta.label} — ${facilityName}, ${period.label}`,
    intro: `${meta.blurb} ${await closedNote(subscription.facilityId, subscription.cadence, period)}`,
    sections,
    links: [
      // Names its destination, per FR-9a — never "click here".
      { label: `Open the ${meta.label.toLowerCase()} report`, url: `${siteOrigin()}${meta.path}` },
      { label: 'Change who gets this email', url: `${siteOrigin()}/admin/reports/subscriptions` },
    ],
    footer: `You are getting this because ${facilityName} has a scheduled ${subscription.cadence} ${meta.label.toLowerCase()} report. The link above turns it off.`,
  }
  return renderReportEmail(document)
}

// ------------------------------------------------------------- sending ----

export type SendSummary = { sent: number; skipped: number }

/// Sends every subscription for one facility that is due on this local date.
///
/// Called from the scheduled job, which already runs once per facility per
/// business date. Within that, a weekly or monthly subscription decides for
/// itself whether today is its day — and `sendDirectEmail`'s idempotency key
/// carries the period, so a re-run or a retry cannot send twice.
export async function sendDueReports(
  facility: { id: string; name: string; timezone: string },
  now: Date,
): Promise<SendSummary> {
  const local = localParts(now, facility.timezone)
  const subscriptions = await prisma.reportSubscription.findMany({
    where: { facilityId: facility.id, active: true },
  })

  let sent = 0
  let skipped = 0
  for (const subscription of subscriptions) {
    if (!sendsOn(subscription.cadence, { year: local.year, month: local.month, day: local.day })) {
      skipped += 1
      continue
    }
    const period = periodFor(
      subscription.cadence,
      { year: local.year, month: local.month, day: local.day },
      facility.timezone,
    )
    const built = await buildReportEmail(subscription, facility.name, period)
    if (!built) {
      skipped += 1
      continue
    }

    for (const [index, recipient] of subscription.recipients.entries()) {
      const result = await sendDirectEmail({
        // One key per recipient as well as per period: two addresses on one
        // subscription are two messages, and a shared key would send to the
        // first and silently swallow the second.
        idempotencyKey: `${sendIdempotencyKey(subscription.id, period)}:${index}`,
        eventId: `report:${subscription.reportKey}`,
        templateKey: `report_${subscription.reportKey}`,
        // Operational, not marketing: this is a staff report about a business,
        // not a message to a tenant, so it carries no consent question — but a
        // hard-bounced address is still suppressed like any other.
        classification: 'operational',
        to: recipient,
        fromName: SITE.name,
        subject: built.subject,
        html: built.html,
        text: built.text,
        facilityId: facility.id,
      })
      if (result.sent) sent += 1
      else skipped += 1
    }
  }

  return { sent, skipped }
}

// ------------------------------------------------------------ managing ----

export type SubscriptionRow = {
  id: string
  reportKey: string
  reportLabel: string
  cadence: ReportCadence
  recipients: string[]
  active: boolean
}

export async function subscriptionsFor(
  actor: Actor,
  facilityId: string,
): Promise<SubscriptionRow[]> {
  requirePermission(actor, 'reports:financial', facilityId)
  assertFacilityAccess(actor, facilityId)

  const rows = await prisma.reportSubscription.findMany({
    where: { facilityId },
    orderBy: [{ reportKey: 'asc' }, { cadence: 'asc' }],
  })
  return rows.map((row) => ({
    id: row.id,
    reportKey: row.reportKey,
    reportLabel: reportMeta(row.reportKey).label,
    cadence: row.cadence,
    recipients: row.recipients,
    active: row.active,
  }))
}

export type SubscriptionResult = { ok: true } | { ok: false; field: string; problem: string }

/// Splits and checks a recipient list.
///
/// Refuses rather than dropping a bad address: silently ignoring one is how a
/// report goes to three people when somebody meant four, and nobody finds out
/// until a month-end question goes unanswered.
export function parseRecipients(raw: string): { ok: true; addresses: string[] } | { ok: false; problem: string } {
  const addresses = raw
    .split(/[,\n;]/)
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)

  if (addresses.length === 0) {
    return { ok: false, problem: 'Give at least one email address, or the report has nowhere to go.' }
  }
  const bad = addresses.filter((address) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address))
  if (bad.length > 0) {
    return {
      ok: false,
      problem: `${bad.join(', ')} ${bad.length === 1 ? 'is not an email address' : 'are not email addresses'}. Separate several with commas.`,
    }
  }
  return { ok: true, addresses: [...new Set(addresses)] }
}

export async function addSubscription(
  actor: Actor,
  facilityId: string,
  input: { reportKey: string; cadence: string; recipients: string },
): Promise<SubscriptionResult> {
  requirePermission(actor, 'reports:financial', facilityId)
  assertFacilityAccess(actor, facilityId)

  if (!isReportKey(input.reportKey)) {
    return { ok: false, field: 'reportKey', problem: 'Pick a report from the list.' }
  }
  if (!['daily', 'weekly', 'monthly'].includes(input.cadence)) {
    return { ok: false, field: 'cadence', problem: 'Pick how often it should go out.' }
  }
  if (MONTHLY_ONLY.includes(input.reportKey) && input.cadence !== 'monthly') {
    return {
      ok: false,
      field: 'cadence',
      problem:
        'The management pack reads a closed month, and a month is closed per calendar month — so it can only go out monthly. A weekly one would have nothing filed to read and would quietly send live figures instead.',
    }
  }
  const recipients = parseRecipients(input.recipients)
  if (!recipients.ok) return { ok: false, field: 'recipients', problem: recipients.problem }

  await prisma.$transaction(async (tx) => {
    const created = await tx.reportSubscription.create({
      data: {
        facilityId,
        reportKey: input.reportKey,
        cadence: input.cadence as ReportCadence,
        recipients: recipients.addresses,
      },
    })
    await recordAudit(
      {
        actor: toAuditActor(actor),
        facilityId,
        action: 'facility.settings_changed',
        entityType: 'ReportSubscription',
        entityId: created.id,
        after: {
          reportKey: input.reportKey,
          cadence: input.cadence,
          recipients: recipients.addresses,
        },
      },
      tx,
    )
  })

  return { ok: true }
}

export async function removeSubscription(actor: Actor, subscriptionId: string): Promise<void> {
  const subscription = await prisma.reportSubscription.findUniqueOrThrow({
    where: { id: subscriptionId },
    select: { facilityId: true, reportKey: true, recipients: true },
  })
  requirePermission(actor, 'reports:financial', subscription.facilityId)
  assertFacilityAccess(actor, subscription.facilityId)

  await prisma.$transaction(async (tx) => {
    await tx.reportSubscription.delete({ where: { id: subscriptionId } })
    await recordAudit(
      {
        actor: toAuditActor(actor),
        facilityId: subscription.facilityId,
        action: 'facility.settings_changed',
        entityType: 'ReportSubscription',
        entityId: subscriptionId,
        before: { reportKey: subscription.reportKey, recipients: subscription.recipients },
      },
      tx,
    )
  })
}
