import { pathToFileURL } from 'node:url'
import { assertDevDatabase } from '../../../scripts/assert-dev-database.mts'
import zipcodes from 'zipcodes'
import { prisma } from '@storage/db'
import { CLOSED_ALL_WEEK, type WeeklySchedule } from '@storage/core/facility-settings'
import { recomputeUnitStatus } from '@/lib/admin/units'
import { exampleNoticeTemplate } from '@/lib/admin/notice-templates'
import { openAuctionCase } from '@/lib/auctions/service'
import { setPassword } from '@/lib/auth/accounts'
import { encryptTotpSecret } from '@/lib/auth/totp-secret'
import {
  DEMO_EMAIL_DOMAIN,
  DEMO_STAFF_EMAIL,
  DEMO_STAFF_PASSWORD,
  DEMO_STAFF_TOTP_SECRET,
  DEMO_TENANT_EMAIL,
  DEMO_TENANT_PASSWORD,
  DEMO_POS_TENANT_EMAIL,
  DEMO_BUSINESS_PAYER_EMAIL,
  DEMO_BUSINESS_ACCOUNT_NAME,
  DEMO_PLAN_TENANT_EMAIL,
  DEMO_PROMO_CODE,
} from './demo-credentials.ts'

// Demo/dev data — two facilities and tenants in every lifecycle state
// (PRD 02 §7, PRD 03 US-7 AC4). Distinct from `npm run db:seed`, which seeds
// roles and permissions: those are *reference* data every environment needs,
// these are fixtures only a demo wants.
//
// Two deliberate properties:
//
// 1. It writes NO audit entries. Demo data is constructed state, not actions
//    somebody took, so inventing audit history would make the log lie. It also
//    keeps the data deletable: AuditLog.facility is onDelete: Restrict, so a
//    facility with audit rows can never be removed (B-005).
//
// 2. It is idempotent by teardown-then-create rather than upsert. Every row it
//    makes is marked with the DEMO_PREFIX, so a re-run reproduces a known
//    state exactly instead of layering onto whatever was there.
//
// Unit statuses are never written directly — they go through
// recomputeUnitStatus() like everything else (B-010 US-8).

export const DEMO_PREFIX = 'demo-'

/// `--no-logins`: seed the data, set no passwords and enrol no second factor.
///
/// The published demo credentials are the ONLY part of this seed that is unsafe
/// outside a throwaway database — `demo-owner-password` and a printed TOTP
/// secret sit in demo-credentials.ts, so seeding them anywhere reachable hands
/// over an owner account to anybody who reads the repo. The facilities, units,
/// leases and the one past-due ledger entry are just data.
///
/// Splitting them is what makes a populated demo deployment possible at all:
/// with this flag the guards below do not apply, because the thing they exist
/// to prevent is not being written. Sign in afterwards with a real account —
/// `npm run db:reset-link -- --email dana@demo.example.com --tenant` mints a
/// password-reset link for a demo tenant without sending mail anywhere.
const NO_LOGINS = process.argv.includes('--no-logins')
export { DEMO_EMAIL_DOMAIN, DEMO_STAFF_EMAIL, DEMO_STAFF_PASSWORD, DEMO_TENANT_EMAIL, DEMO_TENANT_PASSWORD, DEMO_POS_TENANT_EMAIL, DEMO_PLAN_TENANT_EMAIL, DEMO_BUSINESS_PAYER_EMAIL, DEMO_BUSINESS_ACCOUNT_NAME }

/// A signed-in staff account for the e2e suite.
///
/// The admin surface had no automated accessibility coverage at all before
/// B-094, and the reason was circular: the axe run needs a session, and nothing
/// could create a staff user with a known password. That is exactly how admin
/// came to carry the majority of the accessibility audit's blocking findings.
///
/// This is a real owner account created through the ordinary path — an owner
/// role plus an all-facilities assignment, per D-12, with no bypass flag. Its
/// safety rests on the same guard as the rest of this script: `main()` refuses
/// to run with NODE_ENV=production, it is never invoked by a deploy, and every
/// row it makes is marked with DEMO_PREFIX / the demo email domain so a
/// teardown removes it.

/// Every lease lifecycle state the seed creates, at every facility.
/// tests/seed-demo.test.ts asserts this covers the LeaseStatus enum — CI never
/// runs this script, so without that check a newly added status would silently
/// go unrepresented in the demo.
export const DEMO_LEASE_STATES = [
  'pending',
  'active',
  'delinquent',
  'pending_auction',
  'ended',
] as const

/// Lifecycle states that exist before a lease does.
export const DEMO_PRE_LEASE_STATES = ['lead', 'reserved'] as const

const officeHours: WeeklySchedule = {
  ...CLOSED_ALL_WEEK,
  monday: { closed: false, open: '09:00', close: '18:00' },
  tuesday: { closed: false, open: '09:00', close: '18:00' },
  wednesday: { closed: false, open: '09:00', close: '18:00' },
  thursday: { closed: false, open: '09:00', close: '18:00' },
  friday: { closed: false, open: '09:00', close: '18:00' },
  saturday: { closed: false, open: '10:00', close: '16:00' },
}

const gateHours: WeeklySchedule = {
  monday: { closed: false, open: '06:00', close: '22:00' },
  tuesday: { closed: false, open: '06:00', close: '22:00' },
  wednesday: { closed: false, open: '06:00', close: '22:00' },
  thursday: { closed: false, open: '06:00', close: '22:00' },
  friday: { closed: false, open: '06:00', close: '22:00' },
  saturday: { closed: false, open: '06:00', close: '22:00' },
  sunday: { closed: false, open: '08:00', close: '20:00' },
}

const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000)
const daysFromNow = (n: number) => new Date(Date.now() + n * 24 * 60 * 60 * 1000)

/// B-228. A calendar day, `n` days out — UTC midnight, which is what
/// `parseDate` stores for a date a staffer types into a `yyyy-mm-dd` field.
///
/// `daysFromNow` above gives whatever time of day the seed happened to run at,
/// and for a field the product only ever fills with a calendar day that is a
/// shape production never holds. It is also why no browser test could see
/// B-228: at 11:00Z a UTC reading and a Central one name the same day, so the
/// dashboard and the schedule agreed in the fixture while disagreeing in
/// production. Use this wherever the fixture stands in for a typed date.
const dayFromNow = (n: number) => {
  const day = daysFromNow(n)
  return new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()))
}

