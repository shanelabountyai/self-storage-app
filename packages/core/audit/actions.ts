// The catalog of auditable actions, transcribed from PRD 02 US-38's list of
// sensitive actions. `requiresReason` marks the ones where US-38 says a reason
// code is required — recordAudit() refuses to write those without one.
//
// Adding an action here is the only way to audit something, so the catalog
// doubles as the answer to "what do we consider sensitive?".

export type AuditActionSpec = {
  action: string
  /// Human label for the admin log view.
  label: string
  requiresReason: boolean
}

export const AUDIT_ACTIONS = [
  // Money — every one of these moves or forgives money, so all require a reason.
  { action: 'fee.waived', label: 'Fee waived', requiresReason: true },
  { action: 'credit.issued', label: 'Manual credit issued', requiresReason: true },
  { action: 'balance.written_off', label: 'Balance written off', requiresReason: true },
  { action: 'refund.issued', label: 'Refund issued', requiresReason: true },
  { action: 'payment.recorded', label: 'Payment recorded', requiresReason: false },

  // Pricing
  { action: 'rate.street_changed', label: 'Street rate changed', requiresReason: false },
  { action: 'rate.tenant_increased', label: 'Tenant rate increased', requiresReason: true },

  // Tenants
  { action: 'tenant.contact_updated', label: 'Tenant contact info updated', requiresReason: false },
  { action: 'tenant.note_added', label: 'Note added to tenant', requiresReason: false },
  { action: 'document.logged', label: 'Document logged', requiresReason: false },

  // Leases and units
  { action: 'lease.edited', label: 'Lease edited', requiresReason: false },
  { action: 'lease.moved_out', label: 'Move-out completed', requiresReason: false },
  { action: 'lease.move_out_overridden', label: 'Move-out charges overridden', requiresReason: true },
  { action: 'unit.created', label: 'Unit created', requiresReason: false },
  { action: 'unit.updated', label: 'Unit updated', requiresReason: false },
  { action: 'unit.status_overridden', label: 'Unit status manually overridden', requiresReason: true },
  /// One grouped entry per bulk operation, with per-unit detail inside
  /// (PRD 02 US-7). Reason required for the same reason a single status
  /// override needs one — more so, since it touches many units at once.
  { action: 'unit.bulk_edited', label: 'Units bulk edited', requiresReason: true },
  { action: 'unit.layout_imported', label: 'Unit layout imported', requiresReason: true },
  { action: 'unit_type.created', label: 'Unit type created', requiresReason: false },
  { action: 'unit_type.updated', label: 'Unit type updated', requiresReason: false },
  { action: 'unit_type.cloned', label: 'Unit type cloned to another facility', requiresReason: false },

  // Delinquency, notices, auctions
  { action: 'delinquency.step_overridden', label: 'Delinquency step overridden', requiresReason: true },
  { action: 'delinquency.step_skipped', label: 'Delinquency step skipped', requiresReason: true },
  { action: 'notice.generated', label: 'Notice generated', requiresReason: false },
  { action: 'notice.delivered', label: 'Notice delivery recorded', requiresReason: false },
  { action: 'auction.approved', label: 'Auction eligibility approved', requiresReason: true },
  { action: 'auction.completed', label: 'Auction outcome recorded', requiresReason: false },

  // Access control (PRD 03 FR-1)
  { action: 'access.granted', label: 'Access granted', requiresReason: false },
  { action: 'access.suspended', label: 'Access suspended', requiresReason: true },
  { action: 'access.restored', label: 'Access restored', requiresReason: true },
  { action: 'access.revoked', label: 'Access revoked', requiresReason: false },
  { action: 'access.code_viewed', label: 'Gate code revealed', requiresReason: true },

  // Administration
  { action: 'facility.settings_changed', label: 'Facility settings changed', requiresReason: false },
  { action: 'user.created', label: 'Staff user created', requiresReason: false },
  { action: 'user.role_changed', label: 'Staff role changed', requiresReason: true },
  { action: 'user.deactivated', label: 'Staff user deactivated', requiresReason: true },
  { action: 'document.deleted', label: 'Document deleted', requiresReason: true },
  { action: 'drawer.over_short', label: 'Drawer over/short recorded', requiresReason: true },

  // Authentication
  { action: 'password.reset_completed', label: 'Password reset completed', requiresReason: false },
  { action: 'login.locked_out', label: 'Login locked out', requiresReason: false },
] as const satisfies readonly AuditActionSpec[]

export type AuditAction = (typeof AUDIT_ACTIONS)[number]['action']

const BY_ACTION = new Map<string, AuditActionSpec>(
  AUDIT_ACTIONS.map((spec) => [spec.action, spec]),
)

export function auditActionSpec(action: string): AuditActionSpec | undefined {
  return BY_ACTION.get(action)
}

export function requiresReasonCode(action: string): boolean {
  return BY_ACTION.get(action)?.requiresReason ?? false
}

/// Suggested reason codes. Free text is allowed — this is a starting vocabulary
/// so the log stays filterable rather than a prose field.
export const REASON_CODES = [
  'customer_goodwill',
  'billing_error',
  'system_error',
  'management_approval',
  'legal_requirement',
  'duplicate',
  'collections_uneconomic',
  'security_incident',
  'other',
] as const
