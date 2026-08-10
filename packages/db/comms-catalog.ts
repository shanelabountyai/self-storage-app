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
  {
    // PRD 05 CN-11 / US-45 (B-098). The tenant is told on both transitions.
    //
    // The hardest copy in the catalog: this tells someone they cannot reach
    // their own property. It says the day count, the amount, and exactly what
    // makes it stop — and it does not moralise, because the tenant already
    // knows they are behind and a lecture makes the payment less likely, not
    // more.
    key: 'access_suspended',
    classification: 'transactional',
    subject: 'Your gate access at {{facility.name}} is paused',
    bodyText: [
      'Hi {{tenant.first_name}},',
      '',
      'Your gate code for unit {{unit.number}} at {{facility.name}} has stopped working because the account is {{access.days_past_due}} days past due.',
      '',
      'Your belongings are safe and nothing has been sold or moved.',
      '',
      'Paying the balance of {{balance.total}} turns your code back on automatically, usually within a couple of minutes: {{links.pay_now}}',
      '',
      'If that is wrong, or you need to reach your unit urgently, call {{facility.phone}} and we will sort it out.',
    ].join('\n'),
    requiredMergeFields: [
      'tenant.first_name',
      'unit.number',
      'facility.name',
      'access.days_past_due',
      'balance.total',
      'links.pay_now',
      'facility.phone',
    ],
  },
  {
    key: 'access_restored',
    classification: 'transactional',
    subject: 'Your gate access at {{facility.name}} is back on',
    bodyText: [
      'Hi {{tenant.first_name}},',
      '',
      'Thank you — your account is settled and your gate code for unit {{unit.number}} at {{facility.name}} works again.',
      '',
      'If it does not let you in within a few minutes, call {{facility.phone}} and we will open the gate for you.',
    ].join('\n'),
    requiredMergeFields: ['tenant.first_name', 'unit.number', 'facility.name', 'facility.phone'],
  },
  {
    // PRD 05 CN-11 (B-063). The "remaining stage notice" this item covers — a
    // physical lock, not the gate. Same house rules as `access_suspended`: say
    // what happened, the amount, and how it stops, without moralising.
    key: 'unit_overlocked',
    classification: 'transactional',
    subject: 'A lock has been added to unit {{unit.number}} at {{facility.name}}',
    bodyText: [
      'Hi {{tenant.first_name}},',
      '',
      'Because the account for unit {{unit.number}} at {{facility.name}} is {{access.days_past_due}} days past due, we have added a lock to the unit in addition to your own.',
      '',
      'Your belongings are safe and nothing has been sold or moved.',
      '',
      'Paying {{balance.total}} clears this. Once it is paid, our team will come and remove the lock: {{links.pay_now}}',
      '',
      'If that is wrong, or you need into your unit urgently, call {{facility.phone}} and we will sort it out.',
    ].join('\n'),
    requiredMergeFields: [
      'tenant.first_name',
      'unit.number',
      'facility.name',
      'access.days_past_due',
      'balance.total',
      'links.pay_now',
      'facility.phone',
    ],
  },
  {
    key: 'unit_overlock_cleared',
    classification: 'transactional',
    subject: 'The lock on unit {{unit.number}} at {{facility.name}} has been removed',
    bodyText: [
      'Hi {{tenant.first_name}},',
      '',
      'Thank you — your account is settled and the additional lock on unit {{unit.number}} at {{facility.name}} has been removed.',
      '',
      'If you have any trouble getting into your unit, call {{facility.phone}}.',
    ].join('\n'),
    requiredMergeFields: ['tenant.first_name', 'unit.number', 'facility.name', 'facility.phone'],
  },
  {
    // PRD 05 CN-12 (B-063). A courtesy supplement, and the copy has to hold
    // that line on its own — this may be forwarded, printed, or read back in a
    // dispute with nothing else attached to it. It states plainly what it is
    // NOT, states that mail is the real notice, and never quotes a figure this
    // module computed itself: `notice.balance`/`notice.deadline_date` come
    // straight off the generated document (PRD 02's evidence chain), so this
    // email can never disagree with the paper it describes.
    key: 'pre_lien_notice_supplement',
    classification: 'transactional',
    subject: 'A formal notice about unit {{unit.number}} at {{facility.name}} has been sent',
    bodyText: [
      'Hi {{tenant.first_name}},',
      '',
      'This is a courtesy email. It is not the formal notice itself.',
      '',
      'A pre-lien notice about unit {{unit.number}} at {{facility.name}} has been sent to you by mail, as required by your lease and state law. It states a balance of {{notice.balance}}, due by {{notice.deadline_date}}.',
      '',
      'You can pay online now: {{links.pay_now}}',
      '',
      'If you have questions about the notice, or believe the balance is wrong, call {{facility.phone}}.',
    ].join('\n'),
    requiredMergeFields: [
      'tenant.first_name',
      'unit.number',
      'facility.name',
      'notice.balance',
      'notice.deadline_date',
      'links.pay_now',
      'facility.phone',
    ],
  },
  {
    key: 'lien_notice_supplement',
    classification: 'transactional',
    subject: 'A formal lien notice about unit {{unit.number}} at {{facility.name}} has been sent',
    bodyText: [
      'Hi {{tenant.first_name}},',
      '',
      'This is a courtesy email. It is not the formal notice itself.',
      '',
      'A lien notice about unit {{unit.number}} at {{facility.name}} has been sent to you by mail, as required by your lease and state law. It explains that the property stored in your unit may be sold if the balance is not paid, and states a balance of {{notice.balance}}, due by {{notice.deadline_date}}.',
      '',
      'You can pay online now: {{links.pay_now}}',
      '',
      'If you have questions about the notice, or believe the balance is wrong, call {{facility.phone}} right away.',
    ].join('\n'),
    requiredMergeFields: [
      'tenant.first_name',
      'unit.number',
      'facility.name',
      'notice.balance',
      'notice.deadline_date',
      'links.pay_now',
      'facility.phone',
    ],
  },

  {
    // PRD 05 CN-3 (B-052). The dunning ladder.
    //
    // **Tone escalation is template content, not code** — CN-3 says so
    // explicitly, and the mechanism is `dunning.tone_line` plus
    // `dunning.consequence_line`, both chosen from the step's position. That
    // keeps one rule and one template, which is what B-053's editor will hand
    // an operator to change; splitting into four templates would mean four
    // things to keep in step with each other.
    //
    // The house style from B-050 still holds and matters more here: these reach
    // people who are behind, not people who are dishonest. Every step states
    // the amount, gives one way to fix it, and says what happens next without
    // threatening anything that has not been decided.
    key: 'dunning_step',
    classification: 'transactional',
    subject: '{{dunning.subject_line}} — unit {{unit.number}}',
    bodyText: [
      'Hi {{tenant.first_name}},',
      '',
      '{{dunning.tone_line}}',
      '',
      'The balance on unit {{unit.number}} at {{facility.name}} is {{balance.total}}, {{dunning.days_past_due}} days past due.',
      '',
      'Pay now: {{links.pay_now}}',
      '',
      '{{dunning.consequence_line}}',
      '',
      'If you have already paid, or something is wrong, call {{facility.phone}} — we would rather sort it out than chase you.',
    ].join('\n'),
    requiredMergeFields: [
      'tenant.first_name',
      'unit.number',
      'facility.name',
      'balance.total',
      'dunning.subject_line',
      'dunning.tone_line',
      'dunning.consequence_line',
      'dunning.days_past_due',
      'links.pay_now',
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

  {
    // CN-3. Driven by the billing engine's day events, never a comms-side
    // calendar. The emitter already checks the holds, so this skip condition is
    // the second guard rather than the only one — a redelivered event from
    // before a hold was placed must not still send.
    event: 'delinquency.day_reached',
    templateKey: 'dunning_step',
    classification: 'transactional',
    skipConditions: ['lease_on_hold_dunning', 'tenant_moved_out'],
  },

  // ── B-098 (D-16). Both transitions are notified — US-45's own AC. ──────────
  {
    event: 'access.suspended',
    templateKey: 'access_suspended',
    classification: 'transactional',
    skipConditions: ['tenant_moved_out'],
  },
  {
    event: 'access.restored',
    templateKey: 'access_restored',
    classification: 'transactional',
    skipConditions: ['tenant_moved_out'],
  },

  // ── B-063 (PRD 05 CN-11/CN-12). The remaining stage notices. ────────────────
  {
    event: 'overlock.required',
    templateKey: 'unit_overlocked',
    classification: 'transactional',
    skipConditions: ['tenant_moved_out', 'overlock_already_cleared'],
  },
  {
    event: 'overlock.cleared',
    templateKey: 'unit_overlock_cleared',
    classification: 'transactional',
    skipConditions: ['tenant_moved_out'],
  },
  {
    // One event, two templates — the same device `delinquency.day_reached`
    // would use if its steps were not merged into one. Each rule skips the
    // other type, so exactly one of the two ever fires per notice.
    event: 'notice.generated',
    templateKey: 'pre_lien_notice_supplement',
    classification: 'transactional',
    skipConditions: ['tenant_moved_out', 'notice_type_not_pre_lien'],
  },
  {
    event: 'notice.generated',
    templateKey: 'lien_notice_supplement',
    classification: 'transactional',
    skipConditions: ['tenant_moved_out', 'notice_type_not_lien'],
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
    // Not `lease_on_hold_dunning`: a declined card is a fact the tenant needs
    // whatever else is true, and on a hold that halts autopay there will be no
    // decline to report anyway.
    skipConditions: ['tenant_moved_out'],
  },
  {
    event: 'payment.retry_reminder',
    templateKey: 'payment_retry_reminder',
    classification: 'transactional',
    // US-42: chasing stops on a hold. This is the one send in the current
    // catalog that is genuinely dunning rather than ordinary billing.
    skipConditions: ['invoice_paid', 'tenant_moved_out', 'lease_on_hold_dunning'],
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