async function teardown() {
  const facilities = await prisma.facility.findMany({
    where: { slug: { startsWith: DEMO_PREFIX } },
    select: { id: true },
  })
  const facilityIds = facilities.map((f) => f.id)
  if (facilityIds.length === 0) return 0

  const where = { facilityId: { in: facilityIds } }

  // Order matters: children before parents, since most FKs are Restrict.
  //
  // Task.facilityId is Restrict too (B-095), and Task has no real FK to
  // whatever it is about (entityId is a loose string, same as
  // Document.subjectId) — so a task created against a demo tenant survives
  // that tenant being deleted and recreated below as an orphaned row that
  // just sits on the stable facility forever, accumulating across every
  // reseed. Without this, /admin/tasks in dev slowly fills with garbage from
  // demo tenants that no longer exist.
  await prisma.task.deleteMany({ where })
  await prisma.ledgerEntry.deleteMany({ where })
  await prisma.paymentAllocation.deleteMany({ where: { payment: { facilityId: { in: facilityIds } } } })
  await prisma.payment.deleteMany({ where })
  await prisma.invoiceLineItem.deleteMany({ where: { invoice: { facilityId: { in: facilityIds } } } })
  await prisma.invoice.deleteMany({ where })
  await prisma.accessCredential.deleteMany({ where })
  await prisma.accessGrant.deleteMany({ where })
  // Before reservations and unit types: CheckoutSession restricts unitType and
  // references both (B-020).
  await prisma.protectionWaiver.deleteMany({ where })
  await prisma.protectionPlan.deleteMany({ where })
  await prisma.checkoutSession.deleteMany({ where })
  await prisma.reservation.deleteMany({ where })
  await prisma.notice.deleteMany({ where })
  // B-130. Cascades with the facility anyway, but deleted explicitly and BEFORE
  // it so a re-run cannot leave version 2 of a template behind version 1 — the
  // seed's contract is that re-running reproduces a known state, not an
  // accumulating one.
  await prisma.noticeTemplate.deleteMany({ where })
  // B-132. `AuctionCase.lease` and `.unit` are both onDelete: Restrict, so a
  // case opened for the pending_auction leases below would make the NEXT
  // re-seed fail on a foreign key rather than reset. Advertisements cascade
  // with it.
  await prisma.auctionCase.deleteMany({ where })
  // B-196. `PaymentPlan` restricts its lease, its hold AND the staff user who
  // agreed it, and `LeaseHold` restricts its lease in turn — so the plan this
  // script now seeds would make the NEXT re-seed fail on a foreign key rather
  // than reset, exactly the way B-132's auction case did. Installments cascade
  // with their plan. Not scoped to the seeded plan alone: a hold placed by the
  // e2e suite against a demo lease has the same effect and the same fix.
  await prisma.paymentPlan.deleteMany({ where: { lease: { facilityId: { in: facilityIds } } } })
  await prisma.leaseHold.deleteMany({ where: { lease: { facilityId: { in: facilityIds } } } })
  // B-090 part 5. `Lease.billingAccount` is onDelete: Restrict in BOTH
  // directions — the lease cannot be deleted while it names an account, and the
  // account cannot be deleted while a lease names it — so the pointer is
  // cleared first and the accounts go with the leases. Same failure shape as
  // B-132's auction case: without this the NEXT re-seed dies on a foreign key.
  await prisma.lease.updateMany({ where, data: { billingAccountId: null } })
  await prisma.billingAccount.deleteMany({ where })
  await prisma.lease.deleteMany({ where })
  await prisma.unit.deleteMany({ where })
  await prisma.unitTypeRate.deleteMany({ where })
  await prisma.unitType.deleteMany({ where })
  await prisma.lead.deleteMany({ where })
  await prisma.taxComponent.deleteMany({ where })
  await prisma.feeSchedule.deleteMany({ where })
  await prisma.staffFacilityAssignment.deleteMany({ where: { facilityId: { in: facilityIds } } })
  await prisma.domainEvent.deleteMany({ where })
  await prisma.jobRun.deleteMany({ where })
  // B-084 part 1. `AccountingPeriod.facility` is onDelete: Restrict, so a demo
  // month that somebody closed would make the NEXT re-seed fail on a foreign
  // key rather than reset — the same footgun the promotion cleanup had until
  // B-128, found this time before it fired rather than after.
  await prisma.accountingPeriod.deleteMany({ where })

  // B-122. Promotions carry no facilityId column — `facilityIds` is an array —
  // so they cannot ride on `where` like everything above. Marked by the same
  // DEMO_PREFIX in their NAME instead, and the codes go first because
  // PromoCode.promotionId is Restrict.
  //
  // The redemptions go too (fixed 2026-08-17, found while building B-128).
  // This block used to spare a promotion that had any — "a redeemed promo is
  // evidence a move-in happened" — which is true of a real promotion and was
  // never true of a demo one. B-082 part 4 then started seeding an ROI
  // promotion WITH a redemption on every run, so that promotion outlived every
  // reset and the next run created a second one with the same name. The tell
  // was `admin-reports.spec.ts` failing on a strict-mode violation — two rows
  // matching "Spring — half off two months" — which reads as a broken report
  // and is a seed that stopped being idempotent. `db:migrate:e2e` is the
  // documented fresh-machine step, so the FIRST person to run it twice hits it.
  // Scoped to demo-prefixed promotions exactly like the codes above, so a real
  // redemption is still untouchable.
  await prisma.promoCode.deleteMany({
    where: { promotion: { name: { startsWith: DEMO_PREFIX } } },
  })
  await prisma.promoRedemption.deleteMany({
    where: { promotion: { name: { startsWith: DEMO_PREFIX } } },
  })
  await prisma.promotion.deleteMany({
    where: { name: { startsWith: DEMO_PREFIX } },
  })

  // The demo staff user is deliberately NOT deleted. Once it has signed in and
  // done anything, it owns AuditLog rows, and AuditLog.actorStaffId is
  // onDelete: Restrict — an audited actor can never be erased, which is the
  // whole point of an append-only log. Its assignments are removed with the
  // facilities above and seedStaffOwner() re-creates them, so a re-run still
  // reproduces a known state.
  await prisma.staffFacilityAssignment.deleteMany({
    where: { staffUser: { email: { endsWith: DEMO_EMAIL_DOMAIN } } },
  })

  await prisma.consent.deleteMany({
    where: { tenant: { email: { endsWith: DEMO_EMAIL_DOMAIN } } },
  })
  // TenantNote.tenantId is onDelete: Restrict (B-038), so a demo tenant that
  // has ever been noted — which the e2e suite does on every run — cannot be
  // deleted until its notes are. Without this the seed stops being re-runnable
  // the first time that test passes, which is the worst possible moment for a
  // fixture script to start failing.
  await prisma.tenantNote.deleteMany({
    where: { tenant: { email: { endsWith: DEMO_EMAIL_DOMAIN } } },
  })
  await prisma.tenantAddress.deleteMany({
    where: { tenant: { email: { endsWith: DEMO_EMAIL_DOMAIN } } },
  })
  await prisma.tenant.deleteMany({ where: { email: { endsWith: DEMO_EMAIL_DOMAIN } } })

  // The facility row itself may be undeletable, and that is not a failure.
  // AuditLog.facilityId is onDelete: Restrict and a trigger blocks DELETE on
  // audit_log entirely (B-005), so once anything performs a real audited admin
  // action against a demo facility — which the e2e suite now can, since B-094
  // signs in — that facility can never be removed. Every child row above is
  // already gone, so seedFacility() upserts the shell back to a known state
  // instead. Without this the seed would be idempotent right up until the first
  // authenticated test run, then fail forever.
  try {
    await prisma.facility.deleteMany({ where: { id: { in: facilityIds } } })
  } catch {
    console.info(
      `Kept ${facilityIds.length} demo facilit${facilityIds.length === 1 ? 'y' : 'ies'} that own audit history; reusing the rows.`,
    )
  }

  return facilityIds.length
}

type SeededFacility = Awaited<ReturnType<typeof seedFacility>>

