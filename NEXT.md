# Next

**B-262 — the SEO surfaces, and the owner decision in front of them.** ([06-backlog.md](docs/prds/06-backlog.md), row 90n)

Part 1 shipped on 2026-09-06: `/faq`, `/about`, `/contact`, `/accessibility` and
`/messaging-policy` read in the language the visitor chose. `/terms` and
`/privacy` stay English with the lease (D-122), and the Spanish footer now names
those two rather than saying "the legal pages" — a sentence that was about to
become false in the reader's eyes.

What is left of the row is the part that was never only a build:

1. **An owner decision, before any of it.** D-122 keeps the crawler on English
   (PRD 04 §3 scopes multilingual SEO out), so translating the guides and the
   generated city/size intros produces Spanish prose Googlebot never sees, and
   makes a Spanish visitor and a crawler read different words from the same URL
   — the state D-77's duplicate-content gate reasons about. **Ask before
   building.** The two answers lead to different work: keep the cookie strategy
   and translate for humans only, or move the public tree under `app/[locale]`
   with `hreflang`, which `lib/i18n/index.ts` already names as the upgrade path.
2. **Then** the city and size landing pages and the facility FAQs. The AUTHORED
   city copy is a `marketing:city_copy` column somebody typed in English:
   Spanish needs a second column **and** its editor field in the same item.
3. **The guides** (MDX prose, PRD 04 US-4) are the largest body of text and the
   most exposed to answer 1.

**What part 1 changed that the next session should know.** The accessibility
statement's two generated gap lists are message keys now, not English strings:
`SCAN_EXCEPTIONS` and `STATE_EXCEPTIONS` are split by audience, so an admin row
keeps its English sentence and a customer-facing row carries a `MessageKey`. A
new public or portal exception therefore does not compile without a translation
— which is the point, since that page promises to name every gap it has.

**B-263 was raised on the way and is not part of this row.** The customer
lexicon (§6.10, D-15) bans the word "lease" on customer surfaces; the dictionary
and three pages use it anyway, alongside "agreement" for the same concept, and
no test enforces the ban. Deliberately not fixed inside B-262 — the fix touches
checkout copy and its e2e text locators.

Also still open on their own terms: **B-259** (Spanish renters tick English
consent boxes — its own version constants and a legal read) and **B-261** (every
email and text, including the dunning ladder, still goes out in English — needs
`Tenant.preferredLocale` and Spanish templates).

**Run `npm run db:reset-test` if the unit suite starts timing out** — `audit_log`'s
append-only trigger means suites cannot reclaim their own facilities, and a
full-table scan failing on row count reads exactly like a regression.
