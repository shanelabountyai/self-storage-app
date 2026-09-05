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
// the unit. The account pays for DEMO_POS_TENANT_EMAIL's unit, chosen because
// it is the one active lease with a stable address AND because attaching it
// changes nothing about the POS tests that already take money against it —
// allocation widens for the PAYER, and Alex is not the payer.
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