async function seedFacility(input: {
  slug: string
  name: string
  city: string
  postalCode: string
  addressLine1: string
  unitTypes: { name: string; widthFt: number; lengthFt: number; climate: boolean; driveUp: boolean; street: number; web: number; count: number }[]
  /// B-118. Empty on every facility until now — nothing in the demo data could
  /// exercise the hero photo it built, which is exactly the state "renders no
  /// placeholder and no empty frame" already covers correctly for two of the
  /// three demo facilities left this way on purpose. `url` is a self-contained
  /// `data:` URI, not a third party image host — this project does not point
  /// its own test suite at a network dependency it does not control (the same
  /// reasoning `ACCESS_CODE_ENCRYPTION_KEY` stays unconfigured everywhere here).
  photos?: { alt: string; kind: string }[]
}) {
  // B-015 ranks facilities by distance, so a facility without coordinates is
  // invisible to search. Demo sites take their zip centroid, which is accurate
  // to a mile or so — a real facility would carry the surveyed coordinates of
  // its gate, captured when the site is set up.
  const centroid = zipcodes.lookup(input.postalCode)

  // Upsert, not create: a facility that owns audit history survives teardown
  // (see the note there), so this has to be able to reset an existing row to
  // the known demo state rather than assuming a clean slate.
  const facilityData = {
    name: input.name,
    addressLine1: input.addressLine1,
    city: input.city,
    state: 'TX',
    postalCode: input.postalCode,
    latitude: centroid?.latitude ?? null,
    longitude: centroid?.longitude ?? null,
    timezone: 'America/Chicago',
    phone: '512-555-0100',
    email: `manager@${input.slug}.${DEMO_EMAIL_DOMAIN}`,
    officeHours,
    gateHours,
    amenities: ['Gated access', 'Video recording', 'Drive-up units'],
    status: 'active' as const,
  }
  const facility = await prisma.facility.upsert({
    where: { slug: input.slug },
    create: { slug: input.slug, ...facilityData },
    update: facilityData,
  })

  // Deleted and recreated rather than upserted: FacilityPhoto has no natural
  // key beyond its own id, and this facility row can be KEPT across a re-run
  // (see the audit-history note above) — without this, every re-run would add
  // another copy rather than replacing the set.
  await prisma.facilityPhoto.deleteMany({ where: { facilityId: facility.id } })
  if (input.photos && input.photos.length > 0) {
    await prisma.facilityPhoto.createMany({
      data: input.photos.map((photo, index) => ({
        facilityId: facility.id,
        url: `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='800' height='600'%3E%3Crect width='800' height='600' fill='%23${index % 2 === 0 ? 'ddd' : 'ccc'}'/%3E%3C/svg%3E`,
        alt: photo.alt,
        kind: photo.kind as never,
        position: index,
      })),
    })
  }

  // Texas is the seeded compliance default (D-10). Rates are basis points.
  await prisma.taxComponent.createMany({
    data: [
      { facilityId: facility.id, jurisdiction: 'state', rateBasisPoints: 625, effectiveFrom: daysAgo(400) },
      { facilityId: facility.id, jurisdiction: 'city', rateBasisPoints: 200, effectiveFrom: daysAgo(400) },
    ],
  })
  // US-44's coverage tiers. Effective-dated like every other price, and named
  // as protection rather than insurance — what we sell is an addendum, not a
  // policy.
  await prisma.protectionPlan.createMany({
    data: [
      { facilityId: facility.id, tier: 'basic', name: '$2,000 cover', coverageCents: 200_000, premiumCents: 900, effectiveFrom: daysAgo(400) },
      { facilityId: facility.id, tier: 'standard', name: '$3,000 cover', coverageCents: 300_000, premiumCents: 1_400, effectiveFrom: daysAgo(400) },
      { facilityId: facility.id, tier: 'premium', name: '$5,000 cover', coverageCents: 500_000, premiumCents: 2_200, effectiveFrom: daysAgo(400) },
    ],
  })
  await prisma.feeSchedule.createMany({
    data: [
      { facilityId: facility.id, feeType: 'admin', amountCents: 2_500, effectiveFrom: daysAgo(400) },
      { facilityId: facility.id, feeType: 'late', amountCents: 2_000, effectiveFrom: daysAgo(400) },
      { facilityId: facility.id, feeType: 'nsf', amountCents: 3_000, effectiveFrom: daysAgo(400) },
      { facilityId: facility.id, feeType: 'lien', amountCents: 5_000, effectiveFrom: daysAgo(400) },
    ],
  })

  const unitTypes = []
  for (const spec of input.unitTypes) {
    const unitType = await prisma.unitType.create({
      data: {
        facilityId: facility.id,
        name: spec.name,
        widthFt: spec.widthFt,
        lengthFt: spec.lengthFt,
        climateControlled: spec.climate,
        driveUp: spec.driveUp,
        floor: 1,
        powerAvailable: false,
      },
    })
    // Rates are effective-dated rows, never columns (B-011).
    await prisma.unitTypeRate.create({
      data: {
        facilityId: facility.id,
        unitTypeId: unitType.id,
        streetRateCents: spec.street,
        webRateCents: spec.web,
        effectiveFrom: daysAgo(400),
      },
    })

    const units = []
    for (let i = 1; i <= spec.count; i++) {
      units.push(
        await prisma.unit.create({
          data: {
            facilityId: facility.id,
            unitTypeId: unitType.id,
            number: `${spec.name.split(' ')[0]}-${String(i).padStart(3, '0')}`,
            building: spec.climate ? 'A' : 'B',
            floor: 1,
            doorType: spec.driveUp ? 'roll-up' : 'swing',
          },
        }),
      )
    }
    unitTypes.push({ unitType, units, spec })
  }

  return { facility, unitTypes }
}

