// PRD 05 FR-2. Org-default notification rules and their templates, as data —
// mirrors rbac-catalog.ts's pattern (a catalog module the seed script upserts,
// so "add a rule" is a row in this file, not a migration). Per-facility
// overrides are rows a later admin screen (CN-16) will write directly; this
// file only ever seeds the org-level default (facilityId: null).
//
// B-030 shipped the engine with zero seeded content on purpose; these are the
// first real rules, owned by B-031 (the move-in path).

export type CommsTemplateSeed = {
  key: string
  classification: 'transactional' | 'operational' | 'marketing'
  subject: string
  bodyText: string
  requiredMergeFields: string[]
}

export type CommsRuleSeed = {
  event: string
  templateKey: string
  classification: 'transactional' | 'operational' | 'marketing'
  skipConditions?: string[]
}

export const COMMS_TEMPLATES: readonly CommsTemplateSeed[] = [
  {
    key: 'reservation_expiring_soon',
    classification: 'transactional',
    subject: 'Your hold at {{facility.name}} ends soon',
    bodyText: [
      'Hi {{tenant.first_name}},',
      '',
      "We're holding your {{unit.size}} unit at {{facility.name}} until {{reservation.expires_at}}.",
      '',
      'Use the link from your original confirmation email to complete your move-in online, or call {{facility.phone}} and we will take care of it.',
      '',
      'Nothing has been charged.',
    ].join('\n'),
    requiredMergeFields: ['tenant.first_name', 'facility.name', 'unit.size', 'reservation.expires_at', 'facility.phone'],
  },
  {
    key: 'lease_moved_in_welcome',
    classification: 'transactional',
    subject: "Welcome to {{facility.name}} — you're moved in",
    bodyText: [
      "Hi {{tenant.first_name}}, you're moved in!",
      '',
      'Your unit is {{unit.number}} at {{facility.name}}, {{facility.address}}.',
      '',
      '{{access.gate_code_line}}',
      '',
      '{{billing.first_charge_line}}',
      '',
      'Set up your online account to view your lease, payments and gate code any time: {{links.portal}}',
      '',
      'Questions? Call {{facility.phone}}.',
    ].join('\n'),
    requiredMergeFields: [
      'tenant.first_name',
      'unit.number',
      'facility.name',
      'facility.address',
      'access.gate_code_line',
      'billing.first_charge_line',
      'links.portal',
      'facility.phone',
    ],
  },
  {
    key: 'lease_moved_out_confirmation',
    classification: 'transactional',
    subject: 'Your move-out from {{facility.name}} is confirmed',
    bodyText: [
      'Hi {{tenant.first_name}},',
      '',
      "You've moved out of unit {{unit.number}} at {{facility.name}}.",
      '',
      '{{billing.settlement_line}}',
      '',
      'Your gate code no longer works at this facility.',
      '',
      'Questions about anything above? Call {{facility.phone}}.',
    ].join('\n'),
    requiredMergeFields: [
      'tenant.first_name',
      'unit.number',
      'facility.name',
      'billing.settlement_line',
      'facility.phone',
    ],
  },
  {
    // PRD 01 US-707: "Confirmation email/SMS sent" the moment the tenant
    // submits the request, distinct from the finalized move-out confirmation
    // above (CN-8) — nothing here is final, no dollar figure is quoted (one
    // could go stale before staff finalize), and it says plainly that a
    // person still has to verify the unit before it is done.
    key: 'lease_move_out_requested',
    classification: 'transactional',
    subject: 'Your move-out request for {{facility.name}} is received',
    bodyText: [
      'Hi {{tenant.first_name}},',
      '',
      "We've received your request to move out of unit {{unit.number}} at {{facility.name}} on {{lease.move_out_date}}.",
      '',
      'Your account stays active and your gate code keeps working until then. Our team will confirm the unit is empty and finish closing your account after your move-out date.',
      '',
      'Changed your mind? You can cancel this request from your account any time before {{lease.move_out_date}}.',
      '',
      'Questions? Call {{facility.phone}}.',
    ].join('\n'),
    requiredMergeFields: [
      'tenant.first_name',
      'unit.number',
      'facility.name',
      'lease.move_out_date',
      'facility.phone',
    ],
  },
  // ── B-050: the payment lifecycle (PRD 05 §3.1 CN-1, CN-2, CN-6, CN-10a) ────
  //
  // House style for everything below, and the reason for it: say the amount and
  // the date in the first two lines, give exactly one link, and never imply a
  // consequence that has not happened. These go to people who are paying on
  // time far more often than not — a due-date reminder that reads like a
  // collections letter is how an operator teaches good tenants to stop opening
  // their email, and the dunning ladder (B-052) then has nobody listening.
  {
    key: 'invoice_due_soon',
    classification: 'transactional',
    subject: 'Rent for unit {{unit.number}} is due {{invoice.due_date}}',
    bodyText: [
      'Hi {{tenant.first_name}},',
      '',
      '{{invoice.amount}} is due on {{invoice.due_date}} for unit {{unit.number}} at {{facility.name}}.',
      '',
      'Pay online: {{links.pay_now}}',
      '',
      'Already paid, or paying at the office? Then nothing is needed — this crossed in the post.',
      '',
      'Questions? Call {{facility.phone}}.',
    ].join('\n'),
    requiredMergeFields: [
      'tenant.first_name',
      'invoice.amount',
      'invoice.due_date',
      'unit.number',
      'facility.name',
      'links.pay_now',
      'facility.phone',
    ],
  },
  {
    key: 'invoice_due_today',
    classification: 'transactional',
    subject: 'Rent for unit {{unit.number}} is due today',
    bodyText: [
      'Hi {{tenant.first_name}},',
      '',
      '{{invoice.amount}} is due today for unit {{unit.number}} at {{facility.name}}.',
      '',
      'Pay online: {{links.pay_now}}',
      '',
      'If you have already paid today, thank you — you can ignore this.',
      '',
      'Questions? Call {{facility.phone}}.',
    ].join('\n'),
    requiredMergeFields: [
      'tenant.first_name',
      'invoice.amount',
      'unit.number',
      'facility.name',
      'links.pay_now',
      'facility.phone',
    ],
  },
  {
    // CN-6. A receipt is a document people keep and forward to an accountant,
    // so it leads with the figure and the date and carries the balance — not a
    // thank-you paragraph they have to read past.
    key: 'payment_receipt',
    classification: 'transactional',
    subject: 'Receipt: {{payment.amount}} for unit {{unit.number}}',
    bodyText: [
      'Hi {{tenant.first_name}},',
      '',
      "We received {{payment.amount}} on {{payment.date}} by {{payment.method}}, for unit {{unit.number}} at {{facility.name}}.",
      '',
      'Balance on the account after this payment: {{balance.total}}.',
      '',
      'Your full payment history is in your account: {{links.portal}}',
      '',
      'Questions? Call {{facility.phone}}.',
    ].join('\n'),
    requiredMergeFields: [
      'tenant.first_name',
      'payment.amount',
      'payment.date',
      'payment.method',
      'unit.number',
      'facility.name',
      'balance.total',
      'links.portal',
      'facility.phone',
    ],
  },
  {
    // US-20's "fix path ≤5 min". One cause, one action, one link — and the
    // decline reason in plain words rather than the provider's, which is
    // written for a developer and tells a tenant nothing they can act on.
    key: 'payment_failed',
    classification: 'transactional',
    subject: "We couldn't take {{payment.amount}} for unit {{unit.number}}",
    bodyText: [
      'Hi {{tenant.first_name}},',
      '',
      '{{payment.failure_line}}',
      '',
      'The amount outstanding is {{payment.amount}} for unit {{unit.number}} at {{facility.name}}.',
      '',
      'Update your card: {{links.update_card}}',
      'Or pay another way: {{links.pay_now}}',
      '',
      'Nothing has changed about your access to the unit.',
      '',
      'Questions? Call {{facility.phone}}.',
    ].join('\n'),
    requiredMergeFields: [
      'tenant.first_name',
      'payment.failure_line',
      'payment.amount',
      'unit.number',
      'facility.name',
      'links.update_card',
      'links.pay_now',
      'facility.phone',
    ],
  },
  {
    // D-29's daily reminder. Distinct from the notice above: that one fires on
    // each decline, this one lands on three consecutive days and has to say
    // what happens next rather than repeat itself.
    key: 'payment_retry_reminder',
    classification: 'transactional',
    subject: '{{payment.amount}} is still outstanding for unit {{unit.number}}',
    bodyText: [
      'Hi {{tenant.first_name}},',
      '',
      '{{payment.amount}} is still outstanding for unit {{unit.number}} at {{facility.name}}.',
      '',
      '{{payment.retry_line}}',
      '',
      'Update your card: {{links.update_card}}',
      'Or pay another way: {{links.pay_now}}',
      '',
      'Questions? Call {{facility.phone}}.',
    ].join('\n'),
    requiredMergeFields: [
      'tenant.first_name',
      'payment.amount',
      'unit.number',
      'facility.name',
      'payment.retry_line',
      'links.update_card',
      'links.pay_now',
      'facility.phone',
    ],
  },
  {
    // CN-10a. Nothing has gone wrong and the wording must not suggest it has —
    // this is the notice that keeps a long-standing on-time tenant out of the
    // dunning ladder over something visible a month ahead.
    key: 'payment_method_expiring',
    classification: 'transactional',
    // No unit line, deliberately: a saved card belongs to the tenant, not to a
    // unit (B-036), so this event names a Tenant and its recipient has no lease
    // to read a unit number from. A tenant renting two units has one card and
    // should get one email, not two naming different doors.
    subject: 'The card on file at {{facility.name}} expires {{card.expires}}',
    bodyText: [
      'Hi {{tenant.first_name}},',
      '',
      'The card you have on file for your account at {{facility.name}} expires {{card.expires}}.',
      '',
      '{{card.urgency_line}}',
      '',
      'Update it here: {{links.update_card}}',
      '',
      'Nothing is wrong with your account, and no payment has failed — we would rather tell you now than have a payment bounce later.',
      '',
      'Questions? Call {{facility.phone}}.',
    ].join('\n'),
    requiredMergeFields: [
      'tenant.first_name',
      'facility.name',
      'card.expires',
      'card.urgency_line',
      'links.update_card',
      'facility.phone',
    ],
  },
  {
    // D-17 assigned this notice to B-050. Draft text, not legal advice (D-10).
    key: 'protection_proof_expiring',
    classification: 'transactional',
    subject: 'Your proof of insurance for unit {{unit.number}} expires {{protection.expires_on}}',
    bodyText: [
      'Hi {{tenant.first_name}},',
      '',
      'The insurance you showed us for unit {{unit.number}} at {{facility.name}} runs out on {{protection.expires_on}}.',
      '',
      'Send us the new declaration page before then and nothing changes. Call {{facility.phone}} or reply to this email and we will tell you where to send it.',
      '',
      'If we do not have current cover on file after that date, your lease may be enrolled in the facility protection plan and charged for it.',
      '',
      'Your account: {{links.portal}}',
    ].join('\n'),
    requiredMergeFields: [
      'tenant.first_name',
      'unit.number',
      'facility.name',
      'protection.expires_on',
      'facility.phone',
      'links.portal',
    ],
  },
  {
    // D-17's enrolment notice. The owner's decision requires the tenant be told
    // "of the enrolment AND its cost", so the premium is in the second line and
    // in the subject — not buried under an explanation.
    key: 'protection_auto_enrolled',
    classification: 'transactional',
    subject: 'Unit {{unit.number}} has been enrolled in {{protection.plan_name}} at {{protection.premium}}/mo',
    bodyText: [
      'Hi {{tenant.first_name}},',
      '',
      'We do not have current proof of insurance on file for unit {{unit.number}} at {{facility.name}}, so the unit has been enrolled in {{protection.plan_name}}.',
      '',
      'This adds {{protection.premium}} per month to your rent, starting with your next invoice.',
      '',
      'If you do have cover and we simply have not seen it, call {{facility.phone}} — send us the declaration page and we will remove the charge.',
      '',
      'Your account: {{links.portal}}',
    ].join('\n'),
    requiredMergeFields: [
      'tenant.first_name',
      'unit.number',
      'facility.name',
      'protection.plan_name',
      'protection.premium',
      'facility.phone',
      'links.portal',
    ],
  },
]

