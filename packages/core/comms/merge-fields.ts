// PRD 05 CN-16 (B-053). Which merge fields a template may use, what each one
// means, and what it looks like.
//
// Three things need this and they must not disagree:
//   * the editor's field picker, "restricted to that template's event schema"
//   * the publish gate — "a template with unknown/missing merge fields cannot
//     be published"
//   * the preview, which needs a plausible value for every field
//
// Before this file, the only statement of what a template could use was the
// `requiredMergeFields` array on each seeded row — which says what a template
// DOES use, not what it MAY. Publishing was therefore unguarded: an operator
// could save `{{tenant.middle_name}}`, and the first anyone would know is a
// send failing at render time, in a job, at 2am.

export type MergeFieldSpec = {
  field: string
  /// Shown beside the field in the picker. Written for an operator, not a
  /// developer — "what the tenant owes right now", never "ledger sum".
  description: string
  /// Used by the preview. Realistic rather than obviously fake: a preview
  /// showing "XXX" tells an operator nothing about whether the sentence reads.
  sample: string
}

/// Available on every template, from the recipient's own row.
export const STANDARD_MERGE_FIELDS: readonly MergeFieldSpec[] = [
  { field: 'tenant.first_name', description: 'Tenant’s first name', sample: 'Ada' },
  { field: 'tenant.last_name', description: 'Tenant’s last name', sample: 'Renter' },
  { field: 'facility.name', description: 'Facility name', sample: 'Austin — South Congress' },
  { field: 'facility.phone', description: 'Facility phone number', sample: '512-555-0100' },
  {
    field: 'facility.address',
    description: 'Facility postal address',
    sample: '2400 South Congress Ave, Austin, TX 78704',
  },
  { field: 'links.portal', description: 'Link to the tenant’s account', sample: 'https://example.com/login' },
]