/// Scoped to the demo facilities, NOT an all-facilities assignment.
///
/// That is deliberate and load-bearing. `createOwnerAccount()` refuses to
/// bootstrap when a usable all-facilities owner already exists (B-007), so a
/// demo account holding `facilityId: null` would make `db:seed:demo` silently
/// break `tests/bootstrap-owner.test.ts` for everyone afterwards — and in CI,
/// where the demo seed runs before the unit tests, permanently.
///
/// Nothing is lost: the e2e suite needs an account that can reach the demo
/// facilities and exercise the switcher, and two scoped assignments do that
/// while also being the more realistic shape (a district manager over two
/// sites). D-12 is untouched — this is an ordinary role + assignment, and the
/// only unrestricted access remains owner + all-facilities.
async function seedStaffOwner(facilityIds: string[]) {
  const ownerRole = await prisma.role.findUnique({ where: { key: 'owner' } })
  if (!ownerRole) {
    throw new Error('The "owner" role does not exist — run `npm run db:seed` first.')
  }

  // Reused rather than recreated: see the note in teardown() — once this
  // account has acted it cannot be deleted, so the seed has to be able to find
  // it again. The password is reset on every run so a rotated constant takes
  // effect without needing the row gone.
  const staffUser = await prisma.staffUser.upsert({
    where: { email: DEMO_STAFF_EMAIL },
    create: { email: DEMO_STAFF_EMAIL, firstName: 'Demo', lastName: 'Owner' },
    update: { status: 'active', deletedAt: null },
  })
  await prisma.staffFacilityAssignment.createMany({
    data: facilityIds.map((facilityId) => ({
      staffUserId: staffUser.id,
      roleId: ownerRole.id,
      facilityId,
    })),
  })

  // B-113. One additional ALL-FACILITIES assignment, under `regional` rather
  // than `owner`.
  //
  // Without it nothing in the suite could reach "All facilities" at all: the
  // switcher only offers the option to an actor with `facilityAccess().all`,
  // and the four roll-up screens this item built were unreachable from any
  // signed-in session — the headline of the item, with no path to it.
  //
  // The role matters and is not incidental. `createOwnerAccount()` refuses to
  // bootstrap when a usable all-facilities assignment exists **under the owner
  // role specifically**, so a `regional` one leaves `bootstrap-owner.test.ts`
  // exactly as it was — which is the constraint the note above this function
  // is about. `regional` also already carries `reports:financial` and
  // `reports:rollup`, so the money-owed roll-up renders rather than being
  // silently empty.
  //
  // It does not change the default context either: `resolveSelectedFacility`
  // falls back to the first facility, not to "all", so every existing spec
  // still lands on a single site.
  const regionalRole = await prisma.role.findUnique({ where: { key: 'regional' } })
  if (regionalRole) {
    await prisma.staffFacilityAssignment.createMany({
      data: [{ staffUserId: staffUser.id, roleId: regionalRole.id, facilityId: null }],
    })
  }
  // Under --no-logins the account is still created, with its scoped
  // assignments, because a staff list with nobody in it is not a demo. It
  // simply has no password and no second factor, so nobody can sign in as it.
  //
  // CLEARED rather than merely skipped, and that distinction is the whole
  // point: teardown() deliberately keeps this row (once it has acted it cannot
  // be deleted), so a database that was seeded normally once would otherwise
  // keep the published password and the printed TOTP secret through every
  // later --no-logins run — the exact outcome the flag exists to prevent, and
  // silent, because the summary would still say no logins were set.
  if (NO_LOGINS) {
    await prisma.staffUser.update({
      where: { id: staffUser.id },
      data: { passwordHash: null, totpSecret: null, totpConfirmedAt: null, totpLastStep: null },
    })
  } else {
    await setPassword(staffUser.id, 'staff', DEMO_STAFF_PASSWORD)

    // B-079. Enrolled with the published demo secret, encrypted the same way a
    // real enrolment is — no test-only column, no bypass. `totpLastStep` is
    // cleared so a fresh seed does not inherit a replay guard from the previous
    // run's last sign-in, which would reject the first code of the new one.
    await prisma.staffUser.update({
      where: { id: staffUser.id },
      data: {
        totpSecret: encryptTotpSecret(DEMO_STAFF_TOTP_SECRET),
        totpConfirmedAt: new Date(),
        totpLastStep: null,
      },
    })
  }

  return staffUser
}

/// The address of record every demo tenant should have had.
///
/// D-21 makes `TenantAddress` authoritative and the `Tenant.*` columns a
/// cache of its newest row — so a fixture that writes only the columns leaves
/// a tenant whose address exists but has no history, which is exactly the gap
/// the decision exists to prevent. Every tenant this script creates gets the
/// matching row, sourced `import` like the migration backfill.
async function recordSeedAddress(tenantId: string, index: number) {
  await prisma.tenantAddress.create({
    data: {
      tenantId,
      addressLine1: `${100 + index} Demo Street`,
      city: 'Austin',
      state: 'TX',
      postalCode: '78701',
      source: 'import',
    },
  })
}

async function makeTenant(first: string, last: string, index: number) {
  const tenant = await prisma.tenant.create({
    data: {
      email: `${first.toLowerCase()}.${last.toLowerCase()}${index}@${DEMO_EMAIL_DOMAIN}`,
      firstName: first,
      lastName: last,
      phone: `512-555-${String(1000 + index).slice(-4)}`,
      addressLine1: `${100 + index} Demo Street`,
      city: 'Austin',
      state: 'TX',
      postalCode: '78701',
    },
  })
  await recordSeedAddress(tenant.id, index)
  return tenant
}

/// Creates a lease in a given lifecycle state, plus the access grant an
/// occupying lease would have. Unit status is derived afterwards, never set.
async function makeLease(
  facilityId: string,
  unitId: string,
  tenantId: string,
  status: 'pending' | 'active' | 'delinquent' | 'pending_auction' | 'ended',
  monthlyRateCents: number,
  startedDaysAgo: number,
) {
  const lease = await prisma.lease.create({
    data: {
      facilityId,
      tenantId,
      unitId,
      status,
      startDate: daysAgo(startedDaysAgo),
      endDate: status === 'ended' ? daysAgo(5) : null,
      monthlyRateCents,
      billingDay: 1,
      protectionPlanName: 'Standard $2,000',
      protectionCents: 1_200,
      signedAt: daysAgo(startedDaysAgo),
    },
  })

  if (status !== 'ended' && status !== 'pending') {
    const grant = await prisma.accessGrant.upsert({
      where: { facilityId_tenantId: { facilityId, tenantId } },
      create: {
        facilityId,
        tenantId,
        state: status === 'delinquent' || status === 'pending_auction' ? 'suspended' : 'active',
        stateCause: status === 'active' ? 'system:move_in' : 'system:delinquency',
      },
      update: {},
    })
    await prisma.accessCredential.create({
      data: {
        facilityId,
        grantId: grant.id,
        leaseId: lease.id,
        type: 'pin',
        // Never a plaintext gate code — the real code lives behind a separate
        // audited permission (PRD 03 SR-2). This is only a reference.
        valueRef: `demo-pin-ref-${lease.id.slice(-6)}`,
        state: grant.state === 'active' ? 'active' : 'suspended',
        syncStatus: 'synced',
        lastSyncAt: daysAgo(1),
      },
    })
  }

  await recomputeUnitStatus(unitId)
  return lease
}

