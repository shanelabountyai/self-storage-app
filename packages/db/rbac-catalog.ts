// The permission catalog and default role grants, transcribed from PRD 02 §3.
// Lives in packages/db because both the seed and the app's authorization checks
// need it, and drift between the two would be a security bug.
//
// Adding a capability = add a PERMISSIONS entry, grant it in ROLES, re-run the
// seed. No migration, because roles are data (master PRD §7.1).

export const PERMISSIONS = [
  // Tenants & leases
  { key: 'tenants:view', name: 'View tenants and units', category: 'tenants', description: 'Read tenant and unit records for assigned facilities.' },
  { key: 'tenants:edit', name: 'Edit tenant records', category: 'tenants', description: 'Update contact info and address, add notes, and log documents on a tenant profile.' },
  { key: 'leases:move_in', name: 'Move-in at the counter', category: 'tenants', description: 'Run the walk-in move-in wizard.' },
  { key: 'leases:move_out', name: 'Move out', category: 'tenants', description: 'Close a lease and release the unit.' },
  { key: 'leases:transfer', name: 'Transfer units', category: 'tenants', description: 'Move a tenant between units.' },

  // Money
  { key: 'payments:take', name: 'Take payments', category: 'billing', description: 'Accept card, cash, or check payments.' },
  { key: 'fees:waive', name: 'Waive fees', category: 'billing', description: 'Waive a fee, subject to the role monetary limit.' },
  { key: 'credits:manual', name: 'Issue manual credits', category: 'billing', description: 'Post a manual credit, subject to the role monetary limit.' },
  { key: 'refunds:request', name: 'Request refunds', category: 'billing', description: 'Submit a refund for approval.' },
  { key: 'refunds:approve', name: 'Approve refunds', category: 'billing', description: 'Approve a refund, subject to the role monetary limit.' },

  // Inventory & pricing
  { key: 'units:edit', name: 'Edit unit inventory', category: 'inventory', description: 'Create, edit, and change unit statuses.' },
  { key: 'rates:street:propose', name: 'Propose street rates', category: 'pricing', description: 'Propose a street-rate change for approval.' },
  { key: 'rates:street:change', name: 'Change street rates', category: 'pricing', description: 'Publish street-rate changes.' },
  { key: 'rates:tenant_increase', name: 'Raise existing-tenant rates', category: 'pricing', description: 'Schedule rate increases for current tenants.' },

  // Delinquency & auctions
  { key: 'delinquency:execute_step', name: 'Execute delinquency steps', category: 'delinquency', description: 'Action queued delinquency steps.' },
  { key: 'delinquency:configure_timeline', name: 'Configure delinquency timelines', category: 'delinquency', description: 'Edit the per-facility delinquency timeline.' },
  { key: 'auctions:approve', name: 'Approve auction eligibility', category: 'delinquency', description: 'Mark a lien case eligible for auction.' },

  // Access control (PRD 03 SR-2)
  { key: 'access:manage_grants', name: 'Manage authorized access', category: 'access', description: 'Add and revoke people on a lease’s authorized-access list.' },
  { key: 'access:view_codes', name: 'View gate codes', category: 'access', description: 'Reveal a tenant or authorized person’s actual gate code. Audited.' },
  /// PRD 03 US-5 (B-064). Separate from `tenants:view` on purpose: a gate log
  /// says where a named person physically was and at what hour, which is a
  /// sharper fact about someone than their billing history and deserves a key
  /// somebody has to be given deliberately.
  { key: 'access:events', name: 'View gate activity', category: 'access', description: 'Who came through the gate, when, and which attempts were denied.' },

  // Administration
  { key: 'facility:settings', name: 'Edit facility settings', category: 'admin', description: 'Hours, fees, taxes, and facility configuration.' },
  { key: 'users:manage', name: 'Manage users and roles', category: 'admin', description: 'Create staff users and assign roles.' },
  { key: 'audit:view', name: 'View the audit log', category: 'admin', description: 'Read the append-only audit trail.' },

  // Reporting
  { key: 'reports:operational', name: 'View operational reports', category: 'reporting', description: 'Occupancy, move-ins, and daily activity.' },
  { key: 'reports:financial', name: 'View financial reports', category: 'reporting', description: 'Revenue, AR, and delinquency aging.' },
  { key: 'reports:rollup', name: 'View cross-facility roll-ups', category: 'reporting', description: 'Portfolio-wide reporting across facilities.' },
] as const

