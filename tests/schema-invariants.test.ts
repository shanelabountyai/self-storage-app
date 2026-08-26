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
  City:
    'a city page lists EVERY facility in the city, so there is no one facility to scope it to — which is also why editing it is checked against `marketing:city_copy` with a null facilityId rather than against `facility:settings` at a site (PRD 04 US-4 AC1, B-128, D-62)',
  Tenant: 'a person, who may hold leases at several facilities',
  StaffUser: 'org-level identity; facility scoping is RoleAssignment in B-004',
  Promotion: 'targets facilities through facilityIds[]',
  Consent: 'scoped to a tenant or lead, not a facility',
  TenantAddress:
    'where a person receives post, like the Tenant it belongs to — one address of record serves every lease they hold, at any facility',
  InvoiceLineItem: 'scoped through its invoice',
  CheckoutSessionUnit:
    'a line of a basket, scoped through the checkout session that owns it — the session carries the facilityId, and a copy on each line could disagree with it',
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
  LeaseHold: 'scoped through the lease it holds',
  PaymentPlan: 'scoped through the lease it holds — the same reasoning LeaseHold is exempt (PRD 02 §4.6 US-25, B-090)',
  PaymentPlanInstallment: 'scoped through the plan it belongs to, which carries the facilityId indirectly via its lease',
  PromoCode:
    'scoped through its promotion, which targets facilities through facilityIds[] — the same reason Promotion itself is exempt (PRD 04 FR-PROMO-2)',
  LeadActivity:
    'scoped through the lead it belongs to; a repeat inquiry is about the same person at the same facility as the lead itself (PRD 04 FR-LEAD-1)',
  AuctionAdvertisement:
    'scoped through the auction case it belongs to — an advertising run is about one sale at one facility, and the case already carries the facilityId (PRD 02 US-28)',
  UrlRedirect:
    'a URL is a site-wide address, and the lookup happens on a request before anything knows which facility it was for — a facilityId here could not be supplied at the only moment it would be read (PRD 04 FR-SEO-2)',
  NotificationPreference:
    'scoped to a tenant, not a facility — the same reasoning Consent is exempt: a preference center choice follows the person across every facility they hold a lease at (PRD 05 CN-13, B-074)',
  MerchandiseSaleLine:
    'scoped through the sale it belongs to, which carries the facilityId — the same reasoning InvoiceLineItem and PaymentAllocation are exempt (PRD 02 US-34, B-078)',
  StaffRecoveryCode:
    'belongs to a staff account, which is org-level identity — the same reasoning StaffUser itself is exempt: one person\u2019s second factor is not a per-facility thing (PRD 00 §7.1, B-079)',
  ImpersonationSession:
    'a support session is about a SUBJECT, and a subject spans facilities \u2014 a tenant with leases at two sites, or an all-facilities staff user, belongs to no single one. What the session does carry is `facilityScopeSnapshot`, the impersonator\u2019s reach at the instant it started, which is the fact an investigation actually asks for and is a set rather than a column (PRD 09 \u00a76.1, B-091)',
  OrgDefault:
    'is the org-level default, by definition — it exists precisely to be the value BEFORE any facility has one, and a facilityId here would make it a facility setting (PRD 02 US-4, B-079)',
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
  // B-097. When a caller says they want to move in — "the 14th", not an
  // instant. A timestamp would imply an hour nobody on the phone gave.
  'Lead.targetMoveInDate',
  // B-057. Which facility-local day a delinquency step ran — the answer to
  // "what happened on the 3rd", which is how a lien file is read.
  'DelinquencyStepRun.businessDate',
  // B-061. The date printed on a lien notice: "pay by 24 August". A timestamp
  // would put an hour on a statutory deadline that the document does not
  // state, and that the tenant reading it was never told.
  'Notice.deadlineDate',
  // B-062. All four are days a person reads off a document or an
  // advertisement, not instants. A sale is advertised as being "on the 14th";
  // a cleanout deadline and a surplus holding period are dates a buyer and a
  // former tenant are told, and putting an hour on either would assert a
  // precision the paperwork does not have.
  'AuctionCase.scheduledSaleDate',
  'AuctionCase.buyerCleanoutDeadline',
  'AuctionCase.surplusHoldUntil',
  'AuctionAdvertisement.runDate',
  // B-071. The day a review was actually posted, not an instant — "5 most
  // recent reviews" sorts and displays by calendar date.
  'Review.reviewDate',
  // B-076. Both are days a tenant reads off a letter: "your rent changes on
  // 1 October", and the day we must have told them by. Putting an hour on
  // either would assert a precision the notice does not state — the same
  // reasoning `Notice.deadlineDate` already carries, and the reason the
  // notice email formats these in UTC rather than a facility timezone.
  'TenantRateIncrease.effectiveDate',
  'TenantRateIncrease.noticeDate',
  // B-078. Which facility-local day a drawer session belongs to — the day the
  // deposits report groups by. A session opened at 8am and closed at 6pm is
  // one day; a timestamp would make "which day was this" a timezone question.
  'DrawerSession.businessDate',
  // B-080. Which facility-local day a reconciliation run checked. FR-9 asks for
  // a drift count "per facility" over time, and the run is one per site per
  // day — an instant would make two runs either side of UTC midnight look like
  // two different days at a site where it was still the same afternoon.
  'GateReconciliationRun.businessDate',
  // B-104. The day a protection change takes effect — the start of a billing
  // period, which is a calendar day the tenant was told in a sentence ("your
  // cover changes on 12 September"). A timestamp would put an hour on a
  // coverage boundary, and "was it in force at 2pm" is not a question anybody
  // wants to have to answer after a fire.
  'ProtectionChange.effectiveFrom',
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
    // is never cents, and a `…Days` field is a duration however it is named
    // (B-076's `Facility.rateIncreaseNoticeDays` is a count of days, not a
    // rate). Both suffixes name their own unit, which is exactly what makes
    // them safe — the rule this guards is "money is cents and says so", not
    // "no field may contain the word rate".
    const ACCEPTED_SUFFIXES = ['Cents', 'BasisPoints', 'Days']

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
