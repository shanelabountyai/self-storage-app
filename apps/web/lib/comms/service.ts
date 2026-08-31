import { type Prisma, prisma } from '@storage/db'
import type {
  ChannelPolicy,
  DomainEvent,
  MessageChannel,
  MessageClassification,
  NotificationCategory,
  SuppressionReason,
} from '@storage/db'
import { codeForLease } from '@/lib/access/provision'
import { mintPayLink, payLinkUrl } from '@/lib/portal/pay-links'
import { leaseHasEffect } from '@/lib/admin/holds'
import { REFERRAL_REFUSAL_MESSAGES, type ReferralRefusal } from '@storage/core/referrals'
import { daysPastDue } from '@storage/core/metrics'
import { isAutoCollecting } from '@storage/core/payment-plans'
import { formatCents } from '@/lib/format'
import { facilityPath } from '@/lib/facility/public-facility'
import { absoluteUrl } from '@storage/core/marketing'
import { currentRateForUnitType } from '@/lib/pricing/unit-type-rates'
import { offerFor } from '@/lib/promotions/service'
import { defaultNotificationPreference, isMarketingQuietHours, isSmsQuietHours, normalizePhoneE164, tableHtml } from '@storage/core/comms'
import { currentConsent } from '@storage/core/consent'
import { mintUnsubscribeToken, unsubscribeUrl } from './unsubscribe-token'
import { mintCheckoutResumeToken, checkoutResumeUrl } from '@/lib/checkout/resume-token'
import {
  commsEnabled,
  effectiveRecipient,
  effectiveSmsRecipient,
  fromAddress,
  selectProvider,
  selectSmsProvider,
  withPostalFooter,
} from './provider'
import { type MergeContext, type MergeValue, messageIdempotencyKey, RenderError, renderEmail, renderString } from './render'

// PRD 05 FR-1. The pipeline: event → rule(s) → recipient → suppression/consent
// → render → provider → Message log, idempotent by construction. Producers emit
// events and this is the only thing that sends. B-030 ships the engine; the
// rules and templates that light it up are data seeded by the items that own
// the content (B-031 move-in path, later billing/dunning items).
//
// MVP is email-only (FR-4). SMS — Twilio, quiet hours, STOP/HELP, consent
// gating, the fallback pair — lands with B-032/Phase 2; the schema and the
// classification/consent checks below are already shaped for it.

const CHANNEL = 'email' as const

type RecipientFacility = {
  id: string
  name: string
  slug: string
  emailFromName: string | null
  emailReplyTo: string | null
  phone: string | null
  addressLine1: string
  addressLine2: string | null
  city: string
  state: string
  postalCode: string
  timezone: string
  googleReviewUrl: string | null
  /// B-074. Null means SMS is not configured for this facility — every
  /// `sms_preferred_email_fallback` rule degrades to email-only.
  smsMessagingServiceSid: string | null
  smsQuietHoursStartHour: number
  smsQuietHoursEndHour: number
}

type RecipientLease = {
  id: string
  status: string
  unit: { number: string; unitType: { name: string; widthFt: number; lengthFt: number } } | null
  /// Whether this unit will genuinely charge itself. BOTH halves, because they
  /// live in two places (B-036): the lease says the unit is enrolled, the
  /// tenant says which card. Either missing and nothing is charged
  /// automatically — which is exactly when a "your rent is due" reminder is the
  /// right message rather than the wrong one.
  autopayActive: boolean
}

type RecipientReservation = { id: string; expiresAt: Date; unitType: { widthFt: number; lengthFt: number } }

type RecipientLead = {
  id: string
  status: string
  dripStep: number
  unitTypeId: string | null
  unitType: { widthFt: number; lengthFt: number } | null
}

type Recipient = {
  /// Identifies the recipient for idempotency and `Message.recipientTenantId`.
  /// Usually the tenant id — but a reservation is D-7's anonymous hold (no
  /// account required), so this falls back to the reservation id, which is
  /// just as stable an identity for "don't message this holder twice."
  recipientKey: string
  tenantId: string | null
  email: string | null
  /// B-074. The tenant/reservation/lead's own phone, not the facility's
  /// office number (`RecipientFacility.phone`). Null wherever the source row
  /// has none — a reservation or lead never requires one, and a tenant's is
  /// optional at checkout.
  phone: string | null
  firstName: string
  lastName: string
  facility: RecipientFacility | null
  lease: RecipientLease | null
  reservation: RecipientReservation | null
  lead: RecipientLead | null
}

const LEASE_SELECT = {
  id: true,
  status: true,
  autopayEnabled: true,
  unit: { select: { number: true, unitType: { select: { name: true, widthFt: true, lengthFt: true } } } },
} as const

const FACILITY_SELECT = {
  id: true,
  name: true,
  slug: true,
  emailFromName: true,
  emailReplyTo: true,
  phone: true,
  addressLine1: true,
  addressLine2: true,
  city: true,
  state: true,
  postalCode: true,
  timezone: true,
  googleReviewUrl: true,
  smsMessagingServiceSid: true,
  smsQuietHoursStartHour: true,
  smsQuietHoursEndHour: true,
} as const

/// Resolves who a message goes to from the event's entity. Keyed by entityType
/// because that is what tells us how to reach the tenant — a lease points at one
/// via `tenantId`, a reservation carries its own contact fields (D-7: no account
/// required). B-030/B-031 ship the resolvers their own events need; later items
/// (billing, delinquency) add Payment/Invoice resolvers when their rules arrive.
/// An unhandled entity type is a no-op, not a crash — the event simply has no
/// comms mapping yet.
async function resolveRecipient(event: DomainEvent): Promise<Recipient | null> {
  if (event.entityType === 'Lease') {
    const lease = await prisma.lease.findUnique({
      where: { id: event.entityId },
      select: {
        status: true,
        autopayEnabled: true,
        tenant: {
          select: {
            id: true,
            email: true,
            phone: true,
            firstName: true,
            lastName: true,
            stripeDefaultPaymentMethodId: true,
          },
        },
        facility: { select: FACILITY_SELECT },
        unit: { select: { number: true, unitType: { select: { name: true, widthFt: true, lengthFt: true } } } },
      },
    })
    if (!lease) return null
    return {
      recipientKey: lease.tenant.id,
      tenantId: lease.tenant.id,
      email: lease.tenant.email,
      phone: lease.tenant.phone,
      firstName: lease.tenant.firstName,
      lastName: lease.tenant.lastName,
      facility: lease.facility,
      lease: {
        id: event.entityId,
        status: lease.status,
        unit: lease.unit,
        autopayActive: lease.autopayEnabled && Boolean(lease.tenant.stripeDefaultPaymentMethodId),
      },
      reservation: null,
      lead: null,
    }
  }

  if (event.entityType === 'Tenant') {
    const tenant = await prisma.tenant.findUnique({
      where: { id: event.entityId },
      select: { id: true, email: true, phone: true, firstName: true, lastName: true },
    })
    if (!tenant) return null
    const facility = event.facilityId
      ? await prisma.facility.findUnique({ where: { id: event.facilityId }, select: FACILITY_SELECT })
      : null
    return {
      recipientKey: tenant.id,
      tenantId: tenant.id,
      email: tenant.email,
      phone: tenant.phone,
      firstName: tenant.firstName,
      lastName: tenant.lastName,
      facility,
      lease: null,
      reservation: null,
      lead: null,
    }
  }

  // B-050. Billing events name an Invoice or a Payment; both reach the tenant
  // through the lease, and both carry the lease forward so the autopay skip and
  // the unit line have something to read.
  if (event.entityType === 'Invoice') {
    const invoice = await prisma.invoice.findUnique({
      where: { id: event.entityId },
      select: {
        facility: { select: FACILITY_SELECT },
        lease: {
          select: {
            ...LEASE_SELECT,
            tenant: {
              select: {
                id: true,
                email: true,
                phone: true,
                firstName: true,
                lastName: true,
                stripeDefaultPaymentMethodId: true,
              },
            },
          },
        },
      },
    })
    if (!invoice) return null
    return recipientFromLease(invoice.lease, invoice.facility)
  }

  if (event.entityType === 'Payment') {
    const payment = await prisma.payment.findUnique({
      where: { id: event.entityId },
      select: {
        facility: { select: FACILITY_SELECT },
        tenant: {
          select: {
            id: true,
            email: true,
            phone: true,
            firstName: true,
            lastName: true,
            stripeDefaultPaymentMethodId: true,
          },
        },
        // The lease this money was for, through the invoice it settled. A
        // payment that named no invoice (a move-in, a counter payment) falls
        // back to the tenant's occupying lease at this facility below.
        allocations: {
          take: 1,
          orderBy: { createdAt: 'asc' },
          select: { invoice: { select: { lease: { select: LEASE_SELECT } } } },
        },
      },
    })
    if (!payment) return null

    const lease =
      payment.allocations[0]?.invoice.lease ??
      (await prisma.lease.findFirst({
        where: { tenantId: payment.tenant.id, facilityId: payment.facility.id, status: { not: 'ended' } },
        orderBy: { startDate: 'desc' },
        select: LEASE_SELECT,
      }))

    return {
      recipientKey: payment.tenant.id,
      tenantId: payment.tenant.id,
      email: payment.tenant.email,
      phone: payment.tenant.phone,
      firstName: payment.tenant.firstName,
      lastName: payment.tenant.lastName,
      facility: payment.facility,
      lease: lease
        ? {
            id: lease.id,
            status: lease.status,
            unit: lease.unit,
            autopayActive:
              lease.autopayEnabled && Boolean(payment.tenant.stripeDefaultPaymentMethodId),
          }
        : null,
      reservation: null,
      lead: null,
    }
  }

  // B-098. Access events name the grant, which is per (facility, tenant). The
  // unit comes from that tenant's occupying lease at the facility — a tenant
  // with two units there sees one of them named, which is honest: the gate is
  // shared and both are affected.
  if (event.entityType === 'AccessGrant') {
    const grant = await prisma.accessGrant.findUnique({
      where: { id: event.entityId },
      select: { facilityId: true, tenantId: true, facility: { select: FACILITY_SELECT } },
    })
    if (!grant?.tenantId) return null

    const lease = await prisma.lease.findFirst({
      where: { tenantId: grant.tenantId, facilityId: grant.facilityId, status: { not: 'ended' } },
      orderBy: { startDate: 'desc' },
      select: {
        ...LEASE_SELECT,
        tenant: {
          select: {
            id: true,
            email: true,
            phone: true,
            firstName: true,
            lastName: true,
            stripeDefaultPaymentMethodId: true,
          },
        },
      },
    })
    if (!lease) return null
    return recipientFromLease(lease, grant.facility)
  }

  if (event.entityType === 'Reservation') {
    const reservation = await prisma.reservation.findUnique({
      where: { id: event.entityId },
      select: {
        id: true,
        tenantId: true,
        email: true,
        phone: true,
        firstName: true,
        lastName: true,
        expiresAt: true,
        facility: { select: FACILITY_SELECT },
        unitType: { select: { widthFt: true, lengthFt: true } },
      },
    })
    if (!reservation) return null
    return {
      recipientKey: reservation.id,
      tenantId: reservation.tenantId,
      email: reservation.email,
      phone: reservation.phone,
      firstName: reservation.firstName,
      lastName: reservation.lastName,
      facility: reservation.facility,
      lease: null,
      reservation: { id: reservation.id, expiresAt: reservation.expiresAt, unitType: reservation.unitType },
      lead: null,
    }
  }

  // B-072. A lead is D-7's anonymous shape too — no account required to ask
  // for a quote — so the same `recipientKey`-falls-back-to-the-row's-own-id
  // device the reservation branch above uses applies here.
  if (event.entityType === 'Lead') {
    const lead = await prisma.lead.findUnique({
      where: { id: event.entityId },
      select: {
        id: true,
        status: true,
        dripStep: true,
        unitTypeId: true,
        unitType: { select: { widthFt: true, lengthFt: true } },
        email: true,
        phone: true,
        firstName: true,
        lastName: true,
        facility: { select: FACILITY_SELECT },
      },
    })
    if (!lead) return null
    return {
      recipientKey: lead.id,
      tenantId: null,
      email: lead.email,
      phone: lead.phone,
      firstName: lead.firstName ?? 'there',
      lastName: lead.lastName ?? '',
      facility: lead.facility,
      lease: null,
      reservation: null,
      lead: {
        id: lead.id,
        status: lead.status,
        dripStep: lead.dripStep,
        unitTypeId: lead.unitTypeId,
        unitType: lead.unitType,
      },
    }
  }

  return null
}