export const COMMS_RULES: readonly CommsRuleSeed[] = [
  { event: 'reservation.expiring_soon', templateKey: 'reservation_expiring_soon', classification: 'transactional' },
  {
    event: 'lease.moved_in',
    templateKey: 'lease_moved_in_welcome',
    classification: 'transactional',
    // Never welcome a tenant whose lease has already ended by the time the
    // event is processed (a same-day move-in/move-out, or a delayed dispatch).
    skipConditions: ['tenant_moved_out'],
  },
  {
    event: 'lease.moved_out',
    templateKey: 'lease_moved_out_confirmation',
    classification: 'transactional',
  },
  {
    event: 'lease.move_out_requested',
    templateKey: 'lease_move_out_requested',
    classification: 'transactional',
  },

  // ── B-050 ───────────────────────────────────────────────────────────────────
  {
    // CN-1. `autopay_covers_it` is the reason this item exists as more than
    // templates: a reminder to go and pay a bill the tenant's own card is about
    // to cover is worse than no reminder at all.
    event: 'invoice.due_soon',
    templateKey: 'invoice_due_soon',
    classification: 'transactional',
    skipConditions: ['autopay_covers_it', 'invoice_paid', 'tenant_moved_out'],
  },
  {
    event: 'invoice.due_today',
    templateKey: 'invoice_due_today',
    classification: 'transactional',
    skipConditions: ['autopay_covers_it', 'invoice_paid', 'tenant_moved_out'],
  },
  {
    // CN-6. No autopay skip: a receipt is exactly what an autopay tenant should
    // get, and is the only thing telling them the charge went through.
    event: 'payment.succeeded',
    templateKey: 'payment_receipt',
    classification: 'transactional',
  },
  {
    event: 'payment.failed',
    templateKey: 'payment_failed',
    classification: 'transactional',
    skipConditions: ['tenant_moved_out'],
  },
  {
    event: 'payment.retry_reminder',
    templateKey: 'payment_retry_reminder',
    classification: 'transactional',
    skipConditions: ['invoice_paid', 'tenant_moved_out'],
  },
  {
    // CN-10a. Operational rather than transactional: nothing has been charged
    // and nothing has failed — it is a heads-up about an account detail.
    event: 'payment_method.expiring',
    templateKey: 'payment_method_expiring',
    classification: 'operational',
    skipConditions: ['tenant_moved_out'],
  },
  {
    event: 'protection.proof_expiring',
    templateKey: 'protection_proof_expiring',
    classification: 'transactional',
    skipConditions: ['tenant_moved_out'],
  },
  {
    event: 'protection.auto_enrolled',
    templateKey: 'protection_auto_enrolled',
    classification: 'transactional',
  },
]
