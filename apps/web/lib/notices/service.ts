import { prisma, type NoticeType, type Prisma } from '@storage/db'
import { recordAudit } from '@storage/core/audit'
import { currentConsent } from '@storage/core/consent'
import {
  ledgerTotals,
  runningBalance,
  type LedgerEntryKind,
  type LedgerRow,
} from '@storage/core/billing'
import {
  canDeliver,
  claimForNotice,
  EXAMPLE_SALE_STATEMENTS,
  type ClaimProblem,
  type LienClaim,
  type LienNoticeType,
  type NoticeDeliveryMethod,
} from '@storage/core/notices'
import { assertFacilityAccess, can, ForbiddenError, requirePermission } from '@/lib/rbac/authorize'
import { toAuditActor } from '@/lib/rbac/audit-actor'
import type { Actor } from '@/lib/rbac/actor'
import { storeGeneratedDocument } from '@/lib/documents/store'
import { renderDocument } from '@/lib/documents/render'
import { formatCents } from '@/lib/format'

// PRD 02 §4.6 US-27 / §4.2 US-13 (B-061). Generating and serving lien notices.
//
// The three things this file exists to guarantee, all of them the kind of
// mistake that only surfaces in a dispute:
//
//   1. The claim on the notice reconciles to the ledger AT GENERATION TIME, or
//      no notice is generated. Not a warning — a refusal (US-27's AC).
//   2. The address it actually rendered, and the document's hash, are stored on
//      the notice row (US-13's AC), so "what did you send and where" is
//      answered from the record rather than reconstructed.
//   3. A correction is a NEW document with a NEW date. Nothing generated is
//      ever rewritten.

/// The facility-local calendar day, as a date-only value. Notices are dated in
/// the facility's own timezone: a notice generated at 8pm in Texas is dated
/// that day, not tomorrow, and the deadline counts from the same day.
function facilityDate(at: Date, timezone: string): Date {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at)
  return new Date(`${parts}T00:00:00.000Z`)
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(date)
}

/// The itemized claim as an accessible table (PRD 02 FR-22: `scope` on header
/// cells, a caption, real headers). Built here rather than in the template so
/// an operator editing notice wording cannot accidentally produce an
/// unreadable table — and so `{{claimTable}}` is one merge field rather than a
/// loop in a template language this project deliberately does not have.
function claimTableHtml(claim: LienClaim): string {
  const rows = claim.lines
    .map(
      (line) =>
        `<tr><th scope="row">${escape(formatDate(line.accruedAt))}</th>` +
        `<td>${escape(line.description)}</td>` +
        `<td>${escape(line.invoiceNumber ?? '—')}</td>` +
        `<td>${escape(formatCents(line.amountCents))}</td></tr>`,
    )
    .join('\n')

  return [
    '<table>',
    '<caption>Itemized account activity</caption>',
    '<thead><tr>',
    '<th scope="col">Date incurred</th><th scope="col">Description</th>',
    '<th scope="col">Invoice</th><th scope="col">Amount</th>',
    '</tr></thead>',
    `<tbody>${rows}</tbody>`,
    '<tfoot><tr><th scope="row" colspan="3">Total claimed</th>' +
      `<td>${escape(formatCents(claim.totalCents))}</td></tr></tfoot>`,
    '</table>',
  ].join('\n')
}

function escape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/// The only merge field carrying application-built markup (the itemized claim
/// table). Named once and passed to both the preview and the generation, so
/// the two cannot disagree about what gets escaped.
const RAW_NOTICE_FIELDS = ['claimTable'] as const

export type NoticeProblem =
  | ClaimProblem
  | { kind: 'no_template'; message: string }
  | { kind: 'no_address'; message: string }
  | { kind: 'lease_not_found'; message: string }

export type NoticeContext = {
  leaseId: string
  facilityId: string
  tenantId: string
  tenantName: string
  unitNumber: string
  claim: LienClaim
  deadlineDate: Date
  noticeDate: Date
  address: {
    id: string
    line1: string
    line2: string | null
    city: string
    state: string
    postalCode: string
    returnedMailAt: Date | null
  }
  template: { id: string; version: number; title: string; body: string }
  values: Record<string, string>
}