/// Shared shape for the two resolvers that reach a tenant through a lease.
function recipientFromLease(
  lease: {
    id: string
    status: string
    autopayEnabled: boolean
    unit: { number: string; unitType: { name: string; widthFt: number; lengthFt: number } } | null
    tenant: {
      id: string
      email: string | null
      phone: string | null
      firstName: string
      lastName: string
      stripeDefaultPaymentMethodId: string | null
    }
  },
  facility: RecipientFacility,
): Recipient {
  return {
    recipientKey: lease.tenant.id,
    tenantId: lease.tenant.id,
    email: lease.tenant.email,
    phone: lease.tenant.phone,
    firstName: lease.tenant.firstName,
    lastName: lease.tenant.lastName,
    facility,
    lease: {
      id: lease.id,
      status: lease.status,
      unit: lease.unit,
      autopayActive: lease.autopayEnabled && Boolean(lease.tenant.stripeDefaultPaymentMethodId),
    },
    reservation: null,
    lead: null,
  }
}

function formatFacilityAddress(f: RecipientFacility): string {
  const street = f.addressLine2 ? `${f.addressLine1}, ${f.addressLine2}` : f.addressLine1
  return `${street}, ${f.city}, ${f.state} ${f.postalCode}`
}

/// An absolute local date/time, never a countdown (PRD 01 §2.2.1 — a ticking
/// clock in an email or on a page a renter may return to hours later reads as
/// pressure, and drifts from reality the instant the render is stale anyway).
function formatAbsoluteLocal(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

function baseUrl(): string {
  return (process.env.AUTH_URL ?? 'http://localhost:3000').replace(/\/$/, '')
}

/// Shared by `reservation.expiring_soon` and its transfer-hold twin (B-140) —
/// both read the same reservation/facility shape, only the template differs.
async function reservationExpiresAtContext(_event: DomainEvent, recipient: Recipient): Promise<MergeContext> {
  if (!recipient.reservation || !recipient.facility) return {} as MergeContext
  return {
    'reservation.expires_at': formatAbsoluteLocal(recipient.reservation.expiresAt, recipient.facility.timezone),
  }
}

/// FR-10 standard merge fields, built from current state — read here, at send
/// time, not frozen at event time (FR-18). Fields that need billing
/// (`balance.total`, `invoice.due_date`, `links.pay_now`) are intentionally
/// absent: the items that emit those events extend this builder. A template
/// that references a field not built yet fails loudly at render (FR-9) rather
/// than mailing a blank — which is exactly why those templates are not seeded
/// until their data exists.
function mergeContextFor(recipient: Recipient): MergeContext {
  const context: MergeContext = {
    'tenant.first_name': recipient.firstName,
    'tenant.last_name': recipient.lastName,
    'links.portal': `${baseUrl()}/login`,
  }
  if (recipient.facility) {
    context['facility.name'] = recipient.facility.name
    context['facility.phone'] = recipient.facility.phone ?? ''
    context['facility.address'] = formatFacilityAddress(recipient.facility)
  }
  if (recipient.lease?.unit) {
    const { widthFt, lengthFt } = recipient.lease.unit.unitType
    context['unit.number'] = recipient.lease.unit.number
    context['unit.size'] = `${widthFt}x${lengthFt}`
  }
  if (recipient.reservation) {
    const { widthFt, lengthFt } = recipient.reservation.unitType
    context['unit.size'] = `${widthFt}x${lengthFt}`
  }
  if (recipient.lead?.unitType) {
    const { widthFt, lengthFt } = recipient.lead.unitType
    context['unit.size'] = `${widthFt}x${lengthFt}`
  }
  return context
}

/// PRD 05 FR-2's "extend the builder" seam: event-specific merge fields that
/// need more than the recipient's own row (a gate code, a ledger amount, a
/// reservation's hold time). Keyed by event name so an event with no extender
/// just gets the standard context — most events (payment, delinquency) will
/// add their own entry here without touching the pipeline itself.
/// CN-24's schedule, in both parts of the message from the one array (B-198).
///
/// The text part stays the numbered list a tenant reads in a proportional font;
/// the HTML part is a real table with a caption and scoped headers, which is
/// the criterion CN-24 named and the one a flattened string cannot meet. Not
/// two authored bodies — two renderings of the same installments, so they
/// cannot disagree about a date or an amount.
function scheduleValue(
  installments: readonly { dueDate: Date; amountCents: number }[],
): MergeValue {
  const rows = installments.map((installment, index) => [
    `${index + 1}`,
    formatPlanDate(installment.dueDate),
    formatCents(installment.amountCents),
  ])
  return {
    text: rows.map(([number, date, amount]) => `${number}. ${date} — ${amount}`).join('\n'),
    html: tableHtml({
      caption: 'Your payment plan',
      columns: ['Payment', 'Date', 'Amount'],
      rows,
    }),
  }
}

type ContextExtender = (event: DomainEvent, recipient: Recipient) => Promise<MergeContext>

/// B-051. A one-tap pay link for this message, or the portal login as a
/// fallback.
///
/// Minted per event, so a payment made through it is attributable to the
/// message that prompted it (CN-4). Falls back to `/portal/pay` — which needs a
/// password — whenever there is no lease to scope a link to, rather than
/// omitting the line and leaving a reminder with no way to act on it.
async function payNowLink(recipient: Recipient, event: DomainEvent): Promise<string> {
  const fallback = `${baseUrl()}/portal/pay`
  if (!recipient.tenantId || !recipient.lease) return fallback

  const link = await mintPayLink({
    tenantId: recipient.tenantId,
    leaseId: recipient.lease.id,
    eventId: event.id,
  })
  return link ? payLinkUrl(link.token, baseUrl()) : fallback
}

/// Shared by both due-date reminders: the same figures, a different subject.
const invoiceContext: ContextExtender = async (event, recipient) => {
  const invoice = await prisma.invoice.findUnique({
    where: { id: event.entityId },
    select: { number: true, dueDate: true, totalCents: true, amountPaidCents: true },
  })
  if (!invoice) return {} as MergeContext
  const timezone = recipient.facility?.timezone ?? 'America/Chicago'
  return {
    'invoice.number': invoice.number,
    'invoice.due_date': new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    }).format(invoice.dueDate),
    'invoice.amount': formatCents(invoice.totalCents - invoice.amountPaidCents),
    'links.pay_now': await payNowLink(recipient, event),
  }
}

/// PRD 10 §3 (B-101). "$50 comes off your invoice on {date}" — or, honestly,
/// without the date when there is no invoice to name yet.
///
/// The referrer's credit lands on their NEXT invoice, which may be up to a
/// month away (§3), and the portal states the date because "you'll get it
/// eventually" is the version that generates a phone call. The same rule
/// applies to the message: name the date when one is known, and say plainly
/// that it is the next invoice when it is not. Inventing a date would be worse
/// than omitting one.
async function referralRewardContext(
  event: DomainEvent,
  side: 'referrer' | 'referee',
): Promise<MergeContext> {
  const payload = event.payload as Record<string, unknown>
  const cents = typeof payload.rewardCents === 'number' ? payload.rewardCents : 0
  const amount = formatCents(cents)
  const line =
    side === 'referee'
      ? `${amount} comes off your first invoice.`
      : `${amount} comes off your next invoice.`
  return { 'referral.reward_line': line }
}

/// D-55. Every unit the renter moved into, as a readable list.
///
/// A multi-unit checkout provisions N leases in one transaction and emits ONE
/// `lease.moved_in` for the primary one, so the event's own entity names a
/// single unit while the renter rented several.
///
/// The other units are found through the BASKET, not through the leases: a
/// lease carries no checkout id (`leaseIdForSession` matches on tenant+unit for
/// the same reason), while `CheckoutSessionUnit` records exactly which units
/// were bought together. Going lease → line → session → lines is therefore the
/// only link that actually exists, rather than one inferred from timestamps.
async function movedInUnitList(leaseId: string): Promise<string> {
  const lease = await prisma.lease.findUnique({
    where: { id: leaseId },
    select: { unitId: true, unit: { select: { number: true } } },
  })
  if (!lease) return ''
  const own = lease.unit?.number ?? ''

  // Newest first: a unit can have been in an earlier, abandoned basket too, and
  // the one that produced THIS lease is the most recent to have claimed it.
  const line = await prisma.checkoutSessionUnit.findFirst({
    where: { unitId: lease.unitId },
    orderBy: { createdAt: 'desc' },
    select: { checkoutSessionId: true },
  })
  // A lease with no basket behind it — staff-created, or migrated from before
  // the basket existed — is one unit by definition.
  if (!line) return own

  const lines = await prisma.checkoutSessionUnit.findMany({
    where: { checkoutSessionId: line.checkoutSessionId },
    select: { unit: { select: { number: true } } },
    orderBy: { createdAt: 'asc' },
  })
  const numbers = lines
    .map((row) => row.unit?.number)
    .filter((number): number is string => Boolean(number))
  if (numbers.length === 0) return own
  if (numbers.length === 1) return numbers[0]
  return `${numbers.slice(0, -1).join(', ')} and ${numbers[numbers.length - 1]}`
}

