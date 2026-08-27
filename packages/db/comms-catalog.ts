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
  /// B-074. Defaults to 'email' — every template before this item is email,
  /// and stays that way with no change to its own entry.
  channel?: 'email' | 'sms'
  /// Email subject. Omit for an SMS template — schema's own rule ("null for
  /// SMS") applies here too.
  subject?: string
  bodyText: string
  requiredMergeFields: string[]
}

export type CommsRuleSeed = {
  event: string
  templateKey: string
  classification: 'transactional' | 'operational' | 'marketing'
  skipConditions?: string[]
  /// B-074. Defaults to 'email'.
  channel?: 'email' | 'sms'
  /// B-074 FR-7. Defaults to 'email_only'. Only meaningful on an sms-channel
  /// rule — `sms_preferred_email_fallback` is what makes the sibling
  /// email-channel MessageTemplate (same key) reachable when SMS is not
  /// viable for this send.
  channelPolicy?: 'email_only' | 'sms_only' | 'both' | 'sms_preferred_email_fallback'
  /// B-074 CN-13. Which preference-center row governs this rule. Omit for
  /// legally-significant and marketing events — those are never toggle-off.
  category?: 'payment_reminders' | 'receipts' | 'operational_notices'
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
    // CN-23 / B-140. The transfer-hold twin of `reservation_expiring_soon`
    // above. No move-in link (D-82 ensures none exists for a transfer) and
    // no "nothing has been charged" line (nothing was ever quoted online) —
    // it names the unit, the absolute expiry time (PRD 01 §6.8.1: never a
    // countdown), and sends the tenant to the office, the only place D-82's
    // transfer flow is actually finished.
    key: 'transfer_hold_expiring_soon',
    classification: 'transactional',
    subject: 'Your transfer hold at {{facility.name}} ends soon',
    bodyText: [
      'Hi {{tenant.first_name}},',
      '',
      "We're holding the {{unit.size}} unit for your transfer at {{facility.name}} until {{reservation.expires_at}}.",
      '',
      'To finish the move, call the office at {{facility.phone}} before then.',
      '',
      'Questions? Call {{facility.phone}}.',
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
      'Your unit is {{unit.number_list}} at {{facility.name}}, {{facility.address}}.',
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
      'unit.number_list',
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
    // B-090 part 2. The written half of "we're holding that unit for you".
    //
    // No dollar figure, for the same reason `lease_move_out_requested` quotes
    // none: the prorated total depends on the day the transfer actually
    // happens, and staff arrange that day with the tenant afterwards. A figure
    // here would be a number the tenant reasonably treats as agreed and the
    // ledger then contradicts. It names the unit, the date asked for, and that
    // nothing has moved yet — which is the part a tenant most needs in writing.
    key: 'lease_transfer_requested',
    classification: 'transactional',
    subject: 'We\u2019re holding unit {{transfer.to_unit_number}} at {{facility.name}} for you',
    bodyText: [
      'Hi {{tenant.first_name}},',
      '',
      "We've received your request to move from unit {{unit.number}} to unit {{transfer.to_unit_number}} at {{facility.name}}, on {{transfer.date}}.",
      '',
      "We're holding unit {{transfer.to_unit_number}} for you. Nothing has changed yet — unit {{unit.number}} is still yours, your gate code still works, and your rent is unchanged until the move actually happens.",
      '',
      "Our team will call to arrange a time and confirm what the change costs before anything is charged.",
      '',
      'Changed your mind? You can cancel this request from your account at any time.',
      '',
      'Questions? Call {{facility.phone}}.',
    ].join('\n'),
    requiredMergeFields: [
      'tenant.first_name',
      'unit.number',
      'transfer.to_unit_number',
      'transfer.date',
      'facility.name',
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
    // B-074. Same key as the email version above — one MessageTemplate row
    // per channel, `sms_preferred_email_fallback` picks between them.
    key: 'access_suspended',
    classification: 'transactional',
    channel: 'sms',
    bodyText:
      '{{facility.name}}: gate access for unit {{unit.number}} is paused, {{access.days_past_due}} days past due. Pay {{balance.total}} to restore it: {{links.pay_now}}',
    requiredMergeFields: [
      'unit.number',
      'facility.name',
      'access.days_past_due',
      'balance.total',
      'links.pay_now',
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
    key: 'invoice_due_soon',
    classification: 'transactional',
    channel: 'sms',
    bodyText:
      '{{facility.name}}: {{invoice.amount}} is due {{invoice.due_date}} for unit {{unit.number}}. Pay: {{links.pay_now}}',
    requiredMergeFields: ['invoice.amount', 'invoice.due_date', 'unit.number', 'facility.name', 'links.pay_now'],
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
    key: 'invoice_due_today',
    classification: 'transactional',
    channel: 'sms',
    bodyText: '{{facility.name}}: {{invoice.amount}} is due TODAY for unit {{unit.number}}. Pay: {{links.pay_now}}',
    requiredMergeFields: ['invoice.amount', 'unit.number', 'facility.name', 'links.pay_now'],
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
    key: 'payment_retry_reminder',
    classification: 'transactional',
    channel: 'sms',
    bodyText:
      '{{facility.name}}: {{payment.amount}} is still outstanding for unit {{unit.number}}. {{payment.retry_line}} Pay: {{links.pay_now}}',
    requiredMergeFields: ['payment.amount', 'unit.number', 'facility.name', 'payment.retry_line', 'links.pay_now'],
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
    key: 'payment_method_expiring',
    classification: 'operational',
    channel: 'sms',
    bodyText: '{{facility.name}}: the card on file expires {{card.expires}}. Update it: {{links.update_card}}',
    requiredMergeFields: ['facility.name', 'card.expires', 'links.update_card'],
  },
  {
    // PRD 02 US-14 (B-077). The transfer confirmation.
    //
    // Leads with the new unit number, because that is the one fact the tenant
    // needs in their pocket when they drive back — the gate code and the
    // money are secondary to "which door is mine now".
    key: 'lease_transferred',
    classification: 'transactional',
    subject: 'You’ve moved to unit {{transfer.to_unit}} at {{facility.name}}',
    bodyText: [
      'Hi {{tenant.first_name}},',
      '',
      'You’ve moved from unit {{transfer.from_unit}} to unit {{transfer.to_unit}} at {{facility.name}}, effective {{transfer.date}}.',
      '',
      'Your new rent is {{transfer.new_rate}} per month. {{transfer.settlement_line}}',
      '',
      'Your gate code is unchanged and already works on the new unit.',
      '',
      'Your account: {{links.portal}}',
      '',
      'Questions? Call {{facility.phone}}.',
    ].join('\n'),
    requiredMergeFields: [
      'tenant.first_name',
      'transfer.from_unit',
      'transfer.to_unit',
      'facility.name',
      'transfer.date',
      'transfer.new_rate',
      'transfer.settlement_line',
      'links.portal',
      'facility.phone',
    ],
  },
  {
    // PRD 05 CN-9 / PRD 02 US-11 (B-076). The rate-increase notice.
    //
    // Every one of CN-9's four merge fields is REQUIRED, which is what makes
    // its "send is blocked (loud failure to admin) if any merge field is
    // missing" true through the ordinary render guard. Draft copy, not legal
    // advice (D-10) — the notice period itself is still an open attorney
    // question, which is exactly why the letter quotes the configured figure
    // rather than asserting a number of its own.
    //
    // The tone is deliberately plain and early-paragraph: a rate increase
    // buried under three sentences of appreciation reads as an attempt to
    // hide it, and a tenant who feels tricked cancels.
    key: 'rate_increase_notice',
    classification: 'transactional',
    subject: 'Your rent for unit {{unit.number}} changes on {{rate.effective_date}}',
    bodyText: [
      'Hi {{tenant.first_name}},',
      '',
      'This is {{rate.notice_days}} days’ notice that the rent for unit {{unit.number}} at {{facility.name}} is changing.',
      '',
      'Now: {{rate.old}} per month',
      'From {{rate.effective_date}}: {{rate.new}} per month',
      '',
      'Nothing changes before {{rate.effective_date}}, and you do not need to do anything — the new amount will appear on the first invoice on or after that date.',
      '',
      'Your account: {{links.portal}}',
      '',
      'If you have questions, or this does not look right, call {{facility.phone}} and we will go through it with you.',
    ].join('\n'),
    requiredMergeFields: [
      'tenant.first_name',
      'unit.number',
      'facility.name',
      'rate.old',
      'rate.new',
      'rate.effective_date',
      'rate.notice_days',
      'links.portal',
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
    // PRD 04 US-14 AC1 (B-072). Step 1, immediate: "quote recap."
    key: 'lead_drip_quote_recap',
    classification: 'marketing',
    subject: 'Your {{unit.size}} quote at {{facility.name}}',
    bodyText: [
      'Hi {{tenant.first_name}},',
      '',
      "Thanks for asking about {{unit.size}} storage at {{facility.name}}. Current pricing is {{lead.quoted_price}}.",
      '',
      'See photos, hours and exact availability here: {{links.facility_page}}',
      '',
      'Questions, or ready to book? Call {{facility.phone}}.',
    ].join('\n'),
    requiredMergeFields: [
      'tenant.first_name',
      'unit.size',
      'facility.name',
      'lead.quoted_price',
      'links.facility_page',
      'facility.phone',
    ],
  },
  {
    // AC1, +2 days: "value/reviews email." No price repeated — this is the one
    // step that is not asking for money, which is the point of it existing
    // between a quote and a discount.
    key: 'lead_drip_value',
    classification: 'marketing',
    subject: 'What people say about {{facility.name}}',
    bodyText: [
      'Hi {{tenant.first_name}},',
      '',
      "Still thinking it over? Here's what current renters say about {{facility.name}}, and a closer look at the property: {{links.facility_page}}",
      '',
      'No pressure — call {{facility.phone}} whenever you are ready, or if you have a question we can answer faster than a web page can.',
    ].join('\n'),
    requiredMergeFields: ['tenant.first_name', 'facility.name', 'links.facility_page', 'facility.phone'],
  },
  {
    // AC1, +5 days: "promo nudge (only if an eligible promo is live)." The
    // rule below refuses to fire this template at all when no promo applies —
    // `lead.promo_line` is required so a template edit cannot accidentally
    // ship a nudge with nothing to nudge about.
    key: 'lead_drip_promo_nudge',
    classification: 'marketing',
    subject: 'A reason to book your {{unit.size}} at {{facility.name}} this week',
    bodyText: [
      'Hi {{tenant.first_name}},',
      '',
      'Right now: {{lead.promo_line}} on {{unit.size}} storage at {{facility.name}}.',
      '',
      'Book online: {{links.facility_page}}',
      '',
      'Questions? Call {{facility.phone}}.',
    ].join('\n'),
    requiredMergeFields: [
      'tenant.first_name',
      'unit.size',
      'facility.name',
      'lead.promo_line',
      'links.facility_page',
      'facility.phone',
    ],
  },
  // ── D-51 (B-123): the marketing SMS lane's templates ──────────────────────
  //
  // Same keys as the email versions above, `channel: 'sms'` — the same
  // one-row-per-channel pattern B-074 established for `access_suspended`.
  //
  // TEMPLATES ONLY. No notification RULE dispatches any of these, deliberately
  // and per D-51: the lane ships complete and dark, because the disclosure copy
  // is awaiting the legal review PRD 04 AC3 names (Q5) and A2P 10DLC needs a
  // MARKETING campaign registered separately from the transactional one (PRD
  // 05 §6.3). Seeding the content now means the campaign registration can cite
  // real message samples — which is what a carrier review actually asks for —
  // and turning the lane on later is a rule row rather than a copywriting job.
  //
  // Written short on purpose. These are the only marketing messages in the
  // catalog that cost the recipient money to receive, and every one of them
  // gets the STOP/HELP line appended by `deliverForRule` (FR-11) on top of
  // what is here, so the body has to leave room for it inside one segment.
  {
    key: 'lead_drip_quote_recap',
    classification: 'marketing',
    channel: 'sms',
    bodyText:
      '{{facility.name}}: your {{unit.size}} quote is {{lead.quoted_price}}. Details and availability: {{links.facility_page}}',
    requiredMergeFields: [
      'facility.name',
      'unit.size',
      'lead.quoted_price',
      'links.facility_page',
    ],
  },
  {
    key: 'lead_drip_promo_nudge',
    classification: 'marketing',
    channel: 'sms',
    // `lead.promo_line` stays required here exactly as it is on the email
    // version: a nudge rendered with nothing to nudge about is a marketing text
    // sent for no reason, which on this channel the recipient pays for.
    bodyText:
      '{{facility.name}}: {{lead.promo_line}} on {{unit.size}} storage right now. Book: {{links.facility_page}}',
    requiredMergeFields: [
      'facility.name',
      'lead.promo_line',
      'unit.size',
      'links.facility_page',
    ],
  },
  // ── PRD 10 §6.3 (B-101). Refer a friend. ─────────────────────────────────
  //
  // All THREE are `transactional`, not marketing, and that is a classification
  // decision rather than a convenience: each one describes a change to money on
  // an account the recipient already holds. §6.3 says so in as many words.
  //
  // Every recipient here has an existing relationship with this business — the
  // referrer is a tenant, the referee has just moved in. Nothing in this
  // feature ever messages the PROSPECT: the invite reaches them from their
  // friend's own phone, and this system is never the sender (§5.2).
  {
    key: 'referral_qualified_referrer',
    classification: 'transactional',
    subject: 'Your referral credit is on the way',
    bodyText: [
      'Hi {{tenant.first_name}},',
      '',
      'Good news — the friend you referred to {{facility.name}} has moved in and their first payment has cleared, so your referral credit is confirmed.',
      '',
      '{{referral.reward_line}}',
      '',
      'Thank you for the recommendation. It genuinely helps.',
    ].join('\n'),
    requiredMergeFields: ['tenant.first_name', 'facility.name', 'referral.reward_line'],
  },
  {
    key: 'referral_reward_granted_referee',
    classification: 'transactional',
    subject: 'A credit is coming off your first invoice',
    bodyText: [
      'Hi {{tenant.first_name}},',
      '',
      'Welcome to {{facility.name}}. Because you came to us on a friend\u2019s invite, a credit applies to your account.',
      '',
      '{{referral.reward_line}}',
      '',
      'Nothing to do — it will be on the invoice when it arrives.',
    ].join('\n'),
    requiredMergeFields: ['tenant.first_name', 'facility.name', 'referral.reward_line'],
  },
  {
    // §5.4's AC, as a message: "a tenant asking 'why didn't I get my $50' must
    // be answerable at the counter in one screen" — and answerable without
    // them having to ask, which is what this template is for. The reason comes
    // from the same closed vocabulary the staff record and the portal read, so
    // all three say the same thing about the same refusal.
    key: 'referral_refused_referrer',
    classification: 'transactional',
    subject: 'About your referral at {{facility.name}}',
    bodyText: [
      'Hi {{tenant.first_name}},',
      '',
      'We looked at a referral on your account and it did not qualify for a credit this time. Here is why:',
      '',
      '{{referral.refusal_reason}}',
      '',
      'If that does not look right, call {{facility.phone}} and we will go through it with you.',
    ].join('\n'),
    requiredMergeFields: [
      'tenant.first_name',
      'facility.name',
      'referral.refusal_reason',
      'facility.phone',
    ],
  },
  {
    // PRD 04 US-7 (B-071). "As an operator, I get more Google reviews from
    // happy tenants." One ask, one link, no pressure — a request that reads
    // like a demand is the one most likely to get reported as spam rather
    // than acted on.
    key: 'review_request',
    classification: 'marketing',
    subject: 'How’s your unit at {{facility.name}} working out?',
    bodyText: [
      'Hi {{tenant.first_name}},',
      '',
      "You've been settled into unit {{unit.number}} at {{facility.name}} for a little while now, and we'd love to know how it's going.",
      '',
      'If you have a minute, a review helps other people find us and helps us know what we are doing right: {{links.google_review}}',
      '',
      'Thanks either way — and if anything about your unit or your account needs attention, call {{facility.phone}} and we will sort it out.',
    ].join('\n'),
    requiredMergeFields: [
      'tenant.first_name',
      'unit.number',
      'facility.name',
      'links.google_review',
      'facility.phone',
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
  {
    // PRD 04 US-9 AC1 (B-073). +1h, immediate: "you're still holding this."
    key: 'checkout_abandonment_1',
    classification: 'marketing',
    subject: 'Your {{unit.size}} at {{facility.name}} is still waiting',
    bodyText: [
      'Hi {{tenant.first_name}},',
      '',
      "You started booking a {{unit.size}} unit at {{facility.name}} for {{checkout.quoted_price}}, but didn't finish.",
      '',
      'Pick up right where you left off — same unit, same price: {{links.resume_checkout}}',
      '',
      'Questions? Call {{facility.phone}}.',
    ].join('\n'),
    requiredMergeFields: [
      'tenant.first_name',
      'unit.size',
      'facility.name',
      'checkout.quoted_price',
      'links.resume_checkout',
      'facility.phone',
    ],
  },
  {
    // AC1/AC2, +24h: a second, lower-pressure nudge — no new information, just
    // another chance to notice the email.
    key: 'checkout_abandonment_2',
    classification: 'marketing',
    subject: 'Still interested in storage at {{facility.name}}?',
    bodyText: [
      'Hi {{tenant.first_name}},',
      '',
      'Your {{unit.size}} unit at {{facility.name}} is still quoted at {{checkout.quoted_price}} — nothing has changed.',
      '',
      'Finish booking here: {{links.resume_checkout}}',
      '',
      'No rush — call {{facility.phone}} if you have a question first.',
    ].join('\n'),
    requiredMergeFields: [
      'tenant.first_name',
      'unit.size',
      'facility.name',
      'checkout.quoted_price',
      'links.resume_checkout',
      'facility.phone',
    ],
  },
  {
    // AC1, +72h: the last touch, only when a promo is actually live —
    // `checkout.promo_line` is required so this step renders as a no-op
    // (logged 'failed', nothing sent) rather than a promo-less repeat of the
    // first two, the same device `lead_drip_promo_nudge` uses.
    key: 'checkout_abandonment_3',
    classification: 'marketing',
    subject: 'Last chance: {{checkout.promo_line}} on your {{unit.size}} at {{facility.name}}',
    bodyText: [
      'Hi {{tenant.first_name}},',
      '',
      'Your {{unit.size}} unit at {{facility.name}} is still held at {{checkout.quoted_price}} — and right now, {{checkout.promo_line}}.',
      '',
      'Finish booking here: {{links.resume_checkout}}',
      '',
      'Call {{facility.phone}} if you would rather book over the phone.',
    ].join('\n'),
    requiredMergeFields: [
      'tenant.first_name',
      'unit.size',
      'facility.name',
      'checkout.quoted_price',
      'checkout.promo_line',
      'links.resume_checkout',
      'facility.phone',
    ],
  },

  // ── PRD 05 CN-24 (B-191). A payment plan's four messages. ──────────────────
  //
  // Copy is customer language throughout (D-15): no "installment status", no
  // "hold lifted", no "delinquency stage". The tenant needs the amount, the
  // date, and what happens if it is missed.
  //
  // None of the four carries `tenant_moved_out`, unlike almost every rule
  // above it, and that is deliberate: a plan is about ARREARS, which outlive
  // the tenancy. Suppressing the break notice because the lease had ended
  // would reproduce, on the one lease most likely to have one, exactly the
  // silence this rule exists to end.
  {
    key: 'payment_plan_agreed',
    classification: 'transactional',
    subject: 'Your payment plan at {{facility.name}}',
    bodyText: [
      'Hi {{tenant.first_name}},',
      '',
      'This is the payment plan we agreed for unit {{unit.number}} at {{facility.name}}. The total is {{plan.total}}.',
      '',
      '{{plan.schedule}}',
      '',
      '{{plan.collection_line}}',
      '',
      'While you keep to these dates we hold off on late fees, payment notices and turning off your gate access. If a payment is missed, the plan ends, all three start again, and the full amount becomes due.',
      '',
      'Rent for each new month is separate from this plan and is still due on its usual date.',
      '',
      'See your plan any time: {{links.plan}}',
      '',
      'Questions? Call {{facility.phone}}.',
    ].join('\n'),
    requiredMergeFields: [
      'tenant.first_name',
      'unit.number',
      'facility.name',
      'plan.total',
      'plan.schedule',
      'plan.collection_line',
      'links.plan',
      'facility.phone',
    ],
  },
  {
    // Sent whether or not the card will be charged (CN-24, and D-11a's
    // pre-charge notice precedent) — `plan.collection_line` is what makes one
    // template serve both, and a tenant who believes a payment is automatic
    // and is wrong is precisely who this exists for.
    key: 'payment_plan_installment_due_soon',
    classification: 'transactional',
    subject: 'Your payment plan installment is due {{plan.installment_due_date}}',
    bodyText: [
      'Hi {{tenant.first_name}},',
      '',
      'Your next payment plan installment for unit {{unit.number}} at {{facility.name}} is {{plan.installment_amount}}, due {{plan.installment_due_date}}.',
      '',
      '{{plan.collection_line}}',
      '',
      'If it is missed, the plan ends: the full amount you owe becomes due, late fees start again and your gate access can be turned off.',
      '',
      'Pay now: {{links.pay_now}}',
      '',
      'Questions? Call {{facility.phone}}.',
    ].join('\n'),
    requiredMergeFields: [
      'tenant.first_name',
      'unit.number',
      'facility.name',
      'plan.installment_amount',
      'plan.installment_due_date',
      'plan.collection_line',
      'links.pay_now',
      'facility.phone',
    ],
  },
  {
    // The message the whole rule exists for. It states what is owed NOW, what
    // has started again, and what it costs to put right — a plan that breaks
    // in silence is worse than no plan, because the tenant stopped watching
    // the balance on the strength of an agreement.
    key: 'payment_plan_broken',
    classification: 'transactional',
    subject: 'Your payment plan at {{facility.name}} has ended',
    bodyText: [
      'Hi {{tenant.first_name}},',
      '',
      'A payment on your plan for unit {{unit.number}} at {{facility.name}} was not made, so the plan has ended.',
      '',
      '{{plan.balance}} is now owed in full. Late fees start again from today, payment notices resume, and your gate access can be turned off.',
      '',
      'To put it right, pay {{plan.balance}} — or call {{facility.phone}} today and we will go through it with you. Talking to us is always better than leaving it.',
      '',
      'Pay now: {{links.pay_now}}',
    ].join('\n'),
    requiredMergeFields: [
      'tenant.first_name',
      'unit.number',
      'facility.name',
      'plan.balance',
      'links.pay_now',
      'facility.phone',
    ],
  },
  {
    key: 'payment_plan_completed',
    classification: 'transactional',
    subject: 'Your payment plan at {{facility.name}} is paid off',
    bodyText: [
      'Hi {{tenant.first_name}},',
      '',
      'You have paid off your payment plan for unit {{unit.number}} at {{facility.name}} — {{plan.total}} in total. Thank you for keeping to it.',
      '',
      'There is nothing left on the plan. Rent for each new month carries on as usual, due on its usual date.',
      '',
      'See your account: {{links.portal}}',
      '',
      'Questions? Call {{facility.phone}}.',
    ].join('\n'),
    requiredMergeFields: [
      'tenant.first_name',
      'unit.number',
      'facility.name',
      'plan.total',
      'links.portal',
      'facility.phone',
    ],
  },
]

export const COMMS_RULES: readonly CommsRuleSeed[] = [
  { event: 'reservation.expiring_soon', templateKey: 'reservation_expiring_soon', classification: 'transactional' },
  {
    event: 'reservation.transfer_hold_expiring_soon',
    templateKey: 'transfer_hold_expiring_soon',
    classification: 'transactional',
  },
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

  // PRD 10 §6.3 (B-101). One rule per event, and one event per RECIPIENT —
  // see the event catalog's own note for why that split exists rather than two
  // rules on a single `referral.qualified`.
  {
    event: 'referral.qualified',
    templateKey: 'referral_qualified_referrer',
    classification: 'transactional',
  },
  {
    event: 'referral.reward_granted',
    templateKey: 'referral_reward_granted_referee',
    classification: 'transactional',
  },
  {
    event: 'referral.refused',
    templateKey: 'referral_refused_referrer',
    classification: 'transactional',
  },
  {
    event: 'lease.move_out_requested',
    templateKey: 'lease_move_out_requested',
    classification: 'transactional',
  },
  {
    event: 'lease.transfer_requested',
    templateKey: 'lease_transfer_requested',
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
    // B-074 / D-35. SMS-eligible: a gate lockout is urgent enough that a
    // tenant wants to know the moment it happens, and it is a consequence of
    // non-payment rather than a "delinquency STAGE" itself (CN-13's own
    // parenthetical names dunning/lien/rate-increase, not this) — see D-35.
    event: 'access.suspended',
    templateKey: 'access_suspended',
    classification: 'transactional',
    skipConditions: ['tenant_moved_out'],
    channel: 'sms',
    channelPolicy: 'sms_preferred_email_fallback',
    category: 'operational_notices',
  },
  {
    event: 'access.restored',
    templateKey: 'access_restored',
    classification: 'transactional',
    skipConditions: ['tenant_moved_out'],
    category: 'operational_notices',
  },

  // ── B-063 (PRD 05 CN-11/CN-12). The remaining stage notices. ────────────────
  {
    event: 'overlock.required',
    templateKey: 'unit_overlocked',
    classification: 'transactional',
    skipConditions: ['tenant_moved_out', 'overlock_already_cleared'],
    category: 'operational_notices',
  },
  {
    event: 'overlock.cleared',
    templateKey: 'unit_overlock_cleared',
    classification: 'transactional',
    skipConditions: ['tenant_moved_out'],
    category: 'operational_notices',
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
    // B-074. SMS-eligible: a payment reminder is exactly what CN-13's
    // "payment reminders (email/SMS)" category names.
    event: 'invoice.due_soon',
    templateKey: 'invoice_due_soon',
    classification: 'transactional',
    skipConditions: ['autopay_covers_it', 'invoice_paid', 'tenant_moved_out'],
    channel: 'sms',
    channelPolicy: 'sms_preferred_email_fallback',
    category: 'payment_reminders',
  },
  {
    event: 'invoice.due_today',
    templateKey: 'invoice_due_today',
    classification: 'transactional',
    skipConditions: ['autopay_covers_it', 'invoice_paid', 'tenant_moved_out'],
    channel: 'sms',
    channelPolicy: 'sms_preferred_email_fallback',
    category: 'payment_reminders',
  },
  {
    // CN-6. No autopay skip: a receipt is exactly what an autopay tenant should
    // get, and is the only thing telling them the charge went through.
    // D-11a / CN-6: SMS receipts default OFF (`defaultNotificationPreference`)
    // — no SMS template is seeded for this key, so the SMS column in the
    // preference center's "Receipts" row has nothing to turn on yet either
    // way; the category exists so the EMAIL toggle works today.
    event: 'payment.succeeded',
    templateKey: 'payment_receipt',
    classification: 'transactional',
    category: 'receipts',
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
    // B-074 / D-35. SMS-eligible: distinct from `dunning_step` above (D-16's
    // delinquency-stage ladder, CN-13's "legally significant" and therefore
    // NEVER SMS) — this is the day-of-decline nudge, ordinary billing rather
    // than the collections ladder.
    event: 'payment.retry_reminder',
    templateKey: 'payment_retry_reminder',
    classification: 'transactional',
    // US-42: chasing stops on a hold. This is the one send in the current
    // catalog that is genuinely dunning rather than ordinary billing.
    skipConditions: ['invoice_paid', 'tenant_moved_out', 'lease_on_hold_dunning'],
    channel: 'sms',
    channelPolicy: 'sms_preferred_email_fallback',
    category: 'payment_reminders',
  },
  {
    // CN-10a. Operational rather than transactional: nothing has been charged
    // and nothing has failed — it is a heads-up about an account detail.
    event: 'payment_method.expiring',
    templateKey: 'payment_method_expiring',
    classification: 'operational',
    skipConditions: ['tenant_moved_out'],
    channel: 'sms',
    channelPolicy: 'sms_preferred_email_fallback',
    category: 'payment_reminders',
  },
  {
    event: 'protection.proof_expiring',
    templateKey: 'protection_proof_expiring',
    classification: 'transactional',
    skipConditions: ['tenant_moved_out'],
    category: 'operational_notices',
  },
  {
    event: 'protection.auto_enrolled',
    templateKey: 'protection_auto_enrolled',
    classification: 'transactional',
  },
  {
    // B-077 / PRD 02 US-14. No `tenant_moved_out` skip: the transfer's own
    // OLD lease is `ended` by the time this dispatches, and the event names
    // the NEW lease — but the skip predicate reads whichever lease the
    // recipient resolver found, and a tenant mid-transfer is exactly who
    // this is for. Categorised as an operational notice so the preference
    // centre can govern it like any other service message.
    event: 'lease.transferred',
    templateKey: 'lease_transferred',
    classification: 'transactional',
    category: 'operational_notices',
  },
  {
    // B-076 / PRD 05 CN-9. Email only, and no `category` — a rate increase is
    // one of the three things D-36 puts in CN-13's email-mandatory legal
    // carve-out ("delinquency stages, lien supplements, rate increases"), so
    // it is deliberately absent from the preference centre and can never be
    // toggled off.
    //
    // `tenant_moved_out` is the one skip: an increase whose lease ended
    // between the notice job raising it and the dispatcher reaching it has
    // nobody left to give notice to.
    event: 'lease.rate_increase_scheduled',
    templateKey: 'rate_increase_notice',
    classification: 'transactional',
    skipConditions: ['tenant_moved_out'],
  },

  // ── B-071 (PRD 04 US-7). ────────────────────────────────────────────────────
  {
    // `marketing`, not `transactional`: this is a solicitation, not a receipt
    // or a service notice, and the suppression matrix only respects an
    // unsubscribe/manual block for this classification — exactly the
    // protection a review ask needs even before B-072 builds explicit
    // marketing-consent capture.
    event: 'review.requested',
    templateKey: 'review_request',
    classification: 'marketing',
    skipConditions: ['tenant_moved_out', 'lease_on_hold_marketing', 'no_google_review_link'],
  },

  // ── B-072 (PRD 04 US-14). The lead drip. ────────────────────────────────────
  //
  // `no_consent` fires "no consent, no sequence" — the AC3 rule the abandoned-
  // reservation section states explicitly and this drip shares by construction.
  // `lead_exited` is FR-18 staleness: a lead can reserve, get marked lost, or
  // have its size cleared between the job raising a step and the dispatcher
  // reaching it.
  {
    event: 'lead.drip_step',
    templateKey: 'lead_drip_quote_recap',
    classification: 'marketing',
    skipConditions: ['drip_step_not_1', 'lead_exited', 'no_consent'],
  },
  {
    event: 'lead.drip_step',
    templateKey: 'lead_drip_value',
    classification: 'marketing',
    skipConditions: ['drip_step_not_2', 'lead_exited', 'no_consent'],
  },
  {
    event: 'lead.drip_step',
    templateKey: 'lead_drip_promo_nudge',
    classification: 'marketing',
    skipConditions: ['drip_step_not_3', 'lead_exited', 'no_consent'],
  },

  // ── B-073 (PRD 04 US-9 / FR-LEAD-4). The abandoned-checkout follow-up. ─────
  //
  // `checkout_session_exited` and `checkout_no_consent` are AC2's exit
  // condition and AC3's "no consent, no sequence", re-checked here for the
  // same reason the lead drip re-checks `lead_exited`/`no_consent`: the raising
  // job already filtered at raise time, but either can change in the gap
  // before the send.
  {
    event: 'checkout.abandonment_step',
    templateKey: 'checkout_abandonment_1',
    classification: 'marketing',
    skipConditions: ['abandonment_step_not_1', 'checkout_session_exited', 'checkout_no_consent'],
  },
  {
    event: 'checkout.abandonment_step',
    templateKey: 'checkout_abandonment_2',
    classification: 'marketing',
    skipConditions: ['abandonment_step_not_2', 'checkout_session_exited', 'checkout_no_consent'],
  },
  {
    event: 'checkout.abandonment_step',
    templateKey: 'checkout_abandonment_3',
    classification: 'marketing',
    skipConditions: ['abandonment_step_not_3', 'checkout_session_exited', 'checkout_no_consent'],
  },

  // ── PRD 05 CN-24 (B-191). ───────────────────────────────────────────────────
  //
  // Email only. CN-13's `payment_reminders` category governs the one message
  // of the four that is a reminder; the other three are a record of a
  // financial agreement and its end, which is not a preference to switch off.
  { event: 'payment_plan.agreed', templateKey: 'payment_plan_agreed', classification: 'transactional' },
  {
    event: 'payment_plan.installment_due_soon',
    templateKey: 'payment_plan_installment_due_soon',
    classification: 'transactional',
    // Deliberately NOT `autopay_covers_it` — CN-24 requires this one to go
    // whether or not the card will be charged, which is the opposite of
    // CN-1's rule for an ordinary invoice and is why it says so in as many
    // words. `payment_plan_not_active` is the staleness check instead: a plan
    // cancelled or broken between the raise and the send has no installment
    // due.
    skipConditions: ['payment_plan_not_active'],
    category: 'payment_reminders',
  },
  { event: 'payment_plan.broken', templateKey: 'payment_plan_broken', classification: 'transactional' },
  { event: 'payment_plan.completed', templateKey: 'payment_plan_completed', classification: 'transactional' },
]
