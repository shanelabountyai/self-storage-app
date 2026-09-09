// Shared by the demo seed and the e2e suite, and deliberately free of imports:
// Playwright transpiles whatever the spec files reach, and pulling in the seed
// script itself would drag Prisma and `import.meta` into the test runner.
//
// See seed-demo.mts for why a known-password staff account exists at all — in
// short, the admin surface could not be accessibility-scanned without a
// session, which is how it came to carry most of the audit's blocking findings.
// The account is created through the ordinary owner + all-facilities path
// (D-12, no bypass flag), and the seed that makes it refuses to run with
// NODE_ENV=production.
export const DEMO_EMAIL_DOMAIN = 'demo.example.com'
export const DEMO_STAFF_EMAIL = `owner@${DEMO_EMAIL_DOMAIN}`
export const DEMO_STAFF_PASSWORD = 'demo-owner-password'

// B-034. A known-password tenant so the portal can be signed into and
// accessibility-scanned the same way DEMO_STAFF_EMAIL covers admin. Bound to
// the seed's delinquent lease on purpose — that one tenant exercises the
// past-due banner and the suspended gate-code panel in the same login a
// plain "everything's fine" tenant would not.
export const DEMO_TENANT_EMAIL = `dana@${DEMO_EMAIL_DOMAIN}`
export const DEMO_TENANT_PASSWORD = 'demo-tenant-password'

// B-039. A separate tenant for tests that TAKE MONEY.
//
// The POS e2e test records a real payment, which permanently moves a ledger
// balance — and pointed at DEMO_TENANT_EMAIL it silently paid off the $161
// past-due balance that B-034/B-035/B-038 all assert on, over about nine
// runs. Anything in the suite that mutates money has to aim at a tenant whose
// balance nothing else depends on.
export const DEMO_POS_TENANT_EMAIL = `pos-tenant@${DEMO_EMAIL_DOMAIN}`

// B-090 part 5. The payer on the demo business account.
//
// A tenant of their own with no lease, which is the ordinary shape: the person
// at the company who settles the bill is rarely the person whose goods are in
// the unit.
//
// The account pays for the two anonymous active units at the primary facility,
// and deliberately NOT for DEMO_POS_TENANT_EMAIL's. B-090e attached that one —
// safe while an account was only a staff screen — and B-256 moved it off,
// because the POS specs take real money against that lease every sweep and
// never reverse it, so an account holding it walks into credit and the payer's
// portal card loses the Pay button the specs are there to scan. See the note
// beside the attach in seed-demo.mts.
//
// B-256 also gives this account a PASSWORD (DEMO_TENANT_PASSWORD): the payer's
// portal is a customer-facing surface, and a customer-facing surface with no
// session cannot be accessibility-scanned.
export const DEMO_BUSINESS_PAYER_EMAIL = `business@${DEMO_EMAIL_DOMAIN}`
export const DEMO_BUSINESS_ACCOUNT_NAME = 'Acme Contracting'

// B-079. Staff MFA is mandatory, so the demo owner has to hold a real second
// factor or the e2e suite reaches the enrolment screen and nothing else.
//
// A fixed, published TOTP secret is the same class of thing as the fixed
// password above and carries the same guard: seed-demo.mts refuses to run with
// NODE_ENV=production, and this account exists only in a throwaway demo
// database. Publishing it is what lets the suite exercise the REAL second
// factor rather than a test-only bypass — there is no "skip MFA in tests" flag
// anywhere, which is the point.
//
// Base32, 20 bytes, as RFC 4226 §4 R6 recommends.
export const DEMO_STAFF_TOTP_SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP'

// B-122. A code-gated promotion the e2e suite can actually type in.
//
// Code-gated deliberately, and that is what makes it safe to seed at all: an
// AUTOMATIC promotion changes every price on the facility it touches, and the
// smoke suite asserts real totals. A gated one is invisible until somebody
// enters the code, so it disturbs nothing until a test asks for it.
//
// Scoped to the e2e sandbox facility for the same reason the POS tenant is its
// own tenant — the sandbox is where checkout tests already take real units, and
// Austin's and Dallas's advertised prices stay exactly as every other suite
// expects them.
export const DEMO_PROMO_CODE = 'E2ESAVE'