const CONTEXT_EXTENDERS: Record<string, ContextExtender> = {
  // CN-7: the gate code line, only after the credential is actually issued —
  // never a placeholder that looks like a code. `codeForLease` (B-029) already
  // returns null whenever there is nothing to reveal (no key configured, or
  // issuance genuinely hasn't landed yet), which is exactly the same fallback
  // the confirmation page shows.
  'lease.moved_in': async (event) => {
    const code = await codeForLease(event.entityId)
    const charge = await firstChargeLine(event.entityId)
    return {
      'access.gate_code_line': code
        ? `Your gate code is ${code}.`
        : 'Your gate code will be texted to you within 15 minutes.',
      'billing.first_charge_line': charge,
      'unit.number_list': await movedInUnitList(event.entityId),
    }
  },

  // PRD 10 §6.3 (B-101). The reward line and the refusal sentence.
  //
  // Both are computed HERE rather than written into the template, for the same
  // reason the gate-code line is: the template must not be able to render a
  // figure that disagrees with what was actually recorded. The amount comes
  // from the referral row's own SNAPSHOT (§6.1), not from the facility's
  // current setting — changing the program next quarter must not rewrite what
  // somebody was already promised, and a template reading today's setting
  // would do exactly that.
  'referral.qualified': async (event) => referralRewardContext(event, 'referrer'),
  'referral.reward_granted': async (event) => referralRewardContext(event, 'referee'),

  'referral.refused': async (event) => {
    const payload = event.payload as Record<string, unknown>
    const refusal = typeof payload.refusal === 'string' ? payload.refusal : null
    // The same closed vocabulary the staff record and the portal read, so all
    // three say the same thing about the same refusal. An unrecognised key
    // falls back to a sentence that still says what to do, never to
    // "not eligible" — the row forbids that in as many words.
    const message =
      refusal && refusal in REFERRAL_REFUSAL_MESSAGES
        ? REFERRAL_REFUSAL_MESSAGES[refusal as ReferralRefusal]
        : 'We could not confirm this referral. Call us and we will look at it with you.'
    return { 'referral.refusal_reason': message }
  },

  // B-140: the transfer-hold event reuses this — same recipient shape
  // (entityType 'Reservation' either way), only the template differs.
  'reservation.expiring_soon': reservationExpiresAtContext,
  'reservation.transfer_hold_expiring_soon': reservationExpiresAtContext,

  // CN-8: how the account actually settled. Read from the event payload,
  // which the move-out transaction wrote — not re-derived from the ledger
  // here, because by send time a later adjustment could make this sentence
  // disagree with the figure the tenant was shown at the counter.
  'lease.moved_out': async (event) => {
    const payload = (event.payload ?? {}) as { amountDueCents?: number; refundDueCents?: number }
    const due = payload.amountDueCents ?? 0
    const refund = payload.refundDueCents ?? 0
    return {
      'billing.settlement_line':
        refund > 0
          ? `We owe you ${formatCents(refund)} back — we'll be in touch about getting it to you.`
          : due > 0
            ? `There is ${formatCents(due)} still outstanding on the account.`
            : 'Your account is settled in full — nothing further is owed.',
    }
  },

  // PRD 01 US-707. The date, from the request itself — not re-read off the
  // lease, which a cancel-and-re-request between send and this render could
  // have already changed to a different one.
  'lease.move_out_requested': async (event, recipient) => {
    const payload = (event.payload ?? {}) as { moveOutDate?: string }
    const timezone = recipient.facility?.timezone ?? 'America/Chicago'
    const date = payload.moveOutDate ? new Date(`${payload.moveOutDate}T00:00:00.000Z`) : null
    return {
      'lease.move_out_date': date
        ? new Intl.DateTimeFormat('en-US', { timeZone: timezone, month: 'long', day: 'numeric', year: 'numeric' }).format(date)
        : 'the date you requested',
    }
  },

  // B-090 part 2. Both unit numbers and the date come from the event, not from
  // a re-read: by the time this renders, staff may already have completed the
  // transfer — at which point the lease points at the NEW unit and a re-read
  // would tell the tenant they asked to move from B-04 to B-04.
  'lease.transfer_requested': async (event, recipient) => {
    const payload = (event.payload ?? {}) as { toUnitNumber?: string; transferDate?: string }
    const timezone = recipient.facility?.timezone ?? 'America/Chicago'
    const date = payload.transferDate ? new Date(`${payload.transferDate}T00:00:00.000Z`) : null
    return {
      'transfer.to_unit_number': payload.toUnitNumber ?? 'the unit you chose',
      'transfer.date': date
        ? new Intl.DateTimeFormat('en-US', { timeZone: timezone, month: 'long', day: 'numeric', year: 'numeric' }).format(date)
        : 'the date you requested',
    }
  },

  // ── B-050: the payment lifecycle ────────────────────────────────────────────
  //
  // Every figure below is read at SEND time (FR-18), not carried from the
  // event, so a tenant who paid an hour ago is told what is true now.

  // B-098. The day count and the balance the tenant has to clear, read at send
  // time — a tenant who paid between the suspension and the send sees the
  // figure that is true now.
  'access.suspended': async (event, recipient) => {
    // Recomputed at send time (FR-18), not carried on the event: a tenant who
    // paid between the suspension and the dispatch must see the figure that is
    // true now, and `transitionGrant`'s payload carries the transition rather
    // than the arithmetic behind it.
    const invoices = recipient.lease
      ? await prisma.invoice.findMany({
          where: { leaseId: recipient.lease.id, kind: 'rent' },
          select: { dueDate: true, totalCents: true, amountPaidCents: true },
        })
      : []
    return {
      'access.days_past_due': String(daysPastDue(invoices, new Date())),
      'balance.total': formatCents(await leaseBalanceCents(recipient.lease?.id ?? null)),
      'links.pay_now': await payNowLink(recipient, event),
    }
  },

  // B-063 / PRD 05 CN-11. Same recompute-at-send-time reasoning as
  // `access.suspended` — a tenant who paid between the lock going on and the
  // dispatch must see the figure that is true now, not the one that triggered
  // the timeline step.
  'overlock.required': async (event, recipient) => {
    const invoices = recipient.lease
      ? await prisma.invoice.findMany({
          where: { leaseId: recipient.lease.id, kind: 'rent' },
          select: { dueDate: true, totalCents: true, amountPaidCents: true },
        })
      : []
    return {
      'access.days_past_due': String(daysPastDue(invoices, new Date())),
      'balance.total': formatCents(await leaseBalanceCents(recipient.lease?.id ?? null)),
      'links.pay_now': await payNowLink(recipient, event),
    }
  },

  // B-063 / PRD 05 CN-12. Read from the EVENT payload — the figures the
  // generated document actually stated — never recomputed. A courtesy email
  // quoting a different balance than the notice it describes would be worse
  // than not sending one.
  'notice.generated': async (event, recipient) => {
    const payload = (event.payload ?? {}) as { claimTotalCents?: number; deadlineDate?: string }
    // The deadline is a calendar date (packages/db's `@db.Date`), read back as
    // UTC midnight — formatting it with a facility timezone could shift it a
    // day off what the actual notice document printed.
    const deadline = payload.deadlineDate ? new Date(`${payload.deadlineDate}T00:00:00.000Z`) : null
    return {
      'notice.balance': formatCents(payload.claimTotalCents ?? 0),
      'notice.deadline_date': deadline
        ? new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric' }).format(deadline)
        : '—',
      'links.pay_now': await payNowLink(recipient, event),
    }
  },

  // B-072 / PRD 04 US-14. Shared by all three drip templates — computed once
  // per event, same as every other extender — so a step-1 send and a step-3
  // send for the same lead never disagree about the price if the rate moved
  // between them.
  'lead.drip_step': async (_event, recipient) => {
    if (!recipient.lead?.unitTypeId || !recipient.facility) return {} as MergeContext
    const rate = await currentRateForUnitType(recipient.lead.unitTypeId)
    const offer = rate
      ? await offerFor({
          facilityId: recipient.facility.id,
          unitTypeId: recipient.lead.unitTypeId,
          monthlyRateCents: rate.webRateCents,
          isNewTenant: true,
        })
      : { offer: null }
    return {
      'lead.quoted_price': rate ? `${formatCents(rate.webRateCents)}/mo` : 'Call for current pricing',
      // AC1: step 3 fires only when a promo is live, so this is never blank on
      // the send that actually uses it — but computed here, at send time, so a
      // promo that ended between the job's check and the dispatch is not
      // quoted after it is gone.
      'lead.promo_line': offer.offer ? offer.offer.terms : '',
      'links.facility_page': absoluteUrl(baseUrl(), facilityPath(recipient.facility)),
    }
  },

  // B-073 / PRD 04 US-9 AC1. Entity type is 'Tenant' (a checkout session has
  // no consistent entity of its own before it becomes a lease), so everything
  // about the session itself — unit size, quoted price, any live promo, the
  // resume link — comes from re-reading it here by the id on the payload.
  // Same re-derive-fresh reasoning as `lead.drip_step`: a promo that ended
  // between the job raising this step and the send must not be quoted after
  // it is gone.
  'checkout.abandonment_step': async (event, recipient) => {
    const payload = (event.payload ?? {}) as { checkoutSessionId?: string }
    if (!payload.checkoutSessionId || !recipient.facility) return {} as MergeContext
    const session = await prisma.checkoutSession.findUnique({
      where: { id: payload.checkoutSessionId },
      select: {
        id: true,
        unitTypeId: true,
        quotedRateCents: true,
        unitType: { select: { widthFt: true, lengthFt: true } },
      },
    })
    if (!session) return {} as MergeContext

    const offer = await offerFor({
      facilityId: recipient.facility.id,
      unitTypeId: session.unitTypeId,
      monthlyRateCents: session.quotedRateCents,
      isNewTenant: true,
    })

    return {
      'unit.size': `${session.unitType.widthFt}x${session.unitType.lengthFt}`,
      'checkout.quoted_price': `${formatCents(session.quotedRateCents)}/mo`,
      'checkout.promo_line': offer.offer ? offer.offer.terms : '',
      'links.resume_checkout': checkoutResumeUrl(mintCheckoutResumeToken(session.id), baseUrl()),
    }
  },

  // B-071 / PRD 04 US-7 AC1. The recipient's own lease is on the event
  // already (entityType 'Lease'); the only extra fact is where to send them.
  // `googleReviewUrl` is read at send time rather than carried on the event —
  // an operator who fixes a broken link after the job already raised the
  // request should have the CORRECT one land in the tenant's inbox.
  'review.requested': async (_event, recipient) => ({
    'links.google_review': recipient.facility?.googleReviewUrl ?? '',
  }),

  // B-076 / PRD 05 CN-9. Every figure comes from the EVENT payload, not a
  // fresh read — deliberately the opposite of this file's usual FR-18
  // recompute-at-send-time rule, and for the reason B-063's notice supplement
  // gives: this letter IS the legal notice of a specific increase, and one
  // quoting a different figure than the increase it gives notice of would be
  // worse than not sending it. The row it describes is also mid-flight
  // (`notice_sent`, not yet `applied`), so `Lease.monthlyRateCents` still
  // holds the OLD rate at this moment — reading it live would print the old
  // rate as the new one.
  // B-077 / PRD 02 US-14. Read from the event payload, not re-derived: by the
  // time this renders the old lease is `ended` and the new one holds the new
  // rate, so a live read would have to reconstruct which unit they came from
  // — the event already carries it, and carrying it is why the payload has
  // those fields.
  'lease.transferred': async (event) => {
    const payload = (event.payload ?? {}) as {
      fromUnitNumber?: string
      toUnitNumber?: string
      newRateCents?: number
      transferDate?: string
      totalDueTodayCents?: number
    }
    const due = payload.totalDueTodayCents ?? 0
    const transferDate = payload.transferDate
      ? new Date(`${payload.transferDate}T00:00:00.000Z`)
      : null

    return {
      'transfer.from_unit': payload.fromUnitNumber ?? '',
      'transfer.to_unit': payload.toUnitNumber ?? '',
      'transfer.new_rate': payload.newRateCents !== undefined ? formatCents(payload.newRateCents) : '',
      // UTC, like every other calendar-date merge field here — the transfer
      // happened on a day, and a timezone would shift it.
      'transfer.date': transferDate
        ? new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', dateStyle: 'long' }).format(transferDate)
        : '',
      // One sentence rather than three merge fields the template would have
      // to assemble: the three cases (charged, credited, nothing) read
      // differently, and a template cannot express that without conditionals
      // it does not have.
      'transfer.settlement_line':
        due > 0
          ? `You were charged ${formatCents(due)} today for the rest of this billing period.`
          : due < 0
            ? `${formatCents(-due)} has been credited to your account.`
            : 'There was nothing extra to pay today.',
      'links.portal': `${baseUrl()}/login`,
    }
  },

  'lease.rate_increase_scheduled': async (event) => {
    const payload = (event.payload ?? {}) as {
      previousRateCents?: number
      newRateCents?: number
      effectiveDate?: string
      noticeDays?: number
    }
    const effective = payload.effectiveDate
      ? new Date(`${payload.effectiveDate}T00:00:00.000Z`)
      : null
    return {
      'rate.old': payload.previousRateCents !== undefined ? formatCents(payload.previousRateCents) : '',
      'rate.new': payload.newRateCents !== undefined ? formatCents(payload.newRateCents) : '',
      // Formatted in UTC, not the facility timezone: the effective date is a
      // calendar day (`@db.Date`), and running it through a timezone would
      // shift it a day off the date the increase actually takes effect on —
      // the same reasoning `notice.generated`'s deadline date already uses.
      'rate.effective_date': effective
        ? new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', dateStyle: 'long' }).format(effective)
        : '',
      'rate.notice_days': payload.noticeDays !== undefined ? String(payload.noticeDays) : '',
      'links.portal': `${baseUrl()}/login`,
    }
  },

  // CN-3's tone escalation, as content rather than code. Four rungs, and the
  // wording gets firmer without ever threatening something that has not been
  // decided — the day-10 line warns about access because B-098 genuinely
  // suspends it, and the day-30 line says "we would have to begin" rather than
  // naming a date, because the lien pipeline is Phase 2 and promising a date we
  // cannot keep is worse than saying less.
  'delinquency.day_reached': async (event, recipient) => {
    const payload = (event.payload ?? {}) as { day?: number; position?: number; totalSteps?: number }
    const position = payload.position ?? 1
    const total = payload.totalSteps ?? 4
    const last = position >= total

    const tone = [
      'It looks like this month’s payment did not go through — it happens, and it is quick to put right.',
      'Your balance is still outstanding, and a late fee may now have been added.',
      'This account is far enough behind that your gate access is at risk.',
      'This account is seriously overdue and we need to hear from you.',
    ]
    const consequence = [
      'Paying today avoids any late fee.',
      'Please settle it when you can, or call us and we will work something out.',
      'If it stays unpaid, your gate code will stop working until the balance is cleared. Your belongings stay where they are.',
      'If we do not hear from you, we would have to begin the formal collection steps our lease and state law allow. We would much rather arrange something with you.',
    ]
    // Position beyond the written rungs reuses the last one rather than
    // rendering blank: an operator who adds a fifth step gets the firmest
    // wording, not an empty paragraph.
    const rung = Math.min(Math.max(position, 1), tone.length) - 1

    return {
      'dunning.subject_line': last
        ? 'Your account is seriously overdue'
        : position === 1
          ? 'We missed your payment'
          : 'Your balance is still outstanding',
      'dunning.tone_line': tone[rung],
      'dunning.consequence_line': consequence[rung],
      'dunning.days_past_due': String(payload.day ?? 0),
      'balance.total': formatCents(await leaseBalanceCents(recipient.lease?.id ?? null)),
      'links.pay_now': await payNowLink(recipient, event),
    }
  },

  'invoice.due_soon': invoiceContext,
  'invoice.due_today': invoiceContext,

  // CN-6's receipt. The amount comes off the Payment row rather than the event
  // payload for the same reason — a partial refund between the charge and the
  // send would otherwise be invisible in a document the tenant keeps.
  'payment.succeeded': async (event, recipient) => {
    const payment = await prisma.payment.findUnique({
      where: { id: event.entityId },
      select: { amountCents: true, receivedAt: true, method: true },
    })
    if (!payment) return {} as MergeContext
    const timezone = recipient.facility?.timezone ?? 'America/Chicago'
    return {
      'payment.amount': formatCents(payment.amountCents),
      'payment.date': new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        dateStyle: 'long',
      }).format(payment.receivedAt),
      'payment.method': payment.method === 'card' ? 'card' : payment.method.replace('_', ' '),
      'balance.total': formatCents(await leaseBalanceCents(recipient.lease?.id ?? null)),
    }
  },

  // US-20's "fix path ≤5 min". The decline reason is deliberately NOT quoted
  // verbatim — Stripe's message is written for a developer, and "your card was
  // declined: do_not_honor" tells a tenant nothing they can act on. What they
  // need is the amount, the unit, and one link.
  'payment.failed': async (event, recipient) => {
    const payload = (event.payload ?? {}) as { amountCents?: number; code?: string }
    const expired = payload.code === 'expired_card'
    return {
      'payment.amount': formatCents(payload.amountCents ?? 0),
      'payment.failure_line': expired
        ? 'The card we have on file has expired, so we could not take the payment.'
        : 'Your bank declined the payment. That is usually a temporary block or a limit, not anything wrong with your account here.',
      // Updating a card genuinely needs the portal — it changes what autopay
      // charges from then on, which is more than this link is scoped to grant.
      'links.update_card': `${baseUrl()}/portal/methods`,
      'links.pay_now': await payNowLink(recipient, event),
    }
  },

  // D-29's daily reminder. Says which of the three it is and what happens next,
  // rather than repeating one sentence for three days.
  'payment.retry_reminder': async (event, recipient) => {
    const payload = (event.payload ?? {}) as {
      outstandingCents?: number
      reminderNumber?: number
      remindersTotal?: number
    }
    const number = payload.reminderNumber ?? 1
    const total = payload.remindersTotal ?? 3
    return {
      'payment.amount': formatCents(payload.outstandingCents ?? 0),
      'links.pay_now': await payNowLink(recipient, event),
      'links.update_card': `${baseUrl()}/portal/methods`,
      'payment.retry_line':
        number >= total
          ? 'This is the last reminder we will send about this payment. If it stays unpaid, someone from the office will be in touch.'
          : 'We will try the card again automatically, so if you update it or add funds there is nothing else to do.',
    }
  },

  // CN-10a. The card has not failed yet — this is the whole point, and the
  // wording has to stay out of dunning territory or a three-year on-time tenant
  // reads it as a collections letter.
  'payment_method.expiring': async (event) => {
    const payload = (event.payload ?? {}) as { expMonth?: number; expYear?: number; stage?: number }
    const month = payload.expMonth
    const year = payload.expYear
    return {
      'card.expires': month && year ? `${String(month).padStart(2, '0')}/${year}` : 'soon',
      'card.urgency_line':
        payload.stage === 7
          ? 'It expires within the week, so this is worth doing today.'
          : 'There is no rush — any time in the next few weeks is fine.',
      'links.update_card': `${baseUrl()}/portal/methods`,
    }
  },

  // D-17. Two notices the owner's decision explicitly assigned to this item.
  'protection.proof_expiring': async (event) => {
    const payload = (event.payload ?? {}) as { expiresOn?: string }
    return {
      'protection.expires_on': payload.expiresOn
        ? new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', dateStyle: 'long' }).format(
            new Date(`${payload.expiresOn}T00:00:00.000Z`),
          )
        : 'soon',
      'links.portal': `${baseUrl()}/login`,
    }
  },

  'protection.auto_enrolled': async (event) => {
    const payload = (event.payload ?? {}) as { planName?: string; premiumCents?: number }
    return {
      'protection.plan_name': payload.planName ?? 'our standard cover',
      'protection.premium': formatCents(payload.premiumCents ?? 0),
    }
  },

  // ── PRD 05 CN-24 (B-191). The payment plan's four messages. ────────────────

  'payment_plan.agreed': async (event) => {
    const plan = await planForEvent(event)
    if (!plan) return {} as MergeContext
    return {
      'plan.total': formatCents(plan.totalCents),
      'plan.schedule': scheduleValue(plan.installments),
      'plan.collection_line': collectionLine(plan, 'each payment'),
      'links.plan': `${baseUrl()}/portal/payment-plan`,
    }
  },

  'payment_plan.installment_due_soon': async (event, recipient) => {
    const plan = await planForEvent(event)
    const payload = (event.payload ?? {}) as { installmentId?: string }
    const installment = plan?.installments.find((one) => one.id === payload.installmentId)
    if (!plan || !installment) return {} as MergeContext
    return {
      'plan.installment_amount': formatCents(installment.amountCents),
      'plan.installment_due_date': formatPlanDate(installment.dueDate, {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
      }),
      'plan.collection_line': collectionLine(plan, 'this payment'),
      'links.pay_now': await payNowLink(recipient, event),
    }
  },

  // The balance is read HERE, at send time (FR-18), not carried on the event:
  // the whole point of the message is what is owed now that the plan has
  // ended, and a tenant who paid something between the job and the dispatch
  // must be quoted the figure that is true.
  'payment_plan.broken': async (event, recipient) => {
    // B-206. The missed installment comes off the payload rather than being
    // re-derived here: which one broke the plan is a decision the breach job
    // made, against a grace window and a retry ladder this send path has no
    // business re-running. Same shape as `installment_due_soon` above, and the
    // same failure mode — no installment resolved, no context, and the render
    // guard refuses to mail a sentence with a hole where the amount goes.
    const plan = await planForEvent(event)
    const payload = (event.payload ?? {}) as { installmentId?: string }
    const missed = plan?.installments.find((one) => one.id === payload.installmentId)
    if (!missed) return {} as MergeContext
    return {
      'plan.balance': formatCents(await leaseBalanceCents(recipient.lease?.id ?? null)),
      'plan.missed_amount': formatCents(missed.amountCents),
      'plan.missed_due_date': formatPlanDate(missed.dueDate, {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
      }),
      'links.pay_now': await payNowLink(recipient, event),
      'links.plan': `${baseUrl()}/portal/payment-plan`,
    }
  },

  // D-107 (B-208). The plan broke on rent it never deferred. Same shape as
  // `broken` above and the same refusal: no invoice resolved, no context, and
  // the render guard declines to mail a sentence with a hole in it.
  'payment_plan.broken_unpaid_rent': async (event, recipient) => {
    const payload = (event.payload ?? {}) as { invoiceId?: string }
    const invoice = payload.invoiceId
      ? await prisma.invoice.findUnique({
          where: { id: payload.invoiceId },
          select: { totalCents: true, amountPaidCents: true, dueDate: true },
        })
      : null
    if (!invoice) return {} as MergeContext
    return {
      'plan.balance': formatCents(await leaseBalanceCents(recipient.lease?.id ?? null)),
      // What is still outstanding on it, not what it was raised for: a tenant
      // who part-paid must be quoted the part they did not.
      'invoice.amount': formatCents(invoice.totalCents - invoice.amountPaidCents),
      'invoice.due_date': formatPlanDate(invoice.dueDate, {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
      }),
      'links.pay_now': await payNowLink(recipient, event),
      'links.plan': `${baseUrl()}/portal/payment-plan`,
    }
  },

  'payment_plan.completed': async (event) => {
    const plan = await planForEvent(event)
    return plan ? { 'plan.total': formatCents(plan.totalCents) } : ({} as MergeContext)
  },

  // B-206. The reason is read from the plan row rather than carried on the
  // event, for the same reason `plan.balance` is read at send time: the row is
  // what the audit log and the staff screen show, and a message quoting
  // something different from both is worse than no message.
  'payment_plan.cancelled': async (event, recipient) => {
    const plan = await planForEvent(event)
    if (!plan?.cancelReason) return {} as MergeContext
    return {
      'plan.cancel_reason': plan.cancelReason,
      'plan.balance': formatCents(await leaseBalanceCents(recipient.lease?.id ?? null)),
      'links.pay_now': await payNowLink(recipient, event),
    }
  },
}