export type NoticeContextResult =
  | { ok: true; context: NoticeContext }
  | { ok: false; problem: NoticeProblem }

/// Everything a notice needs, gathered and checked. Shared by the preview and
/// the real generation so what staff read on screen is what gets stored —
/// there is no second code path that could render something different.
export async function noticeContext(
  actor: Actor,
  leaseId: string,
  type: LienNoticeType,
  options: { deadlineDays?: number; now?: Date } = {},
): Promise<NoticeContextResult> {
  const lease = await prisma.lease.findUnique({
    where: { id: leaseId },
    select: {
      id: true,
      facilityId: true,
      tenantId: true,
      facility: {
        select: {
          name: true,
          addressLine1: true,
          addressLine2: true,
          city: true,
          state: true,
          postalCode: true,
          phone: true,
          email: true,
          timezone: true,
        },
      },
      unit: { select: { number: true } },
      tenant: { select: { firstName: true, lastName: true } },
    },
  })
  if (!lease) return { ok: false, problem: { kind: 'lease_not_found', message: 'No such lease.' } }

  assertFacilityAccess(actor, lease.facilityId)
  if (!can(actor, 'delinquency:execute_step', lease.facilityId)) {
    throw new ForbiddenError(
      'Missing permission to generate notices',
      'delinquency:execute_step',
      lease.facilityId,
    )
  }

  // The address of record: the newest `TenantAddress` row (D-21). Read from the
  // history rather than the `Tenant` cache columns, because the history is what
  // a dispute reads and the two must not be able to disagree here of all places.
  const address = await prisma.tenantAddress.findFirst({
    where: { tenantId: lease.tenantId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      addressLine1: true,
      addressLine2: true,
      city: true,
      state: true,
      postalCode: true,
      returnedMailAt: true,
    },
  })
  if (!address) {
    return {
      ok: false,
      problem: {
        kind: 'no_address',
        message:
          'This tenant has no address of record, so there is nowhere to serve a notice. ' +
          'Add one on the tenant profile first.',
      },
    }
  }

  const claimResult = await claimForLease(leaseId)
  if (!claimResult.ok) return claimResult

  const template = await effectiveNoticeTemplate(type, lease.facilityId)
  if (!template) {
    return {
      ok: false,
      problem: {
        kind: 'no_template',
        message:
          `No ${type.replace('_', '-')} notice template exists for this facility. ` +
          'Create one under Settings → Notice templates before generating.',
      },
    }
  }

  const now = options.now ?? new Date()
  const noticeDate = facilityDate(now, lease.facility.timezone)
  const deadlineDays = options.deadlineDays ?? DEFAULT_DEADLINE_DAYS
  const deadlineDate = new Date(noticeDate.getTime() + deadlineDays * 86_400_000)

  const facilityContact = [lease.facility.phone, lease.facility.email].filter(Boolean).join(' · ')
  const claim = claimResult.claim

  return {
    ok: true,
    context: {
      leaseId: lease.id,
      facilityId: lease.facilityId,
      tenantId: lease.tenantId,
      tenantName: `${lease.tenant.firstName} ${lease.tenant.lastName}`,
      unitNumber: lease.unit.number,
      claim,
      deadlineDate,
      noticeDate,
      address: {
        id: address.id,
        line1: address.addressLine1,
        line2: address.addressLine2,
        city: address.city,
        state: address.state,
        postalCode: address.postalCode,
        returnedMailAt: address.returnedMailAt,
      },
      template,
      values: {
        tenantName: `${lease.tenant.firstName} ${lease.tenant.lastName}`,
        tenantAddress: [
          address.addressLine1,
          address.addressLine2,
          `${address.city}, ${address.state} ${address.postalCode}`,
        ]
          .filter(Boolean)
          .join('\n'),
        facilityName: lease.facility.name,
        facilityAddress: [
          lease.facility.addressLine1,
          lease.facility.addressLine2,
          `${lease.facility.city}, ${lease.facility.state} ${lease.facility.postalCode}`,
        ]
          .filter(Boolean)
          .join('\n'),
        // Falls back to the facility's own name rather than rendering blank:
        // `renderTemplate` throws on an empty required value, and a facility
        // that has not filled in a phone number should get a notice it can
        // still serve rather than an error it cannot act on.
        facilityContact: facilityContact || lease.facility.name,
        unitNumber: lease.unit.number,
        claimTable: claimTableHtml(claim),
        claimTotal: formatCents(claim.totalCents),
        oldestAccrualDate: claim.oldestAccrualAt ? formatDate(claim.oldestAccrualAt) : formatDate(noticeDate),
        deadlineDate: formatDate(deadlineDate),
        saleStatement: EXAMPLE_SALE_STATEMENTS[type],
        noticeDate: formatDate(noticeDate),
      },
    },
  }
}

