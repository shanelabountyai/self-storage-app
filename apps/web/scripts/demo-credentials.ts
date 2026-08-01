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
