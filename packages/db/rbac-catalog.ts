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
  /// PRD 02 US-33 (B-078). Opening and closing the till. Held by whoever
  /// works the counter — the person who takes the cash is the person who
  /// counts it down — with the manager gate applying to an unexplained
  /// variance rather than to the act of closing.
  { key: 'drawer:manage', name: 'Open and close the drawer', category: 'billing', description: 'Start a drawer session and count it down at close.' },
  /// PRD 02 US-34 (B-078). Editing what is on the shelf and what it costs.
  /// Separate from `payments:take`: selling a lock is counter work, but
  /// setting its price and its cost is not.
  { key: 'merchandise:manage', name: 'Manage merchandise', category: 'billing', description: 'Add products, set prices and adjust stock.' },

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
  // B-079 / PRD 02 US-4. Editing the org-level default is a portfolio-wide act,
  // so `can()` is asked for it with a null facilityId — which only an
  // all-facilities assignment satisfies. Pushing one to a given facility is
  // checked separately against `facility:settings` AT that facility, so a
  // regional manager can push a default down to their own sites and no others.
  { key: 'org:defaults', name: 'Edit org-level defaults', category: 'admin', description: 'Define the portfolio-wide fee schedule, late-fee ladder and delinquency timeline, and push them to facilities.' },
  { key: 'audit:view', name: 'View the audit log', category: 'admin', description: 'Read the append-only audit trail.' },
  // B-084 part 1 / PRD 02 §8. Filing a month's books. Scoped per facility —
  // each site keeps its own books on its own timezone — but deliberately NOT
  // granted to `manager`: closing a period fixes the figures the site is
  // measured on, which is the same reason `auctions:approve` stops at regional.
  { key: 'accounting:close', name: 'Close and reopen accounting periods', category: 'admin', description: 'File a month\u2019s figures so they stop moving, and reopen a filed month.' },
  // B-128 / PRD 04 US-4. A city page spans every facility in the city, so
  // there is no facility to scope the edit to — `can()` is asked for this with
  // a null facilityId, which only an all-facilities assignment satisfies, the
  // same shape as `org:defaults` above. Deliberately not `facility:settings`:
  // that is held per-site, and a manager at one Austin location would
  // otherwise be editing the page that lists their competitors' sites too.
  { key: 'marketing:city_copy', name: 'Edit city page copy', category: 'admin', description: 'Write the intro paragraphs on a city landing page. Portfolio-wide — a city page lists every facility in it.' },

  // Support impersonation (PRD 09 §4, B-091)
  //
  // All four are OWNER-ONLY at seed (D-13b) — deliberately tighter than the
  // obvious "regionals field escalations, give it to them too". D-13a removed
  // tenant notification, so B-092's oversight reporting is the ONLY channel
  // through which misuse becomes visible; start with the smallest surface and
  // widen against observed usage once that reporting is running.
  //
  // Widening is a seed change and not a code change, which is the point of the
  // escalation guard: granting `impersonation:tenant` to `regional` or
  // `manager` later needs no migration, because the rank and scope rules
  // already confine them to subjects they can reach.
  //
  // Owner holds every permission by construction below, so these need no
  // explicit grant anywhere.
  { key: 'impersonation:tenant', name: 'View the portal as a tenant', category: 'impersonation', description: 'Start a read-only support session as a tenant. Audited, time-boxed, and never able to move money or change credentials.' },
  { key: 'impersonation:staff', name: 'View the dashboard as another staff user', category: 'impersonation', description: 'Start a read-only support session as another staff user of equal or lower rank, within your own facility scope.' },
  /// RBAC-I2: meaningless alone — it only upgrades a session the actor could
  /// already start. B-091 ships no code that sets `read_write`; the permission
  /// is seeded so D-13b's "owner only, all four" is true of the catalog, and
  /// PRD 09 OQ-2 asks whether the write path should ship at all.
  { key: 'impersonation:write', name: 'Act during a support session', category: 'impersonation', description: 'Upgrade a support session from read-only to read-write. The permanent hard-block list still applies in every mode.' },
  { key: 'impersonation:oversee', name: 'Oversee support sessions', category: 'impersonation', description: 'See every active support session, force-end anyone’s, and run the impersonation report.' },

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
      'drawer:manage',
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
      'drawer:manage',
      'merchandise:manage',
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
      'drawer:manage',
      'merchandise:manage',
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
      'org:defaults',
      'marketing:city_copy',
      'accounting:close',
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
