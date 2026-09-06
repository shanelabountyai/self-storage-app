# Next

**B-259 — Spanish renters tick English consent boxes.** ([06-backlog.md](docs/prds/06-backlog.md))

B-262 finished the reading surfaces and handed this row one more page:
`/messaging-policy` (**D-124**). So B-259 is now three things, and they are one
item because they share the same blocker:

1. **The three consent disclosures on checkout step 1** — TCPA, E-SIGN and the
   marketing opt-in. Each is recorded as a `Consent` row stamped with an
   English **disclosure version constant**. Translating the words without
   versioning the Spanish is evidence of a consent nobody gave (D-122 says so
   in those terms).
2. **`/messaging-policy`** — the A2P 10DLC / TCPA disclosure page a carrier and
   a campaign review read. Its keywords (STOP, HELP, START, UNSTOP) are English
   by construction in `packages/core/comms/sms-keywords.ts`, so a Spanish page
   still has to instruct in English.
3. **The version constants themselves** need a Spanish sibling per disclosure,
   and the consent record has to carry which language was shown.

**It is blocked on a legal read, not on code.** Do not start by translating —
start by asking what a Spanish consent record has to look like.

If the answer is "not yet", **B-261** is the unblocked one: every email and
text still goes out in English, including the dunning ladder, to the account
least able to read it. Needs `Tenant.preferredLocale` (a column, so its
control ships in the same item) and a Spanish variant per seeded template —
and remember the comms catalog is SEEDED state, so `npm run db:migrate:test`
after a template edit and again when you switch branches.

Not open, and deliberately: the guides and the city/size SEO surfaces stay
English (**D-123**). No row exists for them. Reversing that means reversing
D-122 and PRD 04 §3 as well.

**Run `npm run db:reset-test` if the unit suite starts timing out** —
`storage_test` was at 233 facilities on 2026-09-06 and healthy, but it
accumulates and the symptom reads exactly like a regression.
