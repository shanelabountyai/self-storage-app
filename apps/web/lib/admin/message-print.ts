import { prisma } from '@storage/db'
import { mailingAddress, type MailingAddress } from '@storage/core/notices'
import { recordAudit } from '@storage/core/audit'
import { assertFacilityAccess, can, ForbiddenError } from '@/lib/rbac/authorize'
import { toAuditActor } from '@/lib/rbac/audit-actor'
import type { Actor } from '@/lib/rbac/actor'
import { currentAddress } from '@/lib/portal/contact'
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/lib/i18n'

// B-318. The paper half of B-281.
//
// B-281 renders the letter for a tenant with no email address and stores it on
// the `Message` row. Until now the only place those bytes appeared was a
// collapsed `<details>` on the tenant profile, inside a 256px scrolling `<pre>`
// with admin chrome around it — so "print and mail it", which is the whole
// remedy for a renter we cannot email, meant selecting text with a mouse,
// pasting it into Word and typing the address from another screen. That does
// not happen on a Saturday, and a past-due notice that never reaches the tenant
// is money not collected and a step that cannot be evidenced.
//
// The address of record is D-21's — the newest `TenantAddress` row, not the
// `Tenant.*` cache — because the envelope is the thing a lien file is asked
// about later.

export type MessagePrint = {
  messageId: string
  tenantId: string
  facilityId: string
  tenantName: string
  facilityName: string
  /// B-340. The number the print-time line tells a paper reader to call.
  facilityPhone: string | null
  /// B-357. Whether the message's template requires `links.pay_now` — only a
  /// letter that asks for money gets the print-time "To pay" line.
  asksPayment: boolean
  /// B-357. Sign-in is by email, so a tenant with none is never told to sign in.
  tenantHasEmail: boolean
  timezone: string
  /// B-341 / SC 3.1.2. The recipient's language — the letter's subject, body
  /// and date are in it, inside an admin page that stays English (D-122).
  // ponytail: the tenant's CURRENT preference — `Message` records no locale, so
  // a letter composed before they switched, or one whose template fell back to
  // English, is marked wrong. Store the rendered locale on `Message` if it bites.
  locale: Locale
  subject: string | null
  /// The stored render, verbatim. Never a re-render: templates are versioned
  /// and edited (CN-16), so the only honest answer to "what did we tell them"
  /// is the bytes that were composed at the time.
  body: string
  createdAt: Date
  /// The tenant's address of record, or what it is missing. A letter posted
  /// with a blank city comes back, and it comes back after the deadline the
  /// notice sets — so the page says which part to go and fix rather than
  /// printing an envelope block with a hole in it.
  to: { ok: true; address: MailingAddress } | { ok: false; missing: string[] }
  from: { ok: true; address: MailingAddress } | { ok: false; missing: string[] }
  /// Whether there is an open `no_reachable_channel` task for this tenant that
  /// printing closes. False once it is closed, so a reprint does not offer to
  /// complete a task that is already done.
  openTaskId: string | null
}

/// B-340 / SC 2.5.3. The accessible name of the profile log's "Print this for
/// mailing" link: it starts with the visible words, and never falls back to the
/// template key (D-15) — with no subject, the visible text is the whole name.
export function printForMailingName(subject: string | null): string | undefined {
  return subject ? `Print this for mailing: ${subject}` : undefined
}

