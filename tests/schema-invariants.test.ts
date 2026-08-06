import { readdirSync, readFileSync, statSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Static guard on the cross-cutting rules in master PRD §7.5/§7.6 and CLAUDE.md.
// These are the invariants that get violated by accident when someone adds a
// field months from now, so they're checked against the schema text itself.

const schema = readFileSync(
  new URL('../packages/db/prisma/schema.prisma', import.meta.url),
  'utf8',
)

type Model = { name: string; body: string; fields: string[] }

const models: Model[] = [...schema.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)].map(
  ([, name, body]) => ({
    name,
    body,
    fields: body
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '' && !line.startsWith('//') && !line.startsWith('@@')),
  }),
)

// Models that legitimately carry no facilityId. Master §7.6 requires it on every
// table representing physical or financial reality, "directly or via its parent".
const NO_FACILITY_ID: Record<string, string> = {
  Facility: 'is the facility',
  Tenant: 'a person, who may hold leases at several facilities',
  StaffUser: 'org-level identity; facility scoping is RoleAssignment in B-004',
  Promotion: 'targets facilities through facilityIds[]',
  Consent: 'scoped to a tenant or lead, not a facility',
  TenantAddress:
    'where a person receives post, like the Tenant it belongs to — one address of record serves every lease they hold, at any facility',
  InvoiceLineItem: 'scoped through its invoice',
  PaymentAllocation: 'scoped through its payment and invoice',
  AuditLog: 'facilityId is nullable — org-level actions have no facility',
  AuthToken: 'an identity spans facilities; one account can hold leases at several',
  LoginAttempt: 'throttling is per identity and IP, not per facility',
  Role: 'org-level reference data; facility scoping lives on the assignment',
  Permission: 'org-level reference data',
  RolePermission: 'join over two org-level tables',
  StaffFacilityAssignment: 'facilityId is nullable — null grants every facility',
  EventDelivery: 'scoped through the domain event it delivers',
  StripeEvent:
    'a Stripe account is org-level, and the facility is whatever the referenced payment belongs to',
  DocumentSignature: 'scoped through the document it signs',
  LeaseRateChange: 'scoped through its lease',
  Suppression: 'the shared suppression list is org-wide by address (PRD 05 CN-20); an opt-out spans facilities',
  PayLink: 'scoped through the lease it lets someone pay',
}

/// Calendar dates, not instants. A business date is a facility-local day with
/// no meaningful time component, so Timestamptz would imply precision it does
/// not have. Anything added here must genuinely be a date rather than a moment.
const CALENDAR_DATE_FIELDS = new Set([
  'JobRun.businessDate',
  // B-040. A move-out is a facility-local calendar day, not an instant: the
  // tenant vacated "on the 14th", and a timestamp would imply a precision
  // (and a timezone) the fact does not have.
  'Lease.paidThroughDate',
  'Lease.moveOutDate',
  // B-095. Which facility-local day a task belongs to, not an instant.
  'Task.businessDate',
  // B-044. A billing period is a range of DAYS a tenant occupies a unit.
  'Invoice.periodStart',
  'Invoice.periodEnd',
])

