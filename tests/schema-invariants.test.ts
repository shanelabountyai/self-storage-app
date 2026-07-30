import { readFileSync } from 'node:fs'
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
  InvoiceLineItem: 'scoped through its invoice',
  PaymentAllocation: 'scoped through its payment and invoice',
  AuditLog: 'facilityId is nullable — org-level actions have no facility',
}

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

    const suspicious = models.flatMap((model) =>
      model.fields
        .map((field) => ({ field, name: field.split(/\s/)[0] }))
        .filter(({ name }) => words(name).some((word) => MONEY_WORDS.has(word)))
        .filter(({ name }) => !name.endsWith('Cents'))
        .map(({ field }) => `${model.name}.${field}`),
    )
    expect(suspicious).toEqual([])
  })

  it('stores every timestamp as Timestamptz(6)', () => {
    const offenders = models.flatMap((model) =>
      model.fields
        .filter((field) => /^\w+\s+DateTime\b/.test(field))
        .filter((field) => !field.includes('@db.Timestamptz(6)'))
        .map((field) => `${model.name}.${field}`),
    )
    expect(offenders).toEqual([])
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
  const migration = readFileSync(
    new URL(
      '../packages/db/prisma/migrations/20260730161951_core_data_model/migration.sql',
      import.meta.url,
    ),
    'utf8',
  )

  // These live in raw SQL because Prisma's schema language cannot express them;
  // that also means nothing regenerates them, so they're pinned here.
  it.each([
    'lease_one_active_per_unit',
    'lease_billing_day_range',
    'invoice_amounts_non_negative',
    'payment_allocation_amount_positive',
    'consent_single_subject',
  ])('keeps the %s constraint', (name) => {
    expect(migration).toContain(name)
  })
})