/// The plan an event names, with everything the four templates read.
///
/// `payload.planId` rather than the event's own entity, which is the LEASE: a
/// lease can have a chain of plans (D-98) and the message is about one of them.
async function planForEvent(event: DomainEvent) {
  const planId = (event.payload as { planId?: string } | null)?.planId
  if (!planId) return null
  return prisma.paymentPlan.findUnique({
    where: { id: planId },
    select: {
      totalCents: true,
      autoCollect: true,
      cancelReason: true,
      installments: {
        orderBy: { dueDate: 'asc' },
        select: { id: true, dueDate: true, amountCents: true },
      },
      lease: {
        select: { autopayEnabled: true, tenant: { select: { stripeDefaultPaymentMethodId: true } } },
      },
    },
  })
}

/// An installment date is a calendar date the staffer typed, stored as UTC
/// midnight — formatted in a facility timezone it would read a day early, the
/// same trap `notice.generated`'s deadline names above.
function formatPlanDate(
  date: Date,
  options: Intl.DateTimeFormatOptions = { month: 'long', day: 'numeric', year: 'numeric' },
): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...options }).format(date)
}

/// D-97, in the tenant's words. Says whether the card will actually be charged
/// — all three halves of it (`isAutoCollecting`), read fresh at send time, so a
/// plan agreed as automatic against a card since removed says the true thing
/// rather than the agreed one.
function collectionLine(
  plan: {
    autoCollect: boolean
    lease: { autopayEnabled: boolean; tenant: { stripeDefaultPaymentMethodId: string | null } }
  },
  subject: 'each payment' | 'this payment',
): string {
  const automatic = isAutoCollecting({
    autoCollect: plan.autoCollect,
    autopayEnabled: plan.lease.autopayEnabled,
    hasSavedCard: Boolean(plan.lease.tenant.stripeDefaultPaymentMethodId),
  })
  return automatic
    ? `We will take ${subject} from your card on file on the date shown — you do not need to do anything.`
    : `${subject === 'each payment' ? 'These payments are' : 'This payment is'} not taken automatically. Pay online, over the phone, or at the office on or before the date shown.`
}

