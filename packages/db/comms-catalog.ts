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
]