/// The letter, the two addresses and the task it closes.
///
/// Scoped to the message's own facility rather than to every facility the
/// tenant has a lease at: the message was sent by a site, and that site is who
/// the letter comes from.
export async function messageForPrint(actor: Actor, messageId: string): Promise<MessagePrint | null> {
  const message = await prisma.message.findUnique({
    where: { id: messageId },
    select: {
      id: true,
      subjectSnapshot: true,
      bodySnapshot: true,
      createdAt: true,
      templateKey: true,
      templateVersion: true,
      channel: true,
      recipientTenantId: true,
      facilityId: true,
      recipient: { select: { firstName: true, lastName: true, preferredLocale: true, email: true } },
      facility: {
        select: {
          name: true,
          phone: true,
          timezone: true,
          addressLine1: true,
          addressLine2: true,
          city: true,
          state: true,
          postalCode: true,
        },
      },
    },
  })

  // A message to a lead or an anonymous reservation has neither a tenant nor a
  // facility, and there is nobody to address an envelope to. Not a refusal
  // worth wording — the link that reaches this only exists on a tenant's log.
  if (!message?.recipientTenantId || !message.facilityId || !message.facility || !message.recipient) {
    return null
  }

  assertFacilityAccess(actor, message.facilityId)
  if (!can(actor, 'tenants:view', message.facilityId)) {
    throw new ForbiddenError('Missing permission to read this tenant', 'tenants:view', message.facilityId)
  }

  const address = await currentAddress(message.recipientTenantId)
  // Any row of this key and version, whatever its locale or facility override:
  // `Message` records neither, and a translation does not change what it asks for.
  const payTemplate = await prisma.messageTemplate.findFirst({
    where: {
      key: message.templateKey,
      channel: message.channel,
      version: message.templateVersion,
      requiredMergeFields: { has: 'links.pay_now' },
    },
    select: { id: true },
  })
  // Scoped to the message's own facility, not just to the tenant. A tenant
  // with units at two sites can have an open task at each, and closing the
  // wrong site's — possibly one this actor cannot even see — would leave the
  // letter that WAS printed recorded against somebody else's queue.
  const task = await prisma.task.findFirst({
    where: {
      type: 'no_reachable_channel',
      entityId: message.recipientTenantId,
      facilityId: message.facilityId,
      status: 'open',
    },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  })

  const tenantName = `${message.recipient.firstName} ${message.recipient.lastName}`.trim()

  return {
    messageId: message.id,
    tenantId: message.recipientTenantId,
    facilityId: message.facilityId,
    tenantName,
    facilityName: message.facility.name,
    facilityPhone: message.facility.phone,
    asksPayment: payTemplate !== null,
    tenantHasEmail: Boolean(message.recipient.email),
    timezone: message.facility.timezone,
    locale: isLocale(message.recipient.preferredLocale) ? message.recipient.preferredLocale : DEFAULT_LOCALE,
    subject: message.subjectSnapshot,
    body: message.bodySnapshot,
    createdAt: message.createdAt,
    to: mailingAddress({
      name: tenantName,
      line1: address?.addressLine1,
      line2: address?.addressLine2,
      city: address?.city,
      state: address?.state,
      postalCode: address?.postalCode,
    }),
    from: mailingAddress({
      name: message.facility.name,
      line1: message.facility.addressLine1,
      line2: message.facility.addressLine2,
      city: message.facility.city,
      state: message.facility.state,
      postalCode: message.facility.postalCode,
    }),
    openTaskId: task?.id ?? null,
  }
}

export type PrintedResult = { ok: true; taskClosed: boolean } | { ok: false; reason: string }

/// Records that the letter was printed, and closes the tenant's open
/// `no_reachable_channel` task.
///
/// B-166's standard, applied to this type by B-318: a note cannot close it
/// (`resolvedByAction` in the catalog refuses that from every queue), because
/// what the task says is that a tenant has not been told — and typing "mailed
/// it" is the same sentence the task already contains. Completing it here, from
/// the print action, is the only path, so a completed row means a letter came
/// off a printer.
///
/// Directly rather than through `completeTask`, for the reason
/// `closeUndeliveredNoticeTask` (B-166) does the same: that function refuses
/// this type outright now.
export async function recordLetterPrinted(actor: Actor, messageId: string): Promise<PrintedResult> {
  if (actor.kind !== 'staff') throw new ForbiddenError('Staff access required')

  const letter = await messageForPrint(actor, messageId)
  if (!letter) return { ok: false, reason: 'That message has no tenant to address a letter to.' }

  if (letter.body.trim() === '') {
    return {
      ok: false,
      reason:
        'This message has no stored text, so there is nothing to print. It failed before it was composed — the problem is on the message in the log.',
    }
  }
  if (!letter.to.ok) {
    return {
      ok: false,
      reason: `This tenant's address of record is missing its ${letter.to.missing.join(', ')}. Add the address before recording the letter as mailed.`,
    }
  }

  if (!can(actor, 'tenants:edit', letter.facilityId)) {
    throw new ForbiddenError('Missing permission to complete tasks', 'tenants:edit', letter.facilityId)
  }

  const taskId = letter.openTaskId
  if (!taskId) return { ok: true, taskClosed: false }

  const note = `Letter printed for mailing — ${letter.subject ?? 'message'} of ${letter.createdAt.toISOString().slice(0, 10)}, to the address of record.`

  await prisma.$transaction(async (tx) => {
    const { count } = await tx.task.updateMany({
      // Still `status: 'open'` in the where clause: two staff printing the same
      // letter within the same second must not write the completion twice, and
      // the second one finding nothing to update is the right answer.
      where: { id: taskId, status: 'open' },
      data: {
        status: 'completed',
        completedByStaffId: actor.staffUserId,
        completedAt: new Date(),
        proof: { note },
      },
    })
    if (count === 0) return

    // `no_reachable_channel` is `sensitive` in the catalog — whether a tenant
    // was reachable is what a lien dispute turns on, so who mailed what, when,
    // belongs in the audit trail and not only on the task row.
    await recordAudit(
      {
        actor: toAuditActor(actor),
        facilityId: letter.facilityId,
        action: 'task.completed',
        entityType: 'Task',
        entityId: taskId,
        context: { type: 'no_reachable_channel', messageId, entityType: 'Tenant', entityId: letter.tenantId },
      },
      tx,
    )
  })

  return { ok: true, taskClosed: true }
}