/// What the lease owes right now, from the ledger — PRD 01 §7.3 makes the
/// ledger the source of truth for balance, not a sum of invoice remainders.
async function leaseBalanceCents(leaseId: string | null): Promise<number> {
  if (!leaseId) return 0
  const sum = await prisma.ledgerEntry.aggregate({
    where: { leaseId },
    _sum: { amountCents: true },
  })
  return Math.max(0, sum._sum.amountCents ?? 0)
}

/// The move-in charge line: what was actually charged today, and the ongoing
/// rate. Reads `LedgerEntry` rather than an `Invoice` because nothing generates
/// invoices yet (billing is B-044) — this is the one thing that does exist at
/// move-in (B-026's opening ledger), read fresh rather than carried in the
/// event payload (FR-18).
async function firstChargeLine(leaseId: string): Promise<string> {
  const lease = await prisma.lease.findUnique({
    where: { id: leaseId },
    select: { monthlyRateCents: true, billingDay: true },
  })
  const charge = await prisma.ledgerEntry.findFirst({
    where: { leaseId, type: 'charge' },
    orderBy: { occurredAt: 'asc' },
    select: { amountCents: true },
  })
  if (!lease || !charge) return ''
  const today = (charge.amountCents / 100).toFixed(2)
  const monthly = (lease.monthlyRateCents / 100).toFixed(2)
  return `You were charged $${today} today. After that, rent is $${monthly}/mo, billed on day ${lease.billingDay} of each month.`
}

type ResolvedRule = {
  id: string
  templateKey: string
  classification: MessageClassification
  skipConditions: string[]
  channel: MessageChannel
  /// B-074 FR-7. Only meaningful when `channel === 'sms'` — `deliverForRule`
  /// (email) never reads this.
  channelPolicy: ChannelPolicy
  /// B-074 CN-13. Which preference-center row governs this rule, if any.
  category: NotificationCategory | null
}

/// FR-2. The active rules for this event, with the per-facility override winning
/// over the org default for a given template key. B-074: no longer filtered by
/// channel — a rule's OWN channel decides which delivery path it takes, and
/// there is still exactly one rule per (event, templateKey), never a
/// email-and-sms pair competing for the same key.
async function applicableRules(event: DomainEvent): Promise<ResolvedRule[]> {
  const rows = await prisma.notificationRule.findMany({
    where: {
      event: event.name,
      active: true,
      OR: [{ facilityId: event.facilityId ?? undefined }, { facilityId: null }],
    },
  })

  const byKey = new Map<string, (typeof rows)[number]>()
  for (const row of rows) {
    const current = byKey.get(row.templateKey)
    // A facility-scoped rule beats a null (org-default) one for the same key.
    if (!current || (row.facilityId && !current.facilityId)) byKey.set(row.templateKey, row)
  }
  return [...byKey.values()].map((r) => ({
    id: r.id,
    templateKey: r.templateKey,
    classification: r.classification,
    skipConditions: r.skipConditions,
    channel: r.channel,
    channelPolicy: r.channelPolicy,
    category: r.category,
  }))
}

/// The effective template for a key: facility override beats org default, and
/// the highest active version wins (versioned per FR-21).
async function effectiveTemplate(templateKey: string, channel: MessageChannel, facilityId: string | null) {
  const rows = await prisma.messageTemplate.findMany({
    where: {
      key: templateKey,
      channel,
      active: true,
      OR: [{ facilityId: facilityId ?? undefined }, { facilityId: null }],
    },
  })
  if (rows.length === 0) return null
  const scoped = rows.filter((r) => r.facilityId === facilityId)
  const pool = scoped.length > 0 ? scoped : rows.filter((r) => r.facilityId === null)
  return pool.reduce((best, r) => (r.version > best.version ? r : best))
}

/// PRD 05 §6.1 suppression matrix. A hard bounce or spam complaint blocks every
/// channel — the address is unusable or the recipient reported us. STOP blocks
/// SMS only, but ALL SMS regardless of classification (CN-14: "transactional
/// included"). Unsubscribe / manual block marketing only; transactional and
/// operational mail still goes, which is what CAN-SPAM's transactional carve-out
/// permits. Returns the reason so the send record can prove why it was withheld.
async function suppressionFor(
  address: string,
  classification: MessageClassification,
  channel: MessageChannel,
): Promise<SuppressionReason | null> {
  const entry = await prisma.suppression.findUnique({
    where: { channel_address: { channel, address: channel === 'email' ? address.toLowerCase() : address } },
  })
  if (!entry) return null
  switch (entry.reason) {
    case 'hard_bounce':
    case 'complaint':
      return entry.reason
    case 'unsubscribe':
    case 'manual':
      return classification === 'marketing' ? entry.reason : null
    case 'stop':
      // The WHERE clause above already scopes by channel, so a 'stop' row
      // only ever exists under channel:'sms' in practice — this branch stays
      // explicit rather than assuming that invariant holds forever.
      return channel === 'sms' ? entry.reason : null
    case 'kill_switch':
      return null
  }
}

/// FR-18 staleness. Predicates re-evaluated at send time; if any holds the
/// message's premise is gone and it is cancelled rather than sent. B-030 ships
/// the one predicate provable against what exists today; billing/dunning items
/// register `invoice_paid`, `payment_processing`, `autopay_enabled`, etc. as
/// their events arrive.
const SKIP_PREDICATES: Record<
  string,
  (recipient: Recipient, event: DomainEvent) => boolean | Promise<boolean>
> = {
  // Don't welcome or chase a tenant whose lease has already ended.
  tenant_moved_out: (recipient) => recipient.lease?.status === 'ended',

  // B-050 / CN-1, CN-2. The autopay skip.
  //
  // Telling a tenant to go and pay a bill their own saved card is about to
  // cover is the message that teaches people to ignore every other one we
  // send — and the ones who act on it pay twice and then ring the office.
  // "Autopay is on" is deliberately BOTH halves (see `autopayActive`): a lease
  // enrolled with no card on file will not be charged, and that tenant does
  // need telling.
  autopay_covers_it: (recipient) => recipient.lease?.autopayActive === true,

  // US-42 (B-096). A hold declaring `halt_dunning` stops the past-due chasing:
  // the retry reminders, and B-052's ladder when it lands. Deliberately NOT the
  // ordinary "rent is due on the 1st" reminder — a tenant on a payment plan
  // still has rent due, and going silent about it would be its own problem.
  lease_on_hold_dunning: async (recipient) =>
    recipient.lease ? leaseHasEffect(recipient.lease.id, 'halt_dunning') : false,

  // The channel instruction rather than the forbearance: `do_not_contact` and
  // every broader hold carry this.
  lease_on_hold_marketing: async (recipient) =>
    recipient.lease ? leaseHasEffect(recipient.lease.id, 'suppress_marketing') : false,

  // FR-18 staleness. An invoice settled between the event and the send — a
  // counter payment this morning, an autopay run that beat the dispatcher —
  // must not still produce "your rent is due".
  invoice_paid: async (_recipient, event) => {
    if (event.entityType !== 'Invoice') return false
    const invoice = await prisma.invoice.findUnique({
      where: { id: event.entityId },
      select: { totalCents: true, amountPaidCents: true, status: true },
    })
    if (!invoice) return true
    return invoice.status === 'paid' || invoice.amountPaidCents >= invoice.totalCents
  },

  // B-063. FR-18 staleness for the overlock notice: the tenant paid and staff
  // already took the lock off between the event and the dispatch. "We've
  // locked your unit" would be false by the time it landed.
  overlock_already_cleared: async (recipient) => {
    if (!recipient.lease) return false
    const live = await prisma.unitOverlock.findFirst({
      where: { leaseId: recipient.lease.id, removedAt: null },
      select: { id: true },
    })
    return !live
  },

  // B-063 / PRD 05 CN-12. `notice.generated` fires for both notice types; each
  // rule is scoped to the one it renders by skipping the other, the same
  // device `applicableRules` already uses for multiple templates on one event.
  notice_type_not_pre_lien: (_recipient, event) => (event.payload as { type?: string })?.type !== 'pre_lien',
  notice_type_not_lien: (_recipient, event) => (event.payload as { type?: string })?.type !== 'lien',

  // PRD 05 CN-24 (B-191). FR-18 staleness for the installment reminder: the
  // plan was cancelled, completed or broken in the gap between the nightly job
  // raising this and the dispatcher reaching it. "Your next installment is
  // due" about a plan that no longer exists is worse than silence, and the
  // break notice has already said what is actually true.
  //
  // The other three CN-24 messages have no equivalent: each states something
  // that HAPPENED, and none of them stops being true afterwards.
  payment_plan_not_active: async (_recipient, event) => {
    const planId = (event.payload as { planId?: string } | null)?.planId
    if (!planId) return true
    const plan = await prisma.paymentPlan.findUnique({
      where: { id: planId },
      select: { status: true },
    })
    return plan?.status !== 'active'
  },

  // B-072 / PRD 04 US-14. One event (`lead.drip_step`), three templates —
  // same device `notice.generated` uses for pre-lien vs lien.
  drip_step_not_1: (_recipient, event) => (event.payload as { step?: number })?.step !== 1,
  drip_step_not_2: (_recipient, event) => (event.payload as { step?: number })?.step !== 2,
  drip_step_not_3: (_recipient, event) => (event.payload as { step?: number })?.step !== 3,

  // FR-18 staleness, re-checked at send time even though the job already
  // filters at raise time: a lead can reserve, get marked lost, or have its
  // size cleared in the gap between the two.
  lead_exited: (recipient) => {
    if (!recipient.lead) return false
    return (
      !recipient.lead.unitTypeId ||
      recipient.lead.status === 'lost' ||
      recipient.lead.status === 'reserved' ||
      recipient.lead.status === 'converted'
    )
  },

  // US-13/US-14: "no consent, no sequence." The job that raises each step
  // already checks this before emitting the event; re-checked here because
  // consent can be withdrawn between one step's send and the next.
  no_consent: async (recipient) => {
    if (!recipient.lead) return false
    return (await currentConsent({ leadId: recipient.lead.id }, 'marketing_email')) !== 'granted'
  },

  // B-071. Defence in depth: the raising job already refuses a facility with
  // no link configured, but an operator could clear it in the gap between the
  // event being raised and the dispatcher reaching it. A review ask with a
  // dead link is worse than a late one.
  no_google_review_link: (recipient) => !recipient.facility?.googleReviewUrl,

  // B-073 / PRD 04 US-9. One event (`checkout.abandonment_step`), three
  // templates — same device `drip_step_not_*` uses.
  abandonment_step_not_1: (_recipient, event) => (event.payload as { step?: number })?.step !== 1,
  abandonment_step_not_2: (_recipient, event) => (event.payload as { step?: number })?.step !== 2,
  abandonment_step_not_3: (_recipient, event) => (event.payload as { step?: number })?.step !== 3,

  // AC2/FR-18 staleness: the renter finished checking out, or the session's
  // lock lapsed and was never resumed, in the gap between the raising job and
  // this send. Re-read rather than trusted from the event, same reasoning as
  // `invoice_paid` above.
  checkout_session_exited: async (_recipient, event) => {
    const payload = (event.payload ?? {}) as { checkoutSessionId?: string }
    if (!payload.checkoutSessionId) return true
    const session = await prisma.checkoutSession.findUnique({
      where: { id: payload.checkoutSessionId },
      select: { status: true },
    })
    return !session || session.status === 'completed'
  },

  // AC3: "no consent, no sequence." The job already checks this before
  // raising each step; re-checked here because consent can be withdrawn
  // between one step's send and the next — `no_consent` above is the same
  // check for a Lead owner, this is the Tenant-owner equivalent a checkout
  // session's recipient always resolves to.
  checkout_no_consent: async (recipient) => {
    if (!recipient.tenantId) return true
    return (await currentConsent({ tenantId: recipient.tenantId }, 'marketing_email')) !== 'granted'
  },
}

