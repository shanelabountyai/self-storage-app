# Next

**B-262 — the Spanish stops at the signed-in product.** ([06-backlog.md](docs/prds/06-backlog.md), row 90n)

B-090f translated the move-in path; B-260 part 1 translated the portal. What
is left is everything a renter READS rather than operates:

1. **Static/legal pages** — `/faq`, `/about`, `/contact`, `/accessibility`,
   `/messaging-policy`. Cheapest, do first. `/terms` and `/privacy` stay
   English with the lease (D-122); the Spanish footer already says so.
2. **An owner decision before the SEO surfaces.** D-122 keeps the crawler on
   English, so translating the guides and the generated city/size intros
   produces Spanish prose Googlebot never sees, and makes a Spanish visitor
   and a crawler read different words from the same URL — the state D-77's
   duplicate-content gate reasons about. Ask before building.
3. **Then** the city/size landing pages and facility FAQs. The AUTHORED city
   copy is a `marketing:city_copy` column somebody typed in English: Spanish
   needs a second column AND its editor field in the same item.

The mechanism is done and documented in `apps/web/lib/i18n/` and D-122. Adding
a key to `en.ts` and not to `es.ts` fails `npm run typecheck`;
`tests/i18n.test.ts` covers placeholder parity and bans curly apostrophes in
English values (that bug changed 56 strings and was caught by e2e twice).

**Run `npm run db:reset-test` if the unit suite starts timing out** — it was at
9,322 facilities this session and eight suites failed on it, looking exactly
like a regression.

Also still open and still blocked on their own terms: **B-259** (Spanish
renters tick English consent boxes — needs its own version constants and a
legal read) and **B-261** (every email and text, including the dunning ladder,
still goes out in English — needs `Tenant.preferredLocale` and Spanish
templates).