/// Available only on templates whose event supplies them. Keyed by event name,
/// mirroring `CONTEXT_EXTENDERS` in the comms service — if a field is added
/// there it belongs here too, and the test below is what enforces that.
export const EVENT_MERGE_FIELDS: Record<string, readonly MergeFieldSpec[]> = {
  'lease.moved_in': [
    { field: 'unit.number', description: 'Unit number', sample: 'A-12' },
    { field: 'unit.size', description: 'Unit size', sample: '10x10' },
    // D-55 (B-106 part 5). A multi-unit checkout emits ONE move-in event, so
    // the welcome names every unit it covers rather than only the primary one
    // `unit.number` resolves to. Reads "A-12" for a single unit and
    // "A-12, B-04 and C-11" for three, so one template serves both without a
    // conditional the template language does not have.
    { field: 'unit.number_list', description: 'Every unit this move-in covers', sample: 'A-12 and B-04' },
    { field: 'access.gate_code_line', description: 'The gate-code sentence, or a fallback if no code is issued yet', sample: 'Your gate code is 4821.' },
    { field: 'billing.first_charge_line', description: 'What was charged today and what recurs', sample: 'You were charged $161.00 today. After that, rent is $129.00/mo, billed on day 12 of each month.' },
  ],
  'lease.moved_out': [
    { field: 'unit.number', description: 'Unit number', sample: 'A-12' },
    { field: 'billing.settlement_line', description: 'How the account settled', sample: 'Your account is settled in full — nothing further is owed.' },
  ],
  'lease.move_out_requested': [
    { field: 'unit.number', description: 'Unit number', sample: 'A-12' },
    { field: 'lease.move_out_date', description: 'The move-out date requested', sample: 'September 30, 2026' },
  ],
  'lease.transfer_requested': [
    { field: 'unit.number', description: 'The unit they are in now', sample: 'A-12' },
    { field: 'transfer.to_unit_number', description: 'The unit they asked to move into', sample: 'B-04' },
    { field: 'transfer.date', description: 'The date they asked to move', sample: 'September 30, 2026' },
  ],
  // PRD 10 §6.3 (B-101). One entry per RECIPIENT event — the split exists so
  // each message can address one person; see the event catalog's own note.
  'referral.qualified': [
    {
      field: 'referral.reward_line',
      description: 'What the referrer gets and when',
      sample: '$50.00 comes off your next invoice.',
    },
  ],
  'referral.reward_granted': [
    {
      field: 'referral.reward_line',
      description: 'What the new tenant gets and when',
      sample: '$50.00 comes off your first invoice.',
    },
  ],
  'referral.refused': [
    {
      field: 'referral.refusal_reason',
      description: 'Which rule refused the referral, in plain language',
      sample: 'Your friend has rented with us before. The reward is for new customers only, so a returning tenant does not qualify.',
    },
  ],
  'reservation.expiring_soon': [
    { field: 'unit.size', description: 'Unit size held', sample: '10x10' },
    { field: 'reservation.expires_at', description: 'When the hold ends', sample: 'Friday, September 12 at 5:00 PM' },
  ],
  // B-140. Same shape as the reservation-hold reminder above — this is the
  // transfer-hold's own event, not a variant read of the other one.
  'reservation.transfer_hold_expiring_soon': [
    { field: 'unit.size', description: 'Unit size held for the transfer', sample: '10x10' },
    { field: 'reservation.expires_at', description: 'When the transfer hold ends', sample: 'Friday, September 12 at 5:00 PM' },
  ],
  'invoice.due_soon': [
    { field: 'unit.number', description: 'Unit number', sample: 'A-12' },
    { field: 'invoice.number', description: 'Invoice number', sample: '000142' },
    { field: 'invoice.amount', description: 'Amount outstanding on the invoice', sample: '$129.00' },
    { field: 'invoice.due_date', description: 'When it is due', sample: 'Tuesday, September 1' },
    { field: 'links.pay_now', description: 'One-tap link to pay', sample: 'https://example.com/pay/abc123' },
  ],
  'invoice.due_today': [
    { field: 'unit.number', description: 'Unit number', sample: 'A-12' },
    { field: 'invoice.number', description: 'Invoice number', sample: '000142' },
    { field: 'invoice.amount', description: 'Amount outstanding on the invoice', sample: '$129.00' },
    { field: 'invoice.due_date', description: 'When it is due', sample: 'Tuesday, September 1' },
    { field: 'links.pay_now', description: 'One-tap link to pay', sample: 'https://example.com/pay/abc123' },
  ],
  'payment.succeeded': [
    { field: 'unit.number', description: 'Unit number', sample: 'A-12' },
    { field: 'payment.amount', description: 'Amount received', sample: '$129.00' },
    { field: 'payment.date', description: 'When it was received', sample: 'September 1, 2026' },
    { field: 'payment.method', description: 'How they paid', sample: 'card' },
    { field: 'balance.total', description: 'Balance after this payment', sample: '$0.00' },
  ],
  'payment.failed': [
    { field: 'unit.number', description: 'Unit number', sample: 'A-12' },
    { field: 'payment.amount', description: 'Amount that could not be taken', sample: '$129.00' },
    { field: 'payment.failure_line', description: 'Why it failed, in plain words', sample: 'Your bank declined the payment.' },
    { field: 'links.update_card', description: 'Link to update the card', sample: 'https://example.com/portal/methods' },
    { field: 'links.pay_now', description: 'One-tap link to pay', sample: 'https://example.com/pay/abc123' },
  ],
  'payment.retry_reminder': [
    { field: 'unit.number', description: 'Unit number', sample: 'A-12' },
    { field: 'payment.amount', description: 'Amount outstanding', sample: '$129.00' },
    { field: 'payment.retry_line', description: 'What happens next', sample: 'We will try the card again automatically.' },
    { field: 'links.update_card', description: 'Link to update the card', sample: 'https://example.com/portal/methods' },
    { field: 'links.pay_now', description: 'One-tap link to pay', sample: 'https://example.com/pay/abc123' },
  ],
  'payment_method.expiring': [
    { field: 'card.expires', description: 'When the card expires', sample: '11/2026' },
    { field: 'card.urgency_line', description: 'How soon they should act', sample: 'There is no rush — any time in the next few weeks is fine.' },
    { field: 'links.update_card', description: 'Link to update the card', sample: 'https://example.com/portal/methods' },
  ],
  'delinquency.day_reached': [
    { field: 'unit.number', description: 'Unit number', sample: 'A-12' },
    { field: 'balance.total', description: 'What the tenant owes right now', sample: '$149.00' },
    { field: 'dunning.subject_line', description: 'Subject wording for this step', sample: 'Your balance is still outstanding' },
    { field: 'dunning.tone_line', description: 'Opening line, firmer at each step', sample: 'Your balance is still outstanding, and a late fee may now have been added.' },
    { field: 'dunning.consequence_line', description: 'What happens next, at this step', sample: 'Please settle it when you can, or call us and we will work something out.' },
    { field: 'dunning.days_past_due', description: 'How many days past due', sample: '5' },
    { field: 'links.pay_now', description: 'One-tap link to pay', sample: 'https://example.com/pay/abc123' },
  ],
  'access.suspended': [
    { field: 'unit.number', description: 'Unit number', sample: 'A-12' },
    { field: 'access.days_past_due', description: 'How many days past due', sample: '6' },
    { field: 'balance.total', description: 'What must be cleared to restore access', sample: '$149.00' },
    { field: 'links.pay_now', description: 'One-tap link to pay', sample: 'https://example.com/pay/abc123' },
  ],
  'access.restored': [{ field: 'unit.number', description: 'Unit number', sample: 'A-12' }],
  // B-063 / PRD 05 CN-11. The remaining stage notice — a physical lock, not the
  // gate. Same field names as `access.suspended` on purpose: it is the same
  // kind of fact (what is blocked, how much clears it), told about a different
  // enforcement action.
  'overlock.required': [
    { field: 'unit.number', description: 'Unit number', sample: 'A-12' },
    { field: 'access.days_past_due', description: 'How many days past due', sample: '10' },
    { field: 'balance.total', description: 'What must be paid to have the lock removed', sample: '$258.00' },
    { field: 'links.pay_now', description: 'One-tap link to pay', sample: 'https://example.com/pay/abc123' },
  ],
  'overlock.cleared': [{ field: 'unit.number', description: 'Unit number', sample: 'A-12' }],
  // B-063 / PRD 05 CN-12. The courtesy supplement — never the statutory notice.
  // `notice.balance` and `notice.deadline_date` are read from the notice's own
  // stored snapshot, not recomputed, so the email can never quote a different
  // figure than the document it is telling the tenant about.
  'notice.generated': [
    { field: 'unit.number', description: 'Unit number', sample: 'A-12' },
    { field: 'notice.balance', description: 'The balance stated on the generated notice', sample: '$387.00' },
    { field: 'notice.deadline_date', description: 'The deadline stated on the generated notice', sample: 'September 15, 2026' },
    { field: 'links.pay_now', description: 'One-tap link to pay', sample: 'https://example.com/pay/abc123' },
  ],
  'protection.proof_expiring': [
    { field: 'unit.number', description: 'Unit number', sample: 'A-12' },
    { field: 'protection.expires_on', description: 'When their cover runs out', sample: 'September 15, 2026' },
  ],
  // B-071 / PRD 04 US-7. `links.google_review` is the facility's own setting
  // (`Facility.googleReviewUrl`) — the job that raises this event already
  // refuses to for a facility that has not configured one.
  'review.requested': [
    { field: 'unit.number', description: 'Unit number', sample: 'A-12' },
    { field: 'links.google_review', description: 'The facility’s Google review link', sample: 'https://g.page/r/example/review' },
  ],
  // B-072 / PRD 04 US-14. All three lead-drip templates draw from this one
  // set — `lead.promo_line` is empty outside step 3's own send, since it is
  // computed fresh at send time rather than carried on the event.
  'lead.drip_step': [
    { field: 'unit.size', description: 'The size they asked about', sample: '10x10' },
    { field: 'lead.quoted_price', description: 'Current price for the size they asked about', sample: '$129.00/mo' },
    { field: 'lead.promo_line', description: 'The live promo’s terms, when one applies', sample: '50% off your first month' },
    { field: 'links.facility_page', description: 'Link to the facility’s own page', sample: 'https://example.com/storage/tx/austin/south-congress' },
  ],
  // B-073 / PRD 04 US-9. All three abandonment templates draw from this one
  // set — `checkout.promo_line` is empty whenever no promo is currently live,
  // same as `lead.promo_line`.
  'checkout.abandonment_step': [
    { field: 'unit.size', description: 'The size they were checking out', sample: '10x10' },
    { field: 'checkout.quoted_price', description: 'The price they were quoted', sample: '$129.00/mo' },
    { field: 'checkout.promo_line', description: 'The live promo’s terms, when one applies', sample: '50% off your first month' },
    { field: 'links.resume_checkout', description: 'Link that resumes their checkout where they left off', sample: 'https://example.com/checkout/resume/abc123' },
  ],
  // B-077 / PRD 02 US-14. The tenant's confirmation that they have moved
  // units. Not a notice with a legal deadline like CN-9's below — a receipt
  // for something they asked for and just did at the counter — so what it
  // carries is the two unit numbers and what it cost.
  'lease.transferred': [
    { field: 'transfer.from_unit', description: 'The unit they left', sample: 'A-12' },
    { field: 'transfer.to_unit', description: 'The unit they moved into', sample: 'B-04' },
    { field: 'transfer.new_rate', description: 'What the new unit costs per month', sample: '$149.00' },
    { field: 'transfer.date', description: 'The day the transfer took effect', sample: 'October 1, 2026' },
    {
      field: 'transfer.settlement_line',
      description: 'What was charged or credited today, in one sentence',
      sample: 'You were charged $32.10 today for the rest of this billing period.',
    },
  ],
  // B-076 / PRD 05 CN-9. The AC names all four exactly: "merge fields include
  // old rate, new rate, effective date, and the governing notice-period."
  // Every one is `required` on the template, so CN-9's "send is blocked (loud
  // failure to admin) if any merge field is missing" is enforced by the
  // ordinary render guard rather than a special case — a rate letter with a
  // blank effective date is worse than no letter.
  'lease.rate_increase_scheduled': [
    { field: 'unit.number', description: 'Unit number', sample: 'A-12' },
    { field: 'rate.old', description: 'What they pay now', sample: '$129.00' },
    { field: 'rate.new', description: 'What they will pay', sample: '$149.00' },
    { field: 'rate.effective_date', description: 'When the new rate starts', sample: 'October 1, 2026' },
    { field: 'rate.notice_days', description: 'The notice period this gives', sample: '30' },
  ],
  'protection.auto_enrolled': [
    { field: 'unit.number', description: 'Unit number', sample: 'A-12' },
    { field: 'protection.plan_name', description: 'The plan they were enrolled in', sample: 'Standard cover' },
    { field: 'protection.premium', description: 'What it costs per month', sample: '$14.00' },
  ],

  // ── PRD 05 CN-24 (B-191). The payment plan's four messages. ────────────────
  //
  // `plan.collection_line` is on two of them and says the same thing in both:
  // whether the card will actually be charged. It reports what D-97 calls the
  // EFFECTIVE answer — the plan's own opt-in AND autopay on AND a card saved —
  // because telling a tenant a payment is taken care of when nothing will take
  // it is how somebody ends up in collections believing they kept to the plan.
  'payment_plan.agreed': [
    { field: 'unit.number', description: 'Unit number', sample: 'A-12' },
    { field: 'plan.total', description: 'What the whole plan covers', sample: '$1,800.00' },
    {
      field: 'plan.schedule',
      description: 'Every installment, one per line, with its date and amount',
      sample: '1. September 15, 2026 — $600.00\n2. October 15, 2026 — $600.00\n3. November 15, 2026 — $600.00',
    },
    {
      field: 'plan.collection_line',
      description: 'Whether each payment is taken from their card automatically',
      sample: 'We will take each payment from your card on file on the date shown.',
    },
    { field: 'links.plan', description: 'Link to the plan in their account', sample: 'https://example.com/portal/payment-plan' },
  ],
  'payment_plan.installment_due_soon': [
    { field: 'unit.number', description: 'Unit number', sample: 'A-12' },
    { field: 'plan.installment_amount', description: 'What this installment is', sample: '$600.00' },
    { field: 'plan.installment_due_date', description: 'When it is due', sample: 'Tuesday, September 15' },
    {
      field: 'plan.collection_line',
      description: 'Whether this payment is taken from their card automatically',
      sample: 'We will take this payment from your card on file on the due date.',
    },
    { field: 'links.pay_now', description: 'One-tap link to pay', sample: 'https://example.com/pay/abc123' },
  ],
  'payment_plan.broken': [
    { field: 'unit.number', description: 'Unit number', sample: 'A-12' },
    { field: 'plan.balance', description: 'What is owed now the plan has ended', sample: '$1,200.00' },
    { field: 'links.pay_now', description: 'One-tap link to pay', sample: 'https://example.com/pay/abc123' },
  ],
  'payment_plan.completed': [
    { field: 'unit.number', description: 'Unit number', sample: 'A-12' },
    { field: 'plan.total', description: 'What the plan covered in total', sample: '$1,800.00' },
  ],
}

