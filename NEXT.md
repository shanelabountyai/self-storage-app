# Next

**B-261 — every email and text still goes out in English.** ([06-backlog.md](docs/prds/06-backlog.md))

B-259 shipped on 2026-09-06 (**D-125**) and was B-261's last blocker. The
renter can now browse, rent, pay, run their account and read the policy pages
in Spanish, and give consent in Spanish against a record that names the Spanish
words. Then we email them in English.

**The dunning ladder is why this one matters.** It ends in a lien file, so the
account least able to read our English is the account it matters most on.

The row's own shape:

1. **`Tenant.preferredLocale`** — written from the `st_locale` cookie at
   checkout, read by `deliverForRule`. It is a column that configures
   behaviour, so **its control ships in the same item** (this repo's rule, and
   five columns already shipped reachable only from a database client).
2. **A Spanish variant per seeded template.** The comms catalog is SEEDED
   state: `npm run db:migrate:test` after a template edit, and **again when you
   switch branches** — otherwise the suites fail as `expected [] to have a
   length of 1`, which reads exactly like a broken sender (B-206).
3. **Notices stay English regardless.** A lien notice is a legal document and
   D-122 keeps those in one language.

Two traps already paid for: a template's `requiredMergeFields` must be
satisfiable in BOTH languages or `renderEmail` throws and the message is
recorded `failed`; and anything asserting a MARKETING message was sent must pin
the clock with `vi.useFakeTimers({ toFake: ['Date'] })`, or it passes between
8am and 9pm Central and fails outside it.

Also newly open, both found while building B-259 and both smaller:
**B-263** (every field-validation message on the Spanish checkout is still
English — a type change, the validators must return keys) and **B-264** (the
lead form on the translated facility page is entirely English, its
marketing-email disclosure included).

Not open, and deliberately: the guides and the city/size SEO surfaces stay
English (**D-123**). Reversing that means reversing D-122 and PRD 04 §3.

**Run `npm run db:reset-test` if the unit suite starts timing out** —
`storage_test` accumulates facilities and the symptom reads exactly like a
regression.