describe('prisma schema invariants', () => {
  it('parses the expected number of models', () => {
    expect(models.length).toBeGreaterThanOrEqual(19)
  })

  it('stores money as integer cents', () => {
    const offenders = models.flatMap((model) =>
      model.fields
        .filter((field) => /^\w*[Cc]ents\s/.test(field) && !/^\w+\s+Int\b/.test(field))
        .map((field) => `${model.name}.${field}`),
    )
    expect(offenders).toEqual([])
  })

  it('never uses Decimal or Float for money', () => {
    const offenders = models.flatMap((model) =>
      model.fields
        .filter((field) => /\b(Decimal|Float)\b/.test(field))
        .filter((field) => !/^(latitude|longitude|mapX|mapY)\s/.test(field))
        .map((field) => `${model.name}.${field}`),
    )
    expect(offenders).toEqual([])
  })

  it('names every money field with a Cents suffix', () => {
    const MONEY_WORDS = new Set([
      'amount',
      'rate',
      'price',
      'total',
      'subtotal',
      'balance',
      'fee',
      'discount',
      'premium',
    ])
    // Split on camelCase so `generatedAt` doesn't trip on the "rate" inside it.
    const words = (name: string) => name.split(/(?=[A-Z])/).map((w) => w.toLowerCase())
    // Non-money units that legitimately share a money word: a tax rate in
    // hundredths of a percent (TaxComponent.rateBasisPoints) is a "rate" but
    // is never cents.
    const ACCEPTED_SUFFIXES = ['Cents', 'BasisPoints']

    const suspicious = models.flatMap((model) =>
      model.fields
        .map((field) => {
          const [name, type] = field.split(/\s+/)
          return { field, name, type }
        })
        // Only scalar Int/Float fields can be money — relation arrays
        // (FeeSchedule[]) and enum-typed fields (feeType FeeType) can't.
        .filter(({ type }) => type === 'Int' || type === 'Int?' || type === 'Float' || type === 'Float?')
        .filter(({ name }) => words(name).some((word) => MONEY_WORDS.has(word)))
        .filter(({ name }) => !ACCEPTED_SUFFIXES.some((suffix) => name.endsWith(suffix)))
        .map(({ field }) => `${model.name}.${field}`),
    )
    expect(suspicious).toEqual([])
  })

  it('stores every timestamp as Timestamptz(6)', () => {
    const offenders = models.flatMap((model) =>
      model.fields
        .filter((field) => /^\w+\s+DateTime\b/.test(field))
        .filter((field) => !field.includes('@db.Timestamptz(6)'))
        .filter((field) => !CALENDAR_DATE_FIELDS.has(`${model.name}.${field.split(/\s/)[0]}`))
        .map((field) => `${model.name}.${field}`),
    )
    expect(offenders).toEqual([])
  })

  it('declares calendar-date fields as @db.Date, not a bare DateTime', () => {
    for (const qualified of CALENDAR_DATE_FIELDS) {
      const [modelName, fieldName] = qualified.split('.')
      const field = models
        .find((m) => m.name === modelName)!
        .fields.find((f) => f.startsWith(`${fieldName} `))
      expect(field, qualified).toContain('@db.Date')
    }
  })

  it('scopes every facility-bound model by facilityId', () => {
    const offenders = models
      .filter((model) => !(model.name in NO_FACILITY_ID))
      .filter((model) => !model.fields.some((field) => /^facilityId\s/.test(field)))
      .map((model) => model.name)
    expect(offenders).toEqual([])
  })

  it('soft-deletes tenants and leases rather than removing them', () => {
    for (const name of ['Tenant', 'Lease']) {
      const model = models.find((m) => m.name === name)!
      expect(model.fields.some((f) => /^deletedAt\s/.test(f)), `${name}.deletedAt`).toBe(true)
      expect(model.fields.some((f) => /^version\s/.test(f)), `${name}.version`).toBe(true)
    }
  })
})

describe('migration invariants', () => {
  // Concatenated across every migration, not just the first — a constraint
  // introduced in migration N is exactly as permanent as one from migration 1,
  // so this must not go blind to everything added after B-002. (It did, for
  // five migrations, until this test was generalized in B-009.)
  const migrationsDir = new URL('../packages/db/prisma/migrations/', import.meta.url)
  const migrationFiles = readdirSync(migrationsDir)
    .filter((entry) => statSync(new URL(entry, migrationsDir)).isDirectory())
    .map((dir) => readFileSync(new URL(`${dir}/migration.sql`, migrationsDir), 'utf8'))
  const allMigrations = migrationFiles.join('\n')

  it('has discovered more than one migration file', () => {
    // Guards the test itself: if the glob ever stops matching anything, every
    // case below would pass vacuously against an empty string.
    expect(migrationFiles.length).toBeGreaterThan(1)
  })

  // These live in raw SQL because Prisma's schema language cannot express
  // them; that also means nothing regenerates them, so they're pinned here.
  // Add a new one in this list every time a migration hand-writes another.
  it.each([
    'lease_one_active_per_unit',
    'lease_billing_day_range',
    'invoice_amounts_non_negative',
    'payment_allocation_amount_positive',
    'consent_single_subject',
    'auth_token_used_after_created',
    'auth_token_expires_after_created',
    'auth_token_one_live_per_subject_purpose',
    'staff_assignment_one_all_facilities_per_user',
    'role_monetary_limits_non_negative',
    'audit_log_no_update',
    'audit_log_no_delete',
    'audit_log_no_truncate',
    'audit_log_actor_identified',
    'event_delivery_settled_consistently',
    'event_delivery_attempts_non_negative',
    'job_run_finished_after_started',
    'job_run_terminal_has_finished_at',
    'job_run_counts_non_negative',
    'job_run_one_global_per_date',
    'tax_component_rate_range',
    'fee_schedule_amount_non_negative',
    'unit_type_dimensions_positive',
    'unit_type_rates_non_negative',
    'unit_type_floor_positive',
  ])('keeps the %s constraint', (name) => {
    expect(allMigrations).toContain(name)
  })
})