/// Unpaid rent for a lease that is supposed to owe money: one INVOICE per
/// month, each with the ledger charge that accounts for it.
///
/// B-132. Every one of these pairs used to exist for exactly one lease — the
/// primary facility's delinquent one — so Dallas's "delinquent" tenant and BOTH
/// `pending_auction` leases were a lifecycle label with no money behind them.
/// A `pending_auction` lease that owes nothing can never have a served lien
/// notice behind it, and a served notice is the auction pipeline's own
/// scheduling precondition (B-062), so the auction arc could not be walked end
/// to end any more than the notice arc could before B-130.
///
/// B-114 is why there is an INVOICE at all and not just a ledger charge. Before
/// it, the seed had a tenant who owed money and was not late: every aging figure
/// in the product reads `daysPastDue` from the oldest unpaid INVOICE's original
/// due date (D-25), and there were no invoices anywhere in the demo data — so
/// the delinquency report bucketed the whole portfolio at 0–10 days, the tenant
/// list could never show a past-due row, and the one lifecycle state the seed
/// called `delinquent` demonstrated owing rather than delinquency.
///
/// Invoice FIRST and the charge carries its `invoiceId`, which is the whole
/// lesson of B-130: `reconcile` counts invoices-outstanding PLUS charges no
/// invoice accounts for, so an unlinked charge is counted twice and the lease
/// reports as short by exactly what it owes — which US-27 then refuses to state
/// a claim from, correctly.
///
/// Oldest month first, one month apart, because every aging figure in the
/// product reads `daysPastDue` from the OLDEST unpaid invoice's original due
/// date (D-25). Three months on a `pending_auction` lease is what puts it past
/// a lien timeline rather than merely late.
///
/// Returns the next free invoice number, so one facility's demo invoices stay a
/// single sequence — they are written directly rather than through B-044's
/// gapless counter, since this script writes no audit entries either.
async function seedUnpaidRent(
  facility: { id: string; slug: string },
  lease: { id: string; monthlyRateCents: number; protectionCents: number },
  months: number,
  firstNumber: number,
): Promise<number> {
  const owedCents = lease.monthlyRateCents + lease.protectionCents
  for (let i = 0; i < months; i++) {
    const age = 35 + (months - 1 - i) * 30
    const invoice = await prisma.invoice.create({
      data: {
        facilityId: facility.id,
        leaseId: lease.id,
        number: `DEMO-${facility.slug.slice(-6).toUpperCase()}-${String(firstNumber + i).padStart(4, '0')}`,
        issueDate: daysAgo(age),
        dueDate: daysAgo(age),
        periodStart: daysAgo(age),
        periodEnd: daysAgo(age - 30),
        totalCents: owedCents,
        amountPaidCents: 0,
        status: 'open',
        // B-232. The invoice's own lines, which is what `/portal/pay` itemises
        // the balance from. Written directly like the rest of this script, and
        // they SUM to `owedCents` — a demo invoice whose lines disagreed with
        // its total would make the pay screen's reconciliation check drop the
        // itemisation and quietly fall back to the bare figure it replaced.
        lineItems: {
          create: [
            {
              type: 'rent' as const,
              description: 'Monthly rent',
              quantity: 1,
              unitAmountCents: lease.monthlyRateCents,
              amountCents: lease.monthlyRateCents,
            },
            ...(lease.protectionCents > 0
              ? [
                  {
                    type: 'protection' as const,
                    description: 'Protection plan',
                    quantity: 1,
                    unitAmountCents: lease.protectionCents,
                    amountCents: lease.protectionCents,
                  },
                ]
              : []),
          ],
        },
      },
    })
    await prisma.ledgerEntry.create({
      data: {
        facilityId: facility.id,
        leaseId: lease.id,
        type: 'charge',
        amountCents: owedCents,
        description: 'Monthly rent + protection plan',
        occurredAt: daysAgo(age),
        invoiceId: invoice.id,
      },
    })
  }
  return firstNumber + months
}

