# Next

**B-262 is done** ([06-backlog.md](docs/prds/06-backlog.md), row 90n ✅). The
site publishes in English and Spanish at separate URLs with `hreflang`, and
PRD 04's "Multilingual SEO — English-only in MVP" is reversed (**D-123**).

## Still open on Spanish, both blocked on their own terms

- **B-259** — Spanish renters tick **English consent boxes**. Needs its own
  version constants and a legal read. It is also what unblocks
  `/messaging-policy` in Spanish: that page stays English today precisely
  because it is the URL an A2P 10DLC review reads and the target of the
  portal's consent control, and a Spanish policy backing an English consent
  record is worse than an English policy.
- **B-261** — every **email and text**, the dunning ladder included, still goes
  out in English. Needs `Tenant.preferredLocale` and Spanish templates.

## What B-262 left behind, and none of it owns a row yet

1. **The duplicate-content corpus is English only** (`lib/marketing/content-corpus.ts`).
   The Spanish URLs are indexable now and deserve D-77's gate against *each
   other* — four Spanish city intros can be as near-duplicate as four English
   ones. Needs the corpus built per locale and `/admin/reports/duplicate-content`
   showing both.
2. **The dictionary ships whole to every public page**, and the measurement
   says leave it. 1,030 keys, 71 KB of JSON but **~20 KB brotli**; the 105 keys
   that never reach a client component are only **4.5 KB brotli** of that, so
   splitting the server-only prose out buys almost nothing — the bulk is
   checkout, portal and facility strings the client genuinely needs. Revisit
   only if Core Web Vitals says so, and then with per-route key subsets.
3. **Full-route caching is still given up.** D-122 traded it for a cookie read
   in the root layout; a header read costs the same. The upgrade is
   `app/[locale]` with `generateStaticParams` — a route restructure, not a
   translation, and worth doing only if Core Web Vitals says so.
4. **A facility's own typed FAQ answers, and authored city copy, are English on
   both URLs** until somebody writes the Spanish box. That is the operator's
   words staying the operator's words (D-122), not a gap to close in code.

## A pre-existing failure, since fixed (`23feb38`)

`/admin/access has no WCAG 2.1 AA violations` was failing on
`th-has-data-cells` before B-262 and had nothing to do with it. It was **not** a
tool limitation: the gate log declared seven column headers and rendered six
cells, so everything from Unit rightward sat under the wrong heading and Flags
was empty on every row. `assertTableShape` now checks table shape directly on
every admin route the a11y loop visits, because axe only sees this bug when a
header points at nothing — a missing MIDDLE cell passes axe and mislabels every
column after it. Nothing outstanding.

## Local setup notes for whoever picks this up

- `npm run db:migrate:e2e` after checking out, and again after a migration —
  `db:migrate:test` never touches the `public` schema Playwright reads.
- The e2e server needs **`ACCESS_CODE_ENCRYPTION_KEY`** and
  **`HARDWARE_WEBHOOK_SECRET`** in `.env.local`. CI sets both (`ci.yml`); a
  laptop that does not gets one confusing failure — the phone-unlock spec fails
  to find its form, because enrolment refuses without the key and the e2e server
  runs a production build where the dev fallback does not apply.