/// Days from the notice date to the deadline it states.
///
/// A constant, not a facility setting, and that is a deliberate gap rather than
/// an oversight: the real value is set by state statute, differs between the
/// pre-lien and lien stages, and putting a configurable number here would imply
/// the system knows which one is lawful. The timeline (B-056) is where an
/// operator and their attorney encode the schedule; this is the date printed on
/// the page, and staff can override it per notice.
export const DEFAULT_DEADLINE_DAYS = 14

/// The claim, with both US-27 checks applied. Exported so a screen can show
/// why a notice cannot be generated without generating one.
export async function claimForLease(leaseId: string) {
  const [entries, invoices] = await Promise.all([
    prisma.ledgerEntry.findMany({
      where: { leaseId },
      orderBy: { occurredAt: 'asc' },
      select: {
        id: true,
        type: true,
        description: true,
        occurredAt: true,
        amountCents: true,
        invoice: { select: { number: true } },
      },
    }),
    prisma.invoice.findMany({
      where: { leaseId, status: { in: ['open', 'partially_paid'] } },
      select: { totalCents: true, amountPaidCents: true },
    }),
  ])

  const rows: LedgerRow[] = entries.map((entry) => ({
    id: entry.id,
    kind: entry.type as LedgerEntryKind,
    description: entry.description,
    occurredAt: entry.occurredAt,
    amountCents: entry.amountCents,
    invoiceNumber: entry.invoice?.number ?? null,
  }))

  // Exactly the terms `leaseLedger` uses for the same reconciliation — a second
  // definition of "uninvoiced" here would let the ledger screen and the notice
  // disagree about whether this lease reconciles, which is the one thing that
  // must not happen.
  const uninvoiced = entries
    .filter((entry) => entry.invoice === null)
    .reduce((sum, entry) => sum + entry.amountCents, 0)

  return claimForNotice({
    rows,
    invoiceOutstandingCents: invoices.reduce(
      (sum, invoice) => sum + Math.max(0, invoice.totalCents - invoice.amountPaidCents),
      0,
    ),
    uninvoicedChargeCents: uninvoiced,
  })
}

/// Facility override beats org default; highest active version wins. The same
/// precedence `effectiveTemplate` applies to message templates.
export async function effectiveNoticeTemplate(type: NoticeType, facilityId: string) {
  const rows = await prisma.noticeTemplate.findMany({
    where: { type, active: true, OR: [{ facilityId }, { facilityId: null }] },
    select: { id: true, version: true, title: true, body: true, facilityId: true },
  })
  if (rows.length === 0) return null
  const scoped = rows.filter((row) => row.facilityId === facilityId)
  const pool = scoped.length > 0 ? scoped : rows
  const best = pool.reduce((winner, row) => (row.version > winner.version ? row : winner))
  return { id: best.id, version: best.version, title: best.title, body: best.body }
}

export type PreviewResult =
  | { ok: true; html: string; context: NoticeContext }
  | { ok: false; problem: NoticeProblem }