async function firstFiringSkip(
  rule: ResolvedRule,
  recipient: Recipient,
  event: DomainEvent,
): Promise<string | null> {
  for (const key of rule.skipConditions) {
    const predicate = SKIP_PREDICATES[key]
    if (predicate && (await predicate(recipient, event))) return key
  }
  return null
}

type DeliveryOutcome = 'sent' | 'suppressed' | 'cancelled' | 'failed' | 'skipped' | 'deferred'

/// Upserts the append-only Message row for one (event, rule, recipient, channel)
/// to a terminal state. Keyed by the idempotency key, so a redelivery lands on
/// the same row instead of a duplicate.
async function writeMessage(
  idempotencyKey: string,
  data: {
    event: DomainEvent
    ruleId: string
    templateKey: string
    templateVersion: number
    classification: MessageClassification
    recipient: Recipient
    toAddress: string
    subject: string | null
    body: string
    status: 'queued' | 'sent' | 'failed' | 'suppressed' | 'cancelled' | 'deferred'
    suppressionReason?: SuppressionReason | null
    providerMessageId?: string | null
    error?: string | null
    sentAt?: Date | null
    /// B-074. Defaults to email — every pre-existing call site is the email
    /// path and needs no change.
    channel?: MessageChannel
    /// B-074 FR-21. Which consent record authorised an SMS. Null for email.
    consentId?: string | null
  },
) {
  const common = {
    templateKey: data.templateKey,
    templateVersion: data.templateVersion,
    classification: data.classification,
    channel: data.channel ?? CHANNEL,
    recipientTenantId: data.recipient.tenantId,
    facilityId: data.recipient.facility?.id ?? data.event.facilityId ?? null,
    toAddress: data.toAddress,
    subjectSnapshot: data.subject,
    bodySnapshot: data.body,
    status: data.status,
    suppressionReason: data.suppressionReason ?? null,
    providerMessageId: data.providerMessageId ?? null,
    error: data.error ?? null,
    sentAt: data.sentAt ?? null,
    consentId: data.consentId ?? null,
  }
  return prisma.message.upsert({
    where: { idempotencyKey },
    create: {
      idempotencyKey,
      eventId: data.event.id,
      ruleId: data.ruleId,
      ...common,
    },
    update: common,
  })
}

/// PRD 05 CN-13 (B-074). Whether the tenant has this category+channel turned
/// on. `null` category (legally significant, marketing) always passes —
/// those are never toggle-off-able, by construction rather than a check here.
/// No tenant (a Lead/Reservation recipient) also always passes: the
/// preference center is portal-scoped and only a Tenant has one.
async function notificationAllowed(
  tenantId: string | null,
  category: NotificationCategory | null,
  channel: MessageChannel,
): Promise<boolean> {
  if (!category || !tenantId) return true
  const row = await prisma.notificationPreference.findUnique({
    where: { tenantId_category_channel: { tenantId, category, channel } },
    select: { enabled: true },
  })
  return row ? row.enabled : defaultNotificationPreference(category, channel)
}

/// PRD 05 §5.1/FR-5, PRD 04 US-13 AC3, D-51 (B-123). Whether this tenant has
/// said yes to THIS KIND of SMS.
///
/// The lane is chosen by classification, and that is the whole point of the
/// function. It used to check `account_sms` for every classification, with a
/// comment explaining that this was safe because no marketing SMS rule existed
/// — true at the time and load-bearing on nobody enforcing it. The first
/// marketing rule anyone wired to SMS would have sent under TRANSACTIONAL
/// consent, which is the compliance failure PRD 05's two-lane split exists to
/// prevent, with nothing in the code to stop it. B-123's row named that trap
/// exactly: "a promo sent down the transactional lane because the marketing
/// lane does not exist."
///
/// Now the lane must exist to be used. `marketing_sms` is separate express
/// written consent (TCPA), captured with its own disclosure and its own
/// version — never implied by `account_sms`, which a tenant grants so we can
/// text them a gate code. A global STOP still stops both, because that is
/// enforced by the suppression list a layer up rather than here.
async function smsConsentGranted(
  tenantId: string | null,
  classification: MessageClassification,
): Promise<boolean> {
  if (!tenantId) return false
  const lane = classification === 'marketing' ? 'marketing_sms' : 'account_sms'
  return (await currentConsent({ tenantId }, lane)) === 'granted'
}

/// B-074 FR-7's email fallback, shared by every `sms_preferred_email_fallback`
/// rule that cannot reach the tenant by SMS. Deliberately its own function
/// rather than a call into `deliverForRule`: that function computes its OWN
/// per-channel idempotency key, and the whole point of FR-7's "idempotency
/// key covers the pair" is that the fallback settles on the SAME row the SMS
/// attempt would have. It is also deliberately SIMPLER than `deliverForRule` —
/// no marketing quiet-hours/daily-cap/unsubscribe-link branches — because
/// every rule this item wires to SMS is transactional or operational, never
/// marketing; a future marketing SMS rule would need those added back here.
async function sendEmailFallback(
  idempotencyKey: string,
  rule: ResolvedRule,
  recipient: Recipient,
  context: MergeContext,
  base: { event: DomainEvent; ruleId: string; templateKey: string; classification: MessageClassification; recipient: Recipient },
): Promise<DeliveryOutcome> {
  if (!recipient.email) {
    await writeMessage(idempotencyKey, {
      ...base, templateVersion: 0, toAddress: '', subject: null, body: '',
      status: 'failed', error: 'no reachable email address (sms fallback)',
    })
    return 'failed'
  }
  const address = recipient.email.toLowerCase()

  if (!(await notificationAllowed(recipient.tenantId, rule.category, 'email'))) {
    await writeMessage(idempotencyKey, {
      ...base, templateVersion: 0, toAddress: address, subject: null, body: '',
      status: 'cancelled', error: 'skipped: notification_preference_off',
    })
    return 'cancelled'
  }

  const suppression = await suppressionFor(address, rule.classification, 'email')
  if (suppression) {
    await writeMessage(idempotencyKey, {
      ...base, templateVersion: 0, toAddress: address, subject: null, body: '',
      status: 'suppressed', suppressionReason: suppression, error: `suppressed: ${suppression}`,
    })
    return 'suppressed'
  }

  const template = await effectiveTemplate(rule.templateKey, 'email', recipient.facility?.id ?? null)
  if (!template) {
    await writeMessage(idempotencyKey, {
      ...base, templateVersion: 0, toAddress: address, subject: null, body: '',
      status: 'failed', error: `no active email template for "${rule.templateKey}" (sms fallback)`,
    })
    return 'failed'
  }

  let rendered
  try {
    rendered = renderEmail(template, context)
  } catch (error) {
    if (error instanceof RenderError) {
      await writeMessage(idempotencyKey, {
        ...base, templateVersion: template.version, toAddress: address, subject: null, body: '',
        status: 'failed', error: error.message,
      })
      return 'failed'
    }
    throw error
  }

  await writeMessage(idempotencyKey, {
    ...base, templateVersion: template.version, toAddress: effectiveRecipient(address),
    subject: rendered.subject, body: rendered.text, status: 'queued',
  })

  const facility = recipient.facility
  const footerTarget = facility ? { name: facility.name, address: formatFacilityAddress(facility) } : null
  const text = withPostalFooter(rendered.text, footerTarget)
  const html = footerTarget
    ? `${rendered.html}<hr><p>${footerTarget.name}<br>${footerTarget.address}</p>`
    : rendered.html

  const result = await selectProvider().sendEmail({
    to: effectiveRecipient(address),
    from: fromAddress(facility?.emailFromName ?? facility?.name ?? 'Storage'),
    replyTo: facility?.emailReplyTo ?? null,
    subject: rendered.subject,
    html,
    text,
    idempotencyKey,
  })

  if (result.ok) {
    await writeMessage(idempotencyKey, {
      ...base, templateVersion: template.version, toAddress: effectiveRecipient(address),
      subject: rendered.subject, body: rendered.text, status: 'sent',
      providerMessageId: result.providerMessageId, sentAt: new Date(),
    })
    return 'sent'
  }

  await writeMessage(idempotencyKey, {
    ...base, templateVersion: template.version, toAddress: effectiveRecipient(address),
    subject: rendered.subject, body: rendered.text, status: 'failed', error: result.message,
  })
  if (result.retryable) throw new Error(`comms provider send failed: ${result.message}`)
  return 'failed'
}