/// Every field a template for this event may use.
export function availableFieldsFor(event: string): MergeFieldSpec[] {
  return [...STANDARD_MERGE_FIELDS, ...(EVENT_MERGE_FIELDS[event] ?? [])].sort((a, b) =>
    a.field.localeCompare(b.field),
  )
}

/// A plausible context for the preview, so an operator sees the sentence rather
/// than the placeholders.
export function sampleContextFor(event: string): Record<string, string> {
  return Object.fromEntries(availableFieldsFor(event).map((spec) => [spec.field, spec.sample]))
}

const PLACEHOLDER = /\{\{\s*([\w.]+)\s*\}\}/g

/// Every `{{field}}` a template body references.
export function fieldsUsedIn(...parts: (string | null | undefined)[]): string[] {
  const used = new Set<string>()
  for (const part of parts) {
    for (const match of (part ?? '').matchAll(PLACEHOLDER)) used.add(match[1])
  }
  return [...used].sort()
}

export type PublishCheck = {
  ok: boolean
  /// Referenced by the template but not supplied by its event. These are the
  /// ones that would fail at send time, in a job, at 2am — which is exactly
  /// what CN-16's publish gate exists to prevent.
  unknown: string[]
  /// Used in the body and not declared required. Not an error: a field can be
  /// legitimately optional. Surfaced so the editor can offer to add them.
  undeclared: string[]
}

/// CN-16: "a template with unknown/missing merge fields cannot be published."
///
/// Unknown fields BLOCK. Undeclared-but-known fields are reported and allowed —
/// requiring every referenced field would stop an operator writing a line that
/// is fine to render empty, and the render guard already refuses to send a
/// message with a placeholder left in it.
export function checkPublishable(input: {
  event: string
  subject?: string | null
  bodyText: string
  requiredMergeFields: readonly string[]
}): PublishCheck {
  const available = new Set(availableFieldsFor(input.event).map((spec) => spec.field))
  const used = fieldsUsedIn(input.subject, input.bodyText)

  const unknown = used.filter((field) => !available.has(field))
  // A required field that the event cannot supply is unknown too, and worse:
  // it would fail EVERY send rather than only the ones that reference it.
  for (const field of input.requiredMergeFields) {
    if (!available.has(field) && !unknown.includes(field)) unknown.push(field)
  }

  return {
    ok: unknown.length === 0,
    unknown: unknown.sort(),
    undeclared: used.filter(
      (field) => available.has(field) && !input.requiredMergeFields.includes(field),
    ),
  }
}