/// Renders without storing. Same context, same template, same merge values as
/// `generateNotice` — so "preview then generate" cannot produce two different
/// documents.
export async function previewNotice(
  actor: Actor,
  leaseId: string,
  type: LienNoticeType,
  options: { deadlineDays?: number; now?: Date } = {},
): Promise<PreviewResult> {
  const result = await noticeContext(actor, leaseId, type, options)
  if (!result.ok) return result

  const rendered = renderDocument({
    title: result.context.template.title,
    template: result.context.template.body,
    values: result.context.values,
    rawFields: RAW_NOTICE_FIELDS,
  })
  return { ok: true, html: rendered.bodyHtml, context: result.context }
}

export type GenerateResult =
  | { ok: true; noticeId: string; documentId: string; documentHash: string }
  | { ok: false; problem: NoticeProblem }

/// Generates and stores a notice. One transaction: a Notice row that exists
/// without its document, or a document with no notice pointing at it, is a hole
/// in the evidence chain.
export async function generateNotice(
  actor: Actor,
  leaseId: string,
  type: LienNoticeType,
  options: { deadlineDays?: number; now?: Date; correctsNoticeId?: string } = {},
): Promise<GenerateResult> {
  const result = await noticeContext(actor, leaseId, type, options)
  if (!result.ok) return result
  const context = result.context

  const noticeId = await prisma.$transaction(async (tx) => {
    const { id: documentId, rendered } = await storeGeneratedDocument(
      {
        facilityId: context.facilityId,
        type: 'notice',
        subjectType: 'Lease',
        subjectId: leaseId,
        title: context.template.title,
        template: context.template.body,
        values: context.values,
        rawFields: RAW_NOTICE_FIELDS,
        actor: toAuditActor(actor),
      },
      tx,
    )

    const notice = await tx.notice.create({
      data: {
        facilityId: context.facilityId,
        leaseId,
        type,
        status: 'generated',
        generatedAt: new Date(),
        generatedByStaffId: actor.kind === 'staff' ? actor.staffUserId : null,
        documentId,
        documentHash: rendered.contentHash,
        noticeTemplateId: context.template.id,
        templateVersion: context.template.version,
        renderedAddressLine1: context.address.line1,
        renderedAddressLine2: context.address.line2,
        renderedCity: context.address.city,
        renderedState: context.address.state,
        renderedPostalCode: context.address.postalCode,
        tenantAddressId: context.address.id,
        claimSnapshot: context.claim as unknown as Prisma.InputJsonValue,
        claimTotalCents: context.claim.totalCents,
        deadlineDate: context.deadlineDate,
        correctsNoticeId: options.correctsNoticeId ?? null,
      },
      select: { id: true },
    })

    // The correction marks the original superseded. `supersededAt` only —
    // nothing on the original row is rewritten, and its document is untouched.
    if (options.correctsNoticeId) {
      await tx.notice.update({
        where: { id: options.correctsNoticeId },
        data: { supersededAt: new Date() },
      })
    }

    await recordAudit(
      {
        actor: toAuditActor(actor),
        facilityId: context.facilityId,
        action: 'notice.generated',
        entityType: 'Notice',
        entityId: notice.id,
        context: {
          type,
          leaseId,
          claimTotalCents: context.claim.totalCents,
          documentHash: rendered.contentHash,
          templateVersion: context.template.version,
          renderedTo: `${context.address.line1}, ${context.address.city} ${context.address.postalCode}`,
          corrects: options.correctsNoticeId ?? null,
        },
      },
      tx,
    )

    return { id: notice.id, documentId, documentHash: rendered.contentHash }
  })

  return {
    ok: true,
    noticeId: noticeId.id,
    documentId: noticeId.documentId,
    documentHash: noticeId.documentHash,
  }
}

export type DeliveryResult = { ok: true } | { ok: false; reason: string; missingProof?: string[] }