/// PRD 05 FR-5/FR-7/FR-8 (B-074). The SMS-primary delivery path. Mirrors
/// `deliverForRule`'s shape (idempotency, skip predicates, suppression,
/// render, send, write) but does not share its body: SMS has a consent gate
/// email never needed (§5.1 — TCPA requires prior consent for ANY automated
/// text, not just marketing), quiet hours that apply to every classification
/// rather than only marketing, no HTML/postal-footer/unsubscribe-link, and an
/// inline fallback to `sendEmailFallback` above.
async function deliverSmsForRule(
  event: DomainEvent,
  rule: ResolvedRule,
  recipient: Recipient,
  context: MergeContext,
  now: Date,
): Promise<DeliveryOutcome> {
  const fallbackEligible = rule.channelPolicy === 'sms_preferred_email_fallback'
  // FR-7: "idempotency key covers the pair so fallback can't duplicate." A
  // fallback-eligible rule shares ONE key between its SMS attempt and its
  // email fallback — exactly one of the two channels ever actually sends for
  // a given (event, rule, recipient), so there is only ever one row to settle.
  const idempotencyKey = messageIdempotencyKey(
    event.id,
    rule.id,
    recipient.recipientKey,
    fallbackEligible ? 'pair' : 'sms',
  )

  const existing = await prisma.message.findUnique({ where: { idempotencyKey }, select: { status: true } })
  if (existing && ['sent', 'delivered', 'suppressed', 'cancelled'].includes(existing.status)) {
    return 'skipped'
  }
  // A `deferred` row is retried by the hourly cron sweep, not re-attempted
  // here — a second dispatch of the same event while one is already queued
  // for the next window must not re-render or double-queue it.
  if (existing?.status === 'deferred') return 'skipped'

  const base = {
    event,
    ruleId: rule.id,
    templateKey: rule.templateKey,
    classification: rule.classification,
    recipient,
  }

  const skip = await firstFiringSkip(rule, recipient, event)
  if (skip) {
    await writeMessage(idempotencyKey, {
      ...base, templateVersion: 0, toAddress: recipient.phone ?? '', subject: null, body: '',
      status: 'cancelled', error: `skipped: ${skip}`, channel: 'sms',
    })
    return 'cancelled'
  }

  // Everything from here down is "can this go by SMS" — any no falls back to
  // email (if the policy allows) rather than terminating, since a reminder a
  // tenant cannot be texted is still one they can be emailed.
  const phone = normalizePhoneE164(recipient.phone)
  const smsAllowed = await notificationAllowed(recipient.tenantId, rule.category, 'sms')
  const consented = await smsConsentGranted(recipient.tenantId, rule.classification)
  const smsSuppression = phone ? await suppressionFor(phone, rule.classification, 'sms') : null
  const messagingServiceSid = recipient.facility?.smsMessagingServiceSid ?? null

  const notViableReason = !messagingServiceSid
    ? 'sms_not_configured'
    : !phone
      ? 'no reachable phone number'
      : !smsAllowed
        ? 'skipped: notification_preference_off'
        : !consented
          ? 'no sms consent'
          : smsSuppression
            ? `suppressed: ${smsSuppression}`
            : null

  // D-51 (B-123). A marketing SMS never falls back to email, whatever the
  // rule's `channelPolicy` says.
  //
  // `sendEmailFallback` is deliberately simpler than the email path — its own
  // comment says so — and skips the marketing quiet-hours, daily-cap and
  // unsubscribe-link branches, plus the `marketing_email` consent check that
  // lives in `deliverForRule`. So a marketing SMS that could not be sent would
  // arrive as a marketing EMAIL that passed none of the marketing gates, to
  // somebody whose only recorded consent might be for texts. That is the same
  // cross-lane send this item exists to prevent, pointing the other way.
  //
  // The marketing email lane has its own rules and its own consent; if a
  // campaign should also go by email, that is a rule row, not a silent
  // fallback across lanes.
  const marketingFallbackRefused = rule.classification === 'marketing'
  if (notViableReason) {
    if (fallbackEligible && !marketingFallbackRefused) {
      return sendEmailFallback(idempotencyKey, rule, recipient, context, base)
    }
    await writeMessage(idempotencyKey, {
      ...base, templateVersion: 0, toAddress: phone ?? '', subject: null, body: '',
      status: smsSuppression ? 'suppressed' : 'failed',
      suppressionReason: smsSuppression, error: notViableReason, channel: 'sms',
    })
    return smsSuppression ? 'suppressed' : 'failed'
  }

  // FR-8. Quiet hours DEFER rather than fall back — a text at 6am becomes a
  // text at 8am, not an email instead. `deferred` is a terminal write here;
  // the hourly cron (`retryDeferredSmsMessages`) is what re-attempts it.
  const timezone = recipient.facility?.timezone ?? 'America/Chicago'
  // Unreachable with `recipient.facility` actually null: `messagingServiceSid`
  // above is only ever truthy when it exists, and a null `messagingServiceSid`
  // already returned above. The `?? 8`/`?? 21` are schema defaults, not a
  // second source of truth — belt, not a real branch.
  const start = recipient.facility?.smsQuietHoursStartHour ?? 8
  const end = recipient.facility?.smsQuietHoursEndHour ?? 21
  if (isSmsQuietHours(now, timezone, start, end)) {
    await writeMessage(idempotencyKey, {
      ...base, templateVersion: 0, toAddress: phone!, subject: null, body: '',
      status: 'deferred', error: 'deferred: sms_quiet_hours', channel: 'sms',
    })
    return 'deferred'
  }

  // FR-MSG-5's cap, on this lane too (D-51). The email path has enforced "max
  // one marketing message a day per contact, across sequences" centrally since
  // B-072; a marketing SMS with no equivalent would let a tenant on both lanes
  // receive one of each, which is two marketing messages in a day by a
  // technicality. Keyed on the address like the email one, and phone numbers
  // and email addresses never collide as strings, so the same rolling window
  // covers each contact method separately without either being special-cased.
  //
  // CANCELLED rather than deferred, unlike quiet hours: a text held back for
  // eight hours is the same text, but one held back a day is yesterday's
  // campaign arriving late.
  if (rule.classification === 'marketing') {
    const rollingDayAgo = new Date(now.getTime() - 24 * 3_600_000)
    const sentToday = await prisma.message.findFirst({
      where: {
        toAddress: phone!,
        classification: 'marketing',
        status: { in: ['sent', 'delivered'] },
        sentAt: { gte: rollingDayAgo },
      },
      select: { id: true },
    })
    if (sentToday) {
      await writeMessage(idempotencyKey, {
        ...base, templateVersion: 0, toAddress: phone!, subject: null, body: '',
        status: 'cancelled', error: 'skipped: marketing_daily_cap', channel: 'sms',
      })
      return 'cancelled'
    }
  }

  const template = await effectiveTemplate(rule.templateKey, 'sms', recipient.facility?.id ?? null)
  if (!template) {
    if (fallbackEligible) return sendEmailFallback(idempotencyKey, rule, recipient, context, base)
    await writeMessage(idempotencyKey, {
      ...base, templateVersion: 0, toAddress: phone!, subject: null, body: '',
      status: 'failed', error: `no active sms template for "${rule.templateKey}"`, channel: 'sms',
    })
    return 'failed'
  }

  let bodyText: string
  try {
    // FR-11: every SMS carries the opt-out/help line. Appended here, not
    // authored per template, for the same reason the postal footer is
    // appended centrally — a template author cannot forget it.
    bodyText = `${renderString(template.bodyText, context, template.requiredMergeFields)} Reply STOP to opt out, HELP for help.`
  } catch (error) {
    if (error instanceof RenderError) {
      await writeMessage(idempotencyKey, {
        ...base, templateVersion: template.version, toAddress: phone!, subject: null, body: '',
        status: 'failed', error: error.message, channel: 'sms',
      })
      return 'failed'
    }
    throw error
  }

  const consentRow = await prisma.consent.findFirst({
    where: { tenantId: recipient.tenantId!, channel: 'account_sms', state: 'granted' },
    orderBy: { capturedAt: 'desc' },
    select: { id: true },
  })

  await writeMessage(idempotencyKey, {
    ...base, templateVersion: template.version, toAddress: effectiveSmsRecipient(phone!),
    subject: null, body: bodyText, status: 'queued', channel: 'sms', consentId: consentRow?.id ?? null,
  })

  const result = await selectSmsProvider().sendSms({
    to: effectiveSmsRecipient(phone!),
    messagingServiceSid: messagingServiceSid!,
    body: bodyText,
    idempotencyKey,
  })

  if (result.ok) {
    await writeMessage(idempotencyKey, {
      ...base, templateVersion: template.version, toAddress: effectiveSmsRecipient(phone!),
      subject: null, body: bodyText, status: 'sent', providerMessageId: result.providerMessageId,
      sentAt: now, channel: 'sms', consentId: consentRow?.id ?? null,
    })
    return 'sent'
  }

  await writeMessage(idempotencyKey, {
    ...base, templateVersion: template.version, toAddress: effectiveSmsRecipient(phone!),
    subject: null, body: bodyText, status: 'failed', error: result.message,
    channel: 'sms', consentId: consentRow?.id ?? null,
  })
  // FR-7 lists a provider-reported failure as a fallback trigger too, not
  // just a retry candidate — this catches the SYNCHRONOUS ones (network
  // failure, an immediate 4xx from Twilio). The async case FR-15 also names
  // — "undelivered/carrier filtered", which only Twilio's later delivery-
  // status webhook can report — has no consumer yet; left behind alongside
  // that webhook (see PROGRESS.md).
  if (fallbackEligible) return sendEmailFallback(idempotencyKey, rule, recipient, context, base)
  if (result.retryable) throw new Error(`comms provider send failed: ${result.message}`)
  return 'failed'
}

async function deliverForRule(
  event: DomainEvent,
  rule: ResolvedRule,
  recipient: Recipient,
  context: MergeContext,
): Promise<DeliveryOutcome> {
  const idempotencyKey = messageIdempotencyKey(event.id, rule.id, recipient.recipientKey, CHANNEL)

  // Idempotent hit: a redelivery of an already-settled send does nothing. Only
  // queued/failed rows are re-attempted below.
  const existing = await prisma.message.findUnique({ where: { idempotencyKey }, select: { status: true } })
  if (existing && ['sent', 'delivered', 'suppressed', 'cancelled'].includes(existing.status)) {
    return 'skipped'
  }

  const base = {
    event,
    ruleId: rule.id,
    templateKey: rule.templateKey,
    classification: rule.classification,
    recipient,
  }

  // FR-18: premise still valid?
  const skip = await firstFiringSkip(rule, recipient, event)
  if (skip) {
    await writeMessage(idempotencyKey, {
      ...base,
      templateVersion: 0,
      toAddress: recipient.email ?? '',
      subject: null,
      body: '',
      status: 'cancelled',
      error: `skipped: ${skip}`,
    })
    return 'cancelled'
  }

  // No reachable email is a real dead-end (CN-19 will make this a staff task);
  // recorded as a failure so it is visible rather than silently dropped.
  if (!recipient.email) {
    await writeMessage(idempotencyKey, {
      ...base,
      templateVersion: 0,
      toAddress: '',
      subject: null,
      body: '',
      status: 'failed',
      error: 'no reachable email address',
    })
    return 'failed'
  }
  const address = recipient.email.toLowerCase()

  // CN-13: the tenant turned this category+channel off in the preference
  // center. Checked after the skip predicates (a stale premise is a
  // different reason not to send) but before suppression, since this is a
  // choice, not a bounce.
  if (!(await notificationAllowed(recipient.tenantId, rule.category, CHANNEL))) {
    await writeMessage(idempotencyKey, {
      ...base,
      templateVersion: 0,
      toAddress: address,
      subject: null,
      body: '',
      status: 'cancelled',
      error: 'skipped: notification_preference_off',
    })
    return 'cancelled'
  }

  const suppression = await suppressionFor(address, rule.classification, CHANNEL)
  if (suppression) {
    await writeMessage(idempotencyKey, {
      ...base,
      templateVersion: 0,
      toAddress: address,
      subject: null,
      body: '',
      status: 'suppressed',
      suppressionReason: suppression,
      error: `suppressed: ${suppression}`,
    })
    return 'suppressed'
  }

  // FR-MSG-5, enforced centrally rather than as an opt-in skip condition a new
  // marketing rule could forget to list — the same reasoning the postal footer
  // below uses. Retroactively covers B-071's `review_request`, which predates
  // this file.
  if (rule.classification === 'marketing') {
    const timezone = recipient.facility?.timezone ?? 'America/Chicago'
    if (isMarketingQuietHours(new Date(), timezone)) {
      await writeMessage(idempotencyKey, {
        ...base,
        templateVersion: 0,
        toAddress: address,
        subject: null,
        body: '',
        status: 'cancelled',
        error: 'skipped: marketing_quiet_hours',
      })
      return 'cancelled'
    }

    // "Max 1 marketing email/day/contact ACROSS SEQUENCES" — keyed on the
    // address, which is the one identity a tenant and a lead both have; a lead
    // has no `recipientTenantId` to match against. A rolling 24h window rather
    // than a facility-local calendar day: simpler, and it is the stricter
    // reading — a calendar-day boundary would let two sends land three minutes
    // apart across midnight and still call that "once a day".
    const rollingDayAgo = new Date(new Date().getTime() - 24 * 3_600_000)
    const sentToday = await prisma.message.findFirst({
      where: {
        toAddress: address,
        classification: 'marketing',
        status: { in: ['sent', 'delivered'] },
        sentAt: { gte: rollingDayAgo },
      },
      select: { id: true },
    })
    if (sentToday) {
      await writeMessage(idempotencyKey, {
        ...base,
        templateVersion: 0,
        toAddress: address,
        subject: null,
        body: '',
        status: 'cancelled',
        error: 'skipped: marketing_daily_cap',
      })
      return 'cancelled'
    }
  }

  const template = await effectiveTemplate(rule.templateKey, CHANNEL, recipient.facility?.id ?? null)
  if (!template) {
    await writeMessage(idempotencyKey, {
      ...base,
      templateVersion: 0,
      toAddress: address,
      subject: null,
      body: '',
      status: 'failed',
      error: `no active template for "${rule.templateKey}"`,
    })
    return 'failed'
  }

  let rendered
  try {
    rendered = renderEmail(template, context)
  } catch (error) {
    // FR-9: a missing merge field blocks the send loudly. Recorded as failed
    // (the evidence a future delivery dashboard surfaces) rather than thrown,
    // so a sibling rule's message on the same event still goes out.
    if (error instanceof RenderError) {
      await writeMessage(idempotencyKey, {
        ...base,
        templateVersion: template.version,
        toAddress: address,
        subject: null,
        body: '',
        status: 'failed',
        error: error.message,
      })
      return 'failed'
    }
    throw error
  }

  // Reserve the slot before the network call so a crash mid-send leaves a
  // queued row a retry re-attempts, and the provider's own idempotency key
  // (passed below) is the backstop against a double-send in that window.
  await writeMessage(idempotencyKey, {
    ...base,
    templateVersion: template.version,
    toAddress: effectiveRecipient(address),
    subject: rendered.subject,
    body: rendered.text,
    status: 'queued',
  })

  // CN-17. The facility's own identity in the name and the reply-to; the
  // postal footer appended here rather than left to each template, so an edited
  // template cannot drop a CAN-SPAM requirement.
  const facility = recipient.facility
  const footerTarget = facility
    ? { name: facility.name, address: formatFacilityAddress(facility) }
    : null
  const withFooter = withPostalFooter(rendered.text, footerTarget)
  const htmlWithFooter = footerTarget
    ? `${rendered.html}<hr><p>${footerTarget.name}<br>${footerTarget.address}</p>`
    : rendered.html

  // US-13 AC2: "every marketing email includes a working one-click
  // unsubscribe." Appended here rather than left to each template, for the
  // same reason as the postal footer just above — and it is what makes
  // `suppressionFor`'s unsubscribe check reachable at all, since nothing else
  // in the system links to `/unsubscribe`.
  const isMarketing = rule.classification === 'marketing'
  const unsubscribeLink = isMarketing ? unsubscribeUrl(mintUnsubscribeToken(address), baseUrl()) : null
  const text = unsubscribeLink ? `${withFooter}\n\nUnsubscribe: ${unsubscribeLink}` : withFooter
  const html = unsubscribeLink
    ? `${htmlWithFooter}<p><a href="${unsubscribeLink}">Unsubscribe</a></p>`
    : htmlWithFooter

  const provider = selectProvider()
  const result = await provider.sendEmail({
    to: effectiveRecipient(address),
    from: fromAddress(facility?.emailFromName ?? facility?.name ?? 'Storage'),
    replyTo: facility?.emailReplyTo ?? null,
    subject: rendered.subject,
    html,
    text,
    idempotencyKey,
  })

  if (result.ok) {
    await writeMessage(idempotencyKey, {
      ...base,
      templateVersion: template.version,
      toAddress: effectiveRecipient(address),
      subject: rendered.subject,
      body: rendered.text,
      status: 'sent',
      providerMessageId: result.providerMessageId,
      sentAt: new Date(),
    })
    return 'sent'
  }

  await writeMessage(idempotencyKey, {
    ...base,
    templateVersion: template.version,
    toAddress: effectiveRecipient(address),
    subject: rendered.subject,
    body: rendered.text,
    status: 'failed',
    error: result.message,
  })
  // A transient provider error re-runs the whole event on the next dispatch;
  // already-sent siblings skip on their idempotency key, only this one retries.
  if (result.retryable) throw new Error(`comms provider send failed: ${result.message}`)
  return 'failed'
}