async function seedLifecycleStates(
  seeded: SeededFacility,
  startIndex: number,
  isPrimaryFacility: boolean,
  staffUserId: string,
) {
  const { facility, unitTypes } = seeded
  const pool = unitTypes.flatMap((t) => t.units.map((u) => ({ unit: u, rate: t.spec.street })))
  let cursor = 0
  const next = () => pool[cursor++]
  let index = startIndex

  // One demo invoice sequence per facility, advanced by `seedUnpaidRent`.
  let invoiceNumber = 1

  const summary: Record<string, number> = {}
  const note = (state: string) => {
    summary[state] = (summary[state] ?? 0) + 1
  }

  // --- lead: interested, no tenant record yet -----------------------------
  await prisma.lead.create({
    data: {
      facilityId: facility.id,
      unitTypeId: unitTypes[0].unitType.id,
      status: 'new',
      firstName: 'Priya',
      lastName: 'Prospect',
      email: `priya.prospect${index}@${DEMO_EMAIL_DOMAIN}`,
      phone: '512-555-0199',
      message: 'Moving in three weeks, need a 10x10.',
      source: 'organic',
      firstTouchSource: 'google',
      firstTouchMedium: 'organic',
    },
  })
  note('lead')
  index++

  // --- reserved: free hold, no card (D-7) ---------------------------------
  const reserving = await makeTenant('Rosa', 'Reserved', index++)
  const reservedSlot = next()
  await prisma.reservation.create({
    data: {
      facilityId: facility.id,
      unitTypeId: unitTypes[0].unitType.id,
      unitId: reservedSlot.unit.id,
      tenantId: reserving.id,
      status: 'held',
      firstName: reserving.firstName,
      lastName: reserving.lastName,
      email: reserving.email,
      quotedRateCents: reservedSlot.rate,
      moveInDate: daysFromNow(3),
      expiresAt: daysFromNow(7),
      tokenHash: `demo-reservation-${facility.slug}-${index}`,
      utmSource: 'google',
      utmMedium: 'organic',
    },
  })
  await recomputeUnitStatus(reservedSlot.unit.id)
  note('reserved')

  // --- pending: checkout in progress, not yet provisioned -----------------
  const pendingTenant = await makeTenant('Pat', 'Pending', index++)
  const pendingSlot = next()
  await makeLease(facility.id, pendingSlot.unit.id, pendingTenant.id, 'pending', pendingSlot.rate, 0)
  note('pending')

  // --- active ×3 ----------------------------------------------------------
  // At the primary facility the first of these carries a stable email, so
  // tests that record real payments have a tenant whose balance nothing else
  // asserts on (see DEMO_POS_TENANT_EMAIL).
  for (let i = 0; i < 3; i++) {
    const tenant =
      isPrimaryFacility && i === 0
        ? await prisma.tenant.create({
            data: {
              email: DEMO_POS_TENANT_EMAIL,
              firstName: 'Alex',
              lastName: 'Active',
              phone: `512-555-${String(1000 + index).slice(-4)}`,
              addressLine1: `${100 + index} Demo Street`,
              city: 'Austin',
              state: 'TX',
              postalCode: '78701',
            },
          })
        : await makeTenant('Alex', 'Active', index)
    if (isPrimaryFacility && i === 0) await recordSeedAddress(tenant.id, index)
    index++
    const slot = next()
    const lease = await makeLease(facility.id, slot.unit.id, tenant.id, 'active', slot.rate, 90 + i * 30)
    note('active')

    // B-090 part 5. One business account, so the screen has something on it
    // and so a reader can see what "one payer, somebody else's unit" looks
    // like without building one first.
    //
    // Attaching THIS lease is deliberate and is safe for the reason the note
    // beside DEMO_BUSINESS_PAYER_EMAIL gives: allocation widens for the payer,
    // and Alex is not the payer, so every POS test that takes money against
    // this lease behaves exactly as it did before.
    if (isPrimaryFacility && i === 0) {
      const payer = await prisma.tenant.create({
        data: {
          email: DEMO_BUSINESS_PAYER_EMAIL,
          firstName: 'Casey',
          lastName: 'Contractor',
          phone: '512-555-0199',
          addressLine1: '900 Demo Street',
          city: 'Austin',
          state: 'TX',
          postalCode: '78701',
        },
      })
      const account = await prisma.billingAccount.create({
        data: {
          facilityId: facility.id,
          name: DEMO_BUSINESS_ACCOUNT_NAME,
          payerTenantId: payer.id,
        },
      })
      await prisma.lease.update({
        where: { id: lease.id },
        data: { billingAccountId: account.id },
      })
    }
  }

  // --- delinquent ---------------------------------------------------------
  // At the primary facility, this is also the demo tenant with a known
  // password (B-034) — one login that exercises both the portal's normal
  // dashboard and its past-due/suspended states, the way DEMO_STAFF_EMAIL
  // covers the admin side.
  const delinquentTenant = isPrimaryFacility
    ? await prisma.tenant.create({
        data: {
          email: DEMO_TENANT_EMAIL,
          firstName: 'Dana',
          lastName: 'Delinquent',
          phone: `512-555-${String(1000 + index).slice(-4)}`,
          addressLine1: `${100 + index} Demo Street`,
          city: 'Austin',
          state: 'TX',
          postalCode: '78701',
        },
      })
    : await makeTenant('Dana', 'Delinquent', index)
  await recordSeedAddress(delinquentTenant.id, index)
  index++
  const delinquentSlot = next()
  const delinquentLease = await makeLease(
    facility.id,
    delinquentSlot.unit.id,
    delinquentTenant.id,
    'delinquent',
    delinquentSlot.rate,
    200,
  )
  // A real unpaid charge, so the portal dashboard's past-due banner and
  // suspended gate-code panel (B-034) have a genuine signal to render instead
  // of an empty $0, and so the delinquency report has a past-due row at all
  // (B-114). At EVERY facility since B-132 — Dallas's "delinquent" tenant owed
  // nothing until then, which made every multi-facility aging figure one lease
  // at one site wearing three hats.
  invoiceNumber = await seedUnpaidRent(facility, delinquentLease, 1, invoiceNumber)
  if (isPrimaryFacility) {
    // Cleared, not skipped — same reasoning as the staff account above.
    if (NO_LOGINS) {
      await prisma.tenant.update({
        where: { id: delinquentTenant.id },
        data: { passwordHash: null },
      })
    } else {
      await setPassword(delinquentTenant.id, 'tenant', DEMO_TENANT_PASSWORD)
    }
    // B-130. Notice templates, so the delinquent lease can actually generate
    // one.
    //
    // Written directly rather than through `saveNoticeTemplate`, which records
    // an audit entry — this script's own contract is that it writes none.
    //
    // Seeded for the DEMO facility only, and that distinction is B-061's: a
    // real facility with no template generates nothing, deliberately, so that
    // nobody mails the unedited example text to a tenant. Demo data exists to
    // demonstrate the flow, and the example body carries the draft-only
    // disclaimer in its own text.
    // BOTH types, not just the lien one. The pre-lien notice is the FIRST step
    // of the arc this demo exists to show, and a facility that can only produce
    // the second one demonstrates the end of a process without its beginning.
    for (const type of ['pre_lien', 'lien'] as const) {
      const example = exampleNoticeTemplate(type)
      await prisma.noticeTemplate.create({
        data: {
          facilityId: facility.id,
          type,
          version: 1,
          active: true,
          title: example.title,
          body: example.body,
        },
      })
    }
  }
  note('delinquent')

  // --- on an agreed payment plan (B-196) ---------------------------------
  //
  // Its own tenant, not Dana. See the note beside DEMO_PLAN_TENANT_EMAIL: an
  // active plan places a `payment_plan` hold, the hold halts dunning, late fees
  // and access suspension, and Dana is the one lease four suites depend on
  // being chased.
  //
  // Four surfaces render only for a lease under a hold — `/portal/payment-plan`'s
  // schedule, the portal dashboard's plan card, `/admin/reports/plans-holds`'s
  // halted table and `/admin/delinquency`'s halted section — and every one of
  // them was scanned in its empty state and declared a STATE_EXCEPTION for want
  // of this fixture. B-132 set the precedent: seed exactly enough state to make
  // the arc walkable, and no more.
  //
  // Written directly rather than through `createPaymentPlan`, like every other
  // row here — that function records two audit entries and emits
  // `payment_plan.agreed`, and this script's contract is that it writes neither.
  // What it DOES reproduce faithfully is the shape that function creates: the
  // same `payment_plan` hold type, `totalCents` equal to the arrears the plan
  // covers, and `invoiceIds` frozen to exactly the invoices it was agreed over
  // (D-96), so the progress arithmetic every screen reads is honest rather than
  // merely non-empty.
  if (isPrimaryFacility) {
    const planTenant = await prisma.tenant.create({
      data: {
        email: DEMO_PLAN_TENANT_EMAIL,
        firstName: 'Pia',
        lastName: 'Planned',
        phone: `512-555-${String(1000 + index).slice(-4)}`,
        addressLine1: `${100 + index} Demo Street`,
        city: 'Austin',
        state: 'TX',
        postalCode: '78701',
      },
    })
    await recordSeedAddress(planTenant.id, index)
    index++
    const planSlot = next()
    const planLease = await makeLease(
      facility.id,
      planSlot.unit.id,
      planTenant.id,
      'delinquent',
      planSlot.rate,
      150,
    )
    invoiceNumber = await seedUnpaidRent(facility, planLease, 2, invoiceNumber)
    const covered = await prisma.invoice.findMany({
      where: { leaseId: planLease.id },
      select: { id: true, totalCents: true, amountPaidCents: true },
    })
    const totalCents = covered.reduce((sum, i) => sum + i.totalCents - i.amountPaidCents, 0)

    if (!NO_LOGINS) await setPassword(planTenant.id, 'tenant', DEMO_TENANT_PASSWORD)

    const planHold = await prisma.leaseHold.create({
      data: {
        leaseId: planLease.id,
        type: 'payment_plan',
        effectiveFrom: daysAgo(20),
        reason: 'Payment plan agreed: 3 installment(s).',
        placedByStaffId: staffUserId,
      },
    })
    // Every installment in the FUTURE, deliberately. A missed one would be
    // broken by `payment-plan-breach.ts` the first time the delinquency job ran
    // over this database, so the fixture would demonstrate a broken plan on
    // Tuesday and an active one on Monday — a seed that changes what it shows
    // depending on when the jobs last ran is worse than no seed. The last one
    // falls 80 days after agreement, inside the 90-day `planMaxDays` default.
    //
    // The remainder goes on the FIRST installment so the three add up to the
    // arrears exactly, which is what `validateSchedule` demands of a real one.
    const share = Math.floor(totalCents / 3)
    const amounts = [totalCents - share * 2, share, share]
    await prisma.paymentPlan.create({
      data: {
        leaseId: planLease.id,
        holdId: planHold.id,
        status: 'active',
        totalCents,
        invoiceIds: covered.map((i) => i.id),
        // D-97: manual, so nothing in this fixture depends on a saved card and
        // no autopay run can quietly retire an installment between sweeps.
        autoCollect: false,
        note: 'Agreed over the phone; paying in three.',
        createdByStaffId: staffUserId,
        createdAt: daysAgo(20),
        installments: {
          create: amounts.map((amountCents, i) => ({
            position: i + 1,
            dueDate: dayFromNow(10 + i * 25),
            amountCents,
          })),
        },
      },
    })

    // B-244. A SECOND unit for the same tenant, deliberately with no plan and
    // nothing owing on it.
    //
    // Every portal fixture in this suite was a single-lease tenant, so the
    // dashboard's ambiguous case — which unit is the plan on? which unit's
    // balance is that? — was rendered by no test and scanned by no axe run.
    // That is why B-244's defect (every money statement emitted ABOVE the
    // heading naming its unit, in an unnamed `<section>`) survived: with one
    // card there is only one unit it could mean, so the missing association
    // costs nothing and shows nothing.
    //
    // Safe against the specs that already assert on this tenant (B-120): the
    // plan card and the schedule table are scoped to the lease that has a plan,
    // and this lease has none — it adds a second card, not a second plan.
    const planSecondSlot = next()
    await makeLease(
      facility.id,
      planSecondSlot.unit.id,
      planTenant.id,
      'active',
      planSecondSlot.rate,
      150,
    )
  }

  // --- pending_auction: far enough along to demo the lien arc -------------
  //
  // B-132. "Far enough along" was a comment and nothing else until then: this
  // lease had no invoices and no ledger entries at all, so it owed nothing, so
  // no notice could ever state a claim against it and the auction pipeline's
  // scheduling precondition could never be met. Three unpaid months, and the
  // auction CASE the delinquency timeline's `flag_auction_eligible` step would
  // have opened on the way here (B-062) — a lease sitting in this status with
  // no case behind it is a state the product itself cannot reach.
  //
  // What is deliberately NOT seeded: a generated or served lien notice, and any
  // advertising record. Both are claims about documents that were served and
  // advertisements that ran, and fabricating either is what D-63 refused for
  // exactly this arc. The demo leaves them walkable through the product, the
  // same way B-130 left notice generation to the e2e rather than to the seed.
  const auctionTenant = await makeTenant('Avery', 'Auction', index++)
  const auctionSlot = next()
  const auctionLease = await makeLease(
    facility.id,
    auctionSlot.unit.id,
    auctionTenant.id,
    'pending_auction',
    auctionSlot.rate,
    300,
  )
  invoiceNumber = await seedUnpaidRent(facility, auctionLease, 3, invoiceNumber)
  await openAuctionCase({ leaseId: auctionLease.id, facilityId: facility.id })
  note('pending_auction')

  // --- ended: moved out, unit back in service -----------------------------
  const endedTenant = await makeTenant('Erin', 'Ended', index++)
  const endedSlot = next()
  await makeLease(facility.id, endedSlot.unit.id, endedTenant.id, 'ended', endedSlot.rate, 400)
  note('ended')

  // A couple of units taken offline, so the derived-vs-operational status
  // split (B-010) is visible in the demo rather than only in tests.
  const maintenanceSlot = next()
  await prisma.unit.update({
    where: { id: maintenanceSlot.unit.id },
    data: { operationalStatus: 'maintenance' },
  })
  await recomputeUnitStatus(maintenanceSlot.unit.id)

  const unrentableSlot = next()
  await prisma.unit.update({
    where: { id: unrentableSlot.unit.id },
    data: { operationalStatus: 'unrentable' },
  })
  await recomputeUnitStatus(unrentableSlot.unit.id)

  return { summary, nextIndex: index }
}