/// Records that a notice was served. The `notice_email` consent check lives
/// here rather than on the screen, so no future caller can route around it.
export async function recordNoticeDelivery(
  actor: Actor,
  noticeId: string,
  input: {
    method: NoticeDeliveryMethod
    deliveredAt: Date
    proof: Record<string, string>
  },
): Promise<DeliveryResult> {
  const notice = await prisma.notice.findUniqueOrThrow({
    where: { id: noticeId },
    select: {
      id: true,
      facilityId: true,
      status: true,
      supersededAt: true,
      lease: { select: { tenantId: true } },
    },
  })
  requirePermission(actor, 'delinquency:execute_step', notice.facilityId)

  if (notice.status === 'draft') {
    return { ok: false, reason: 'This notice has not been generated yet.' }
  }
  if (notice.supersededAt) {
    return {
      ok: false,
      reason:
        'This notice has been superseded by a correction. Record delivery against the corrected notice instead.',
    }
  }

  const verdict = canDeliver({
    method: input.method,
    proof: input.proof,
    noticeEmailConsent: await currentConsent(notice.lease.tenantId, 'notice_email'),
  })
  if (!verdict.allowed) {
    return { ok: false, reason: verdict.reason, missingProof: verdict.missingProof }
  }

  await prisma.$transaction(async (tx) => {
    await tx.notice.update({
      where: { id: noticeId },
      data: {
        status: 'delivered',
        deliveryMethod: input.method,
        deliveredAt: input.deliveredAt,
        deliveryProof: input.proof,
      },
    })
    await recordAudit(
      {
        actor: toAuditActor(actor),
        facilityId: notice.facilityId,
        action: 'notice.delivered',
        entityType: 'Notice',
        entityId: noticeId,
        context: { method: input.method, deliveredAt: input.deliveredAt.toISOString(), proof: input.proof },
      },
      tx,
    )
  })

  return { ok: true }
}

export type NoticeRow = {
  id: string
  type: NoticeType
  status: string
  generatedAt: Date | null
  documentId: string | null
  documentHash: string | null
  templateVersion: number | null
  claimTotalCents: number | null
  deadlineDate: Date | null
  renderedAddress: string | null
  deliveryMethod: NoticeDeliveryMethod | null
  deliveredAt: Date | null
  deliveryProof: Record<string, string> | null
  supersededAt: Date | null
  correctsNoticeId: string | null
}

export async function noticesForLease(actor: Actor, leaseId: string): Promise<NoticeRow[]> {
  const lease = await prisma.lease.findUniqueOrThrow({
    where: { id: leaseId },
    select: { facilityId: true },
  })
  assertFacilityAccess(actor, lease.facilityId)
  if (!can(actor, 'tenants:view', lease.facilityId)) {
    throw new ForbiddenError('Missing permission to read notices', 'tenants:view', lease.facilityId)
  }

  const notices = await prisma.notice.findMany({
    where: { leaseId },
    orderBy: { createdAt: 'desc' },
  })

  return notices.map((notice) => ({
    id: notice.id,
    type: notice.type,
    status: notice.status,
    generatedAt: notice.generatedAt,
    documentId: notice.documentId,
    documentHash: notice.documentHash,
    templateVersion: notice.templateVersion,
    claimTotalCents: notice.claimTotalCents,
    deadlineDate: notice.deadlineDate,
    renderedAddress: notice.renderedAddressLine1
      ? [
          notice.renderedAddressLine1,
          notice.renderedAddressLine2,
          `${notice.renderedCity}, ${notice.renderedState} ${notice.renderedPostalCode}`,
        ]
          .filter(Boolean)
          .join(', ')
      : null,
    deliveryMethod: notice.deliveryMethod,
    deliveredAt: notice.deliveredAt,
    deliveryProof: (notice.deliveryProof as Record<string, string> | null) ?? null,
    supersededAt: notice.supersededAt,
    correctsNoticeId: notice.correctsNoticeId,
  }))
}

/// Re-exported so callers do not need a second import to know what the totals
/// mean. `ledgerTotals` and `runningBalance` stay the single definition.
export { ledgerTotals, runningBalance }