export type CommsResult = {
  paused: boolean
  sent: number
  suppressed: number
  cancelled: number
  failed: number
  skipped: number
  /// B-074 FR-8. Queued for the facility's next SMS quiet-hours window —
  /// `retryDeferredSmsMessages` (the hourly cron sweep) is what resolves these.
  deferred: number
}

/// Processes one domain event through every rule that maps to it. Called by the
/// comms consumer (jobs/registry) on each dispatch; idempotent, so an
/// at-least-once redelivery is safe.
///
/// `now` defaults to the real clock — every production call site wants that —
/// and is only ever overridden by a test that needs FR-8's quiet-hours check
/// to see a specific instant rather than whatever the wall clock says when
/// the test happens to run.
export async function processCommsEvent(event: DomainEvent, now: Date = new Date()): Promise<CommsResult> {
  const result: CommsResult = {
    paused: false,
    sent: 0,
    suppressed: 0,
    cancelled: 0,
    failed: 0,
    skipped: 0,
    deferred: 0,
  }

  // FR-20 kill switch: nothing goes out, and the event is settled without a
  // Message row (see provider.ts on the emergency-stop, no-replay semantics).
  if (!commsEnabled()) {
    result.paused = true
    return result
  }

  const rules = await applicableRules(event)
  if (rules.length === 0) return result

  const recipient = await resolveRecipient(event)
  // No recipient resolver for this entity type yet, or the entity is gone.
  if (!recipient) return result

  // Computed once per event, not per rule — several rules on the same event
  // would otherwise re-run the same extender query redundantly.
  const extender = CONTEXT_EXTENDERS[event.name]
  const context = { ...mergeContextFor(recipient), ...(extender ? await extender(event, recipient) : {}) }

  for (const rule of rules) {
    const outcome =
      rule.channel === 'sms'
        ? await deliverSmsForRule(event, rule, recipient, context, now)
        : await deliverForRule(event, rule, recipient, context)
    result[outcome] += 1
  }
  return result
}

export type SmsRetryResult = { retried: number; stillQuiet: number; cancelled: number }

/// PRD 05 FR-8's "queue for the next window opening." Called every hourly
/// cron tick — the same hour-grained shape `sendExpiringSoonReminders` and
/// B-073's abandonment sweep already use for a check `SCHEDULED_JOBS`'
/// once-per-day granularity cannot express.
///
/// Re-sends from the STORED render (`bodySnapshot`), not a fresh one — the
/// point of a deferred send is that it is the exact message that was already
/// composed, just late, not a new one recomputed hours after the event. The
/// one thing re-checked is staleness (FR-18): a best-effort lookup of the
/// original event and rule, so a message that went moot while queued
/// (invoice paid) is cancelled here rather than sent late. "Best-effort"
/// because `Message.eventId`/`ruleId` are snapshot columns, not FKs (the
/// model's own note: "so the log outlives a pruned event or an edited rule")
/// — if either is gone, the snapshot is sent as-is rather than blocking
/// forever on a fact that can no longer be checked.
export async function retryDeferredSmsMessages(now: Date = new Date()): Promise<SmsRetryResult> {
  const deferred = await prisma.message.findMany({
    where: { status: 'deferred', channel: 'sms' },
  })

  const result: SmsRetryResult = { retried: 0, stillQuiet: 0, cancelled: 0 }

  for (const message of deferred) {
    const facility = message.facilityId
      ? await prisma.facility.findUnique({
          where: { id: message.facilityId },
          select: {
            timezone: true,
            smsQuietHoursStartHour: true,
            smsQuietHoursEndHour: true,
            smsMessagingServiceSid: true,
          },
        })
      : null

    const timezone = facility?.timezone ?? 'America/Chicago'
    const start = facility?.smsQuietHoursStartHour ?? 8
    const end = facility?.smsQuietHoursEndHour ?? 21
    if (isSmsQuietHours(now, timezone, start, end)) {
      result.stillQuiet += 1
      continue
    }

    const [event, rule] = await Promise.all([
      prisma.domainEvent.findUnique({ where: { id: message.eventId } }),
      prisma.notificationRule.findUnique({ where: { id: message.ruleId } }),
    ])
    if (event && rule) {
      const recipient = await resolveRecipient(event)
      if (recipient) {
        const skip = await firstFiringSkip(
          {
            id: rule.id,
            templateKey: rule.templateKey,
            classification: rule.classification,
            skipConditions: rule.skipConditions,
            channel: rule.channel,
            channelPolicy: rule.channelPolicy,
            category: rule.category,
          },
          recipient,
          event,
        )
        if (skip) {
          await prisma.message.update({
            where: { id: message.id },
            data: { status: 'cancelled', error: `skipped: ${skip}` },
          })
          result.cancelled += 1
          continue
        }
      }
    }

    if (!facility?.smsMessagingServiceSid) {
      // The facility's SMS was un-configured in the gap — nothing to retry
      // onto. Left `deferred` rather than failed: an operator fixing the
      // setting should not have to know this message needs re-raising.
      result.stillQuiet += 1
      continue
    }

    const providerResult = await selectSmsProvider().sendSms({
      to: message.toAddress,
      messagingServiceSid: facility.smsMessagingServiceSid,
      body: message.bodySnapshot,
      idempotencyKey: message.idempotencyKey,
    })

    await prisma.message.update({
      where: { id: message.id },
      data: providerResult.ok
        ? { status: 'sent', providerMessageId: providerResult.providerMessageId, sentAt: new Date() }
        : { status: 'failed', error: providerResult.message },
    })
    result.retried += 1
  }

  return result
}

// -- direct sends (bearer tokens that exist only once, in memory) ------------
//
// The rule/template pipeline above deliberately re-reads everything at send
// time (FR-18) — which is exactly wrong for a magic link. A reservation's raw
// token, a checkout session's resume token, an auth token: each exists only in
// the moment it is minted and is never persisted in plaintext (same rule as
// B-029's gate codes), so there is nothing for a later-run consumer to
// re-derive. These sends have to happen synchronously, in the same call that
// minted the token, with the token passed straight in — not through an event.
//
// `sendDirectEmail` reuses the pipeline's suppression check, provider and
// Message log so these sends carry the same evidence and honour the same
// kill switch/sandbox as everything else; it just skips the rule/template
// resolution a caller who already has fully-composed content doesn't need.

export type DirectEmailInput = {
  /// Deterministic and caller-owned — e.g. `reservation-confirmation:{id}`.
  /// There is no rule to derive one from, so the caller is the one thing that
  /// knows "this must never be sent twice."
  idempotencyKey: string
  /// Free-form identifier stored as evidence (Message.eventId is a plain
  /// snapshot column here, not a domain-event FK — see the model's own note).
  eventId: string
  templateKey: string
  classification: MessageClassification
  to: string
  fromName: string
  subject: string
  html: string
  text: string
  facilityId?: string | null
  recipientTenantId?: string | null
}

export type DirectSendResult = { sent: boolean; suppressed?: SuppressionReason }

export async function sendDirectEmail(input: DirectEmailInput): Promise<DirectSendResult> {
  // FR-20: the kill switch is a hard stop here too, with the same no-replay
  // shape as the event pipeline — no Message row, so nothing to catch up on
  // when it clears (the caller already returned its own success/failure to
  // whatever triggered the send).
  if (!commsEnabled()) return { sent: false }

  const existing = await prisma.message.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
    select: { status: true },
  })
  if (existing) return { sent: existing.status === 'sent' || existing.status === 'delivered' }

  const address = input.to.toLowerCase()
  const common = {
    idempotencyKey: input.idempotencyKey,
    eventId: input.eventId,
    ruleId: 'direct',
    templateKey: input.templateKey,
    templateVersion: 1,
    classification: input.classification,
    channel: CHANNEL,
    recipientTenantId: input.recipientTenantId ?? null,
    facilityId: input.facilityId ?? null,
    subjectSnapshot: input.subject,
    bodySnapshot: input.text,
  }

  const suppression = await suppressionFor(address, input.classification, CHANNEL)
  if (suppression) {
    await prisma.message.create({
      data: { ...common, toAddress: address, status: 'suppressed', suppressionReason: suppression },
    })
    return { sent: false, suppressed: suppression }
  }

  const destination = effectiveRecipient(address)
  await prisma.message.create({ data: { ...common, toAddress: destination, status: 'queued' } })

  const provider = selectProvider()
  const result = await provider.sendEmail({
    to: destination,
    from: fromAddress(input.fromName),
    subject: input.subject,
    html: input.html,
    text: input.text,
    idempotencyKey: input.idempotencyKey,
  })

  await prisma.message.update({
    where: { idempotencyKey: input.idempotencyKey },
    data: result.ok
      ? { status: 'sent', providerMessageId: result.providerMessageId, sentAt: new Date() }
      : { status: 'failed', error: result.message },
  })

  // No retry queue for a direct send (left behind, PROGRESS.md): a transient
  // provider failure here does not throw, because the caller's primary action
  // (the reservation, the checkout step) already succeeded and must not be
  // undone by a mail blip. It is visible in the Message log as `failed`.
  return { sent: result.ok }
}

// -- staff-facing helpers (thin; the management UIs are later items) ----------

/// CN-20 add-a-suppression. The management surface (search/remove) is a later
/// admin item; this is the write path other code (webhook bounce handling,
/// STOP processing) will call. Normalises the address so lookups match.
export async function suppress(
  input: { channel: 'email' | 'sms'; address: string; reason: SuppressionReason; note?: string; createdByStaffId?: string },
  client: Prisma.TransactionClient | typeof prisma = prisma,
) {
  const address = input.channel === 'email' ? input.address.toLowerCase() : input.address
  return client.suppression.upsert({
    where: { channel_address: { channel: input.channel, address } },
    create: {
      channel: input.channel,
      address,
      reason: input.reason,
      note: input.note ?? null,
      createdByStaffId: input.createdByStaffId ?? null,
    },
    // First reason wins — a manual entry must not quietly overwrite a STOP or a
    // complaint (those are the non-removable ones, CN-20).
    update: {},
  })
}
