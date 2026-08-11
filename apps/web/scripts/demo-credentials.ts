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