export type PermissionKey = (typeof PERMISSIONS)[number]['key']

type RoleSeed = {
  key: string
  name: string
  description: string
  rank: number
  isStaffRole: boolean
  maxFeeWaiverCents: number | null
  maxRefundCents: number | null
  maxCreditCents: number | null
  permissions: readonly PermissionKey[]
}

// Monetary limits are starting values the owner can change in configuration —
// they are not hardcoded policy (PRD 02 RBAC-2).
export const ROLES: readonly RoleSeed[] = [
  {
    key: 'tenant',
    name: 'Tenant',
    description: 'A customer. Granted by session audience, never by facility assignment.',
    rank: 0,
    isStaffRole: false,
    maxFeeWaiverCents: 0,
    maxRefundCents: 0,
    maxCreditCents: 0,
    permissions: [],
  },
  {
    key: 'counter',
    name: 'Counter Staff',
    description: 'Front desk: rentals and payments, no money authority.',
    rank: 10,
    isStaffRole: true,
    maxFeeWaiverCents: 0,
    maxRefundCents: 0,
    maxCreditCents: 0,
    permissions: [
      'tenants:view',
      'tenants:edit',
      'leases:move_in',
      'payments:take',
      'access:manage_grants',
      'access:view_codes',
      'access:events',
      'reports:operational',
    ],
  },
  {
    key: 'bookkeeper',
    name: 'Read-Only (Bookkeeper)',
    description: 'Financial visibility with no ability to mutate anything.',
    rank: 10,
    isStaffRole: true,
    maxFeeWaiverCents: 0,
    maxRefundCents: 0,
    maxCreditCents: 0,
    permissions: ['tenants:view', 'reports:financial', 'reports:rollup'],
  },
  {
    key: 'manager',
    name: 'Facility Manager',
    description: 'Runs assigned facilities day to day.',
    rank: 20,
    isStaffRole: true,
    maxFeeWaiverCents: 5_000,
    maxRefundCents: 0,
    maxCreditCents: 5_000,
    permissions: [
      'tenants:view',
      'tenants:edit',
      'leases:move_in',
      'leases:move_out',
      'leases:transfer',
      'payments:take',
      'fees:waive',
      'credits:manual',
      'refunds:request',
      'units:edit',
      'rates:street:propose',
      'delinquency:execute_step',
      'access:manage_grants',
      'access:view_codes',
      'access:events',
      'reports:operational',
      'reports:financial',
    ],
  },
  {
    key: 'regional',
    name: 'Regional Manager',
    description: 'Oversees several facilities; approves within a higher limit.',
    rank: 30,
    isStaffRole: true,
    maxFeeWaiverCents: 25_000,
    maxRefundCents: 25_000,
    maxCreditCents: 25_000,
    permissions: [
      'tenants:view',
      'tenants:edit',
      'leases:move_in',
      'leases:move_out',
      'leases:transfer',
      'payments:take',
      'fees:waive',
      'credits:manual',
      'refunds:request',
      'refunds:approve',
      'units:edit',
      'rates:street:propose',
      'rates:street:change',
      'rates:tenant_increase',
      'delinquency:execute_step',
      'auctions:approve',
      'access:manage_grants',
      'access:view_codes',
      'access:events',
      'facility:settings',
      'audit:view',
      'reports:operational',
      'reports:financial',
      'reports:rollup',
    ],
  },
  {
    key: 'owner',
    name: 'Owner/Admin',
    description: 'Full authority across the portfolio.',
    rank: 40,
    isStaffRole: true,
    maxFeeWaiverCents: null,
    maxRefundCents: null,
    maxCreditCents: null,
    permissions: PERMISSIONS.map((p) => p.key),
  },
  {
    key: 'system',
    name: 'System',
    description: 'Background jobs and integrations. Not a human login.',
    rank: 100,
    isStaffRole: false,
    maxFeeWaiverCents: 0,
    maxRefundCents: 0,
    maxCreditCents: 0,
    // Deliberately narrow: jobs that need more must be granted it explicitly
    // rather than inheriting owner-level authority.
    permissions: ['tenants:view', 'delinquency:execute_step'],
  },
]