async function main() {
  // Both guards exist to keep PUBLISHED CREDENTIALS out of a database anybody
  // can reach, so `--no-logins`, which writes none, is not something they need
  // to stop. Without it they stand exactly as before.
  //
  // The first catches production credentials in .env.local, which the NODE_ENV
  // check cannot see: a local shell has no NODE_ENV set, so that check passes
  // happily while the connection string points at the live database.
  if (!NO_LOGINS) {
    assertDevDatabase('seed demo data with the published demo logins')

    if (process.env.NODE_ENV === 'production') {
      console.error(
        'Refusing to seed the published demo logins with NODE_ENV=production.\n' +
          'Re-run with --no-logins to seed the data without them.',
      )
      process.exitCode = 1
      return
    }
  }

  const removed = await teardown()
  if (removed > 0) console.info(`Removed ${removed} existing demo facilit${removed === 1 ? 'y' : 'ies'}.`)

  const austin = await seedFacility({
    slug: `${DEMO_PREFIX}austin-south`,
    name: 'Demo — Austin South',
    city: 'Austin',
    postalCode: '78704',
    addressLine1: '2400 South Congress Ave',
    unitTypes: [
      { name: '10x10 Climate', widthFt: 10, lengthFt: 10, climate: true, driveUp: false, street: 14_900, web: 12_900, count: 10 },
      { name: '10x20 Drive-Up', widthFt: 10, lengthFt: 20, climate: false, driveUp: true, street: 24_900, web: 22_900, count: 8 },
      { name: '5x5 Locker', widthFt: 5, lengthFt: 5, climate: true, driveUp: false, street: 6_900, web: 5_900, count: 6 },
      // B-090 part 1. A permanently sold-out size, and the only one in the demo
      // data — every other type here has units available, so the facility
      // page's "Also here, currently full" section and the waitlist form on it
      // had nothing to render against.
      //
      // `count: 0` rather than occupied units: a unit marked occupied with no
      // lease behind it is a fiction the rent roll and the occupancy report
      // would both have to explain. A size with no units is an ordinary thing
      // for a site that has converted them, and it produces the same zero
      // availability.
      //
      // 5x15 deliberately, NOT 10x30 — B-089's e2e asserts that
      // /storage/tx/austin/size/10x30 is a 404, which is the "a size nobody
      // stocks in that city" case, and pricing a 10x30 here would turn that
      // assertion red.
      { name: '5x15 Climate', widthFt: 5, lengthFt: 15, climate: true, driveUp: false, street: 12_900, web: 10_900, count: 0 },
    ],
    // B-118's hero strip (the first 3) and the lazy gallery further down (the
    // rest) both read from this set — the primary demo facility, so the
    // a11y/reflow sweep that already covers it exercises both. FOUR rows, not
    // three: with exactly three the lower gallery section never renders at
    // all, and a dedup test that can pass on an empty, nonexistent section
    // proves nothing. Dallas and the e2e sandbox stay at zero on purpose, so
    // "no placeholder, no empty frame" keeps a real case too.
    photos: [
      { alt: 'The gated entrance and drive at Demo — Austin South', kind: 'exterior' },
      { alt: 'A row of ground-floor drive-up units', kind: 'unit' },
      { alt: 'The climate-controlled hallway leading to indoor units', kind: 'hallway' },
      { alt: 'The keypad at the gated entrance', kind: 'gate' },
    ],
  })

  const dallas = await seedFacility({
    slug: `${DEMO_PREFIX}dallas-north`,
    name: 'Demo — Dallas North',
    city: 'Dallas',
    postalCode: '75201',
    addressLine1: '1800 North Field Street',
    unitTypes: [
      { name: '10x15 Climate', widthFt: 10, lengthFt: 15, climate: true, driveUp: false, street: 19_900, web: 17_900, count: 8 },
      { name: '10x10 Drive-Up', widthFt: 10, lengthFt: 10, climate: false, driveUp: true, street: 15_900, web: 13_900, count: 8 },
    ],
  })

  // A facility that exists purely for the e2e suite.
  //
  // Reservation and checkout tests take real units and hold them, and with
  // `fullyParallel` across two browser projects a dozen of them land at once.
  // Sharing the Austin site meant they competed with each other AND with the
  // lifecycle fixtures, and a size would sell out mid-run — failing tests for a
  // reason that had nothing to do with the code. Houston keeps it out of the
  // 78704 search-ranking assertions, and it carries no lifecycle states, so
  // every unit is genuinely available.
  //
  // The count is headroom, not inventory realism. One full run takes about 52
  // units in 30-minute checkout locks plus a handful of reservation holds —
  // roughly 60, which is exactly what this used to have. With zero margin the
  // suite passed or failed on which tests happened to finish first, and a
  // handful of leaked holds pushed it over for good. 250 gives a full run four
  // times the room it needs, so cleanup between runs stops being load-bearing.
  const sandbox = await seedFacility({
    slug: `${DEMO_PREFIX}e2e`,
    name: 'Demo — E2E Sandbox',
    city: 'Houston',
    postalCode: '77002',
    addressLine1: '900 Bagby Street',
    unitTypes: [
      { name: '10x10 Test', widthFt: 10, lengthFt: 10, climate: true, driveUp: false, street: 14_900, web: 12_900, count: 250 },
    ],
  })

  // B-122. A code-gated promotion, so the code entry has something real to
  // accept — and so `PromoCode.usesCount` has a path to move at all, which
  // until this item it did not, anywhere.
  //
  // GATED, not automatic, and scoped to the sandbox facility: both halves of
  // that keep it invisible to every existing assertion. An automatic promo
  // would change the advertised price on a facility the smoke suite checks
  // totals against; this one changes nothing until a test types the code.
  //
  // `newTenantOnly: false` deliberately — the public checkout evaluates as a
  // new tenant, and making the seeded code depend on that would test the flag
  // rather than the code path this item built.
  const demoPromotion = await prisma.promotion.create({
    data: {
      name: `${DEMO_PREFIX}Half off your first month`,
      type: 'percent_off',
      value: 50,
      durationPeriods: 1,
      status: 'active',
      displayMode: 'code',
      facilityIds: [sandbox.facility.id],
      termsText: 'Half off your first month. New rentals only, one per customer.',
    },
  })
  await prisma.promoCode.create({
    data: { promotionId: demoPromotion.id, code: DEMO_PROMO_CODE },
  })

  // Every lifecycle state exists at BOTH facilities, so facility scoping is
  // demonstrable — a manager assigned to one must not see the other's tenants.
  const staffUser = await seedStaffOwner([austin.facility.id, dallas.facility.id])

  const first = await seedLifecycleStates(austin, 1, true, staffUser.id)
  // Indices continue from the first facility so tenant emails stay unique.
  await seedLifecycleStates(dallas, first.nextIndex, false, staffUser.id)

  // B-082 part 4. One redeemed promotion, so `/admin/reports/promotions` has a
  // populated table rather than only its empty state — the two-column split
  // between discount GIVEN and discount STILL TO GIVE is the entire point of
  // that report, and a column nothing ever renders is a column nobody checks.
  //
  // `ended` and `code`-gated, deliberately, and both halves matter. An ACTIVE
  // promotion would put a badge and a changed price on the Austin facility page
  // that the smoke suite asserts totals against — the exact reason B-122's own
  // seeded promo is code-gated, one block above. An ended past campaign is also
  // the realistic thing to be reading an ROI report about. No `PromoCode` row is
  // created, so there is no code any test could type to revive it.
  const roiLease = await prisma.lease.findFirst({
    where: { facility: { slug: `${DEMO_PREFIX}austin-south` }, status: 'active' },
    select: { id: true, facilityId: true, monthlyRateCents: true },
    orderBy: { startDate: 'asc' },
  })
  if (roiLease) {
    const halfCents = Math.round(roiLease.monthlyRateCents / 2)
    const roiPromotion = await prisma.promotion.create({
      data: {
        name: `${DEMO_PREFIX}Spring — half off two months`,
        type: 'percent_off',
        value: 50,
        durationPeriods: 2,
        status: 'ended',
        displayMode: 'code',
        facilityIds: [austin.facility.id],
        redemptionCount: 1,
        termsText: 'Half off your first two months. Ended campaign, kept for reporting.',
      },
    })
    // One of the two periods applied: the redemption has given away half of
    // what it committed, which is what makes "still to give" a non-zero number
    // on the report instead of a column of noughts.
    //
    // B-220. Dated into the middle of the LAST COMPLETE calendar month, not
    // left to `now()`. `promoRoiReport` filters on `createdAt`, and D-109 makes
    // every report default to that month — so a redemption stamped at seed time
    // lands in the CURRENT month and falls outside the window the report opens
    // on, in CI as much as locally. `admin-reports.spec.ts` then fails on the
    // "Discount given" column header, because a report with no rows renders no
    // table at all, which reads exactly like a broken report rather than a
    // fixture out of range.
    //
    // The 15th, so no timezone or month-length arithmetic can push it over a
    // boundary. **Reseed if a month has turned since you last did** — a fixture
    // pinned to seed time cannot follow a moving window, and the alternative
    // (re-stamping it in `e2e/global-setup.ts`) is machinery this does not need
    // until it bites.
    const seededAt = new Date()
    const lastMonth = new Date(
      Date.UTC(seededAt.getUTCFullYear(), seededAt.getUTCMonth() - 1, 15),
    )
    await prisma.promoRedemption.create({
      data: {
        createdAt: lastMonth,
        promotionId: roiPromotion.id,
        facilityId: roiLease.facilityId,
        leaseId: roiLease.id,
        schedule: [
          { periodIndex: 0, amountCents: halfCents },
          { periodIndex: 1, amountCents: halfCents },
        ],
        totalCents: halfCents * 2,
        appliedPeriods: [0],
      },
    })
  }

  const [facilityCount, unitCount, tenantCount, leaseCount] = await Promise.all([
    prisma.facility.count({ where: { slug: { startsWith: DEMO_PREFIX } } }),
    prisma.unit.count({ where: { facility: { slug: { startsWith: DEMO_PREFIX } } } }),
    prisma.tenant.count({ where: { email: { endsWith: DEMO_EMAIL_DOMAIN } } }),
    prisma.lease.count({ where: { facility: { slug: { startsWith: DEMO_PREFIX } } } }),
  ])

  console.info(
    `\nSeeded ${facilityCount} demo facilities, ${unitCount} units, ${tenantCount} tenants, ${leaseCount} leases.`,
  )
  console.info('Lifecycle states per facility:', Object.keys(first.summary).join(', '))
  if (NO_LOGINS) {
    console.info('\nNo passwords were set and no second factor was enrolled (--no-logins).')
    console.info('To sign in as a demo tenant, mint a reset link — nothing is emailed:')
    console.info(`  npm run db:reset-link -- --email ${DEMO_TENANT_EMAIL} --tenant`)
  } else {
    console.info(`\nSigned-in demo staff account: ${DEMO_STAFF_EMAIL} / ${DEMO_STAFF_PASSWORD}`)
  }
  console.info(`All demo rows are marked: facility slug "${DEMO_PREFIX}*", email "*@${DEMO_EMAIL_DOMAIN}".`)
  console.info('Re-running this script removes and recreates them; it writes no audit entries.')
}

// Only run when invoked directly. Without this, merely importing the module —
// as tests/seed-demo.test.ts does to read its exported constants — would tear
// down and rebuild the demo data as a side effect of a test run.
const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (invokedDirectly) {
  main()
    .catch((error) => {
      console.error(error)
      process.exitCode = 1
    })
    .finally(() => prisma.$disconnect())
}