// B-196. A tenant whose lease is on an agreed payment plan.
//
// Its own tenant rather than the plan being put on Dana, for the reason the POS
// tenant above is its own: an active plan places a `payment_plan` hold, and that
// hold halts dunning, late fees and access suspension on the lease it sits on.
// Dana is the lease the portal past-due banner, the suspended gate-code panel,
// the delinquency queue and the dunning specs all depend on being CHASED —
// `admin-tenants.spec.ts` says so in as many words, and the plan builder's own
// disclosure disappears from a lease that already has an active plan, which
// would take the scan of that form with it.
//
// What this one exists for: `/portal/payment-plan`'s schedule, the dashboard's
// plan card, `/admin/reports/plans-holds`'s halted table and `/admin/delinquency`'s
// halted section all render only for a lease under a hold, and the demo seed
// placed none — four surfaces scanned in their empty state and declared as
// STATE_EXCEPTIONS. The published tenant password is reused; there is nothing
// this account can do that Dana's cannot.
export const DEMO_PLAN_TENANT_EMAIL = `pia@${DEMO_EMAIL_DOMAIN}`

// A tenant whose lease is CURRENT — nothing past due, ever.
//
// Its own stable address for the reason DEMO_POS_TENANT_EMAIL has one: a spec
// that needs a particular fixture cannot name it through `makeTenant`, whose
// address is `${first}.${last}${index}@…` off a running counter shared by every
// preceding fixture. Insert or reorder anything earlier in the seed and every
// address below it shifts. `admin-tenants.spec.ts` pinned `alex.active5@` that
// way, and the address did not stop RESOLVING — it started resolving to the
// wrong tenant, which is the worse failure because it reads as a product bug.
// Verified against a fresh seed: `alex.active5@` is now the second active lease
// at the primary facility, the one `seedUnpaidRent` gives a $161 unpaid month so
// the business account has a total to render. The spec asserting "nothing past
// due" was therefore pointed at the one active tenant that owes money, the
// payment-plan disclosure correctly rendered, and B-212's assertion that it must
// not correctly failed. The guard was right, the test was right, and the fixture
// had wandered underneath both.
//
// This is the third active lease at the primary facility, which is the one of
// the three that owes nothing: the first is DEMO_POS_TENANT_EMAIL, whose
// balance the POS specs move every sweep, and the second carries the unpaid
// month that gives the business account a total to render. Nothing seeds an
// invoice against this one, and `makeLease` creates none, so `arrearsCents` is
// 0 by construction rather than by nobody having disturbed it yet.
//
// It is on the demo business account (B-256 put the second and third there).
// That does not affect what this fixture is for — a lease with no invoices has
// no arrears whether or not somebody else settles its bill — but a spec that
// needs a current tenant on NO account needs a fourth lease, and a fourth lease
// moves the occupancy and revenue numbers the smoke suite asserts on.
export const DEMO_CURRENT_TENANT_EMAIL = `current-tenant@${DEMO_EMAIL_DOMAIN}`

// B-258. An authorized MEMBER of the demo business account: somebody who sees
// the account and cannot pay it.
//
// A separate tenant from DEMO_BUSINESS_PAYER_EMAIL because the two halves of
// this row are exactly what one is allowed to do and the other is not, and the
// member's card renders differently from the payer's — no Pay button, no
// "Rented by" column, no statements link. A portal surface with no session
// cannot be accessibility-scanned, so this one carries DEMO_TENANT_PASSWORD for
// the same reason the payer does.
//
// Holds no lease, which is the shape the row is about: an office manager who
// does not rent a unit and does not sign the cheques.
export const DEMO_BUSINESS_MEMBER_EMAIL = `bookkeeper@${DEMO_EMAIL_DOMAIN}`
