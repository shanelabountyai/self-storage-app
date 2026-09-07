// PRD 01 §6.8 / PRD 02 §5.5 FR-24 (B-139). What the accessibility scans cover,
// as one list rather than three spec files and a hand-written paragraph.
//
// ── Why this moved out of the specs ─────────────────────────────────────────
//
// `app/(public)/accessibility/page.tsx` is a PUBLIC CLAIM about this codebase,
// and it went false in both directions inside twelve days: once by
// UNDERSTATING (disclaiming checkout and payments as unbuilt after they had
// shipped) and once by OVERSTATING — it named exactly one coverage exception
// while `/portal/refer`, linked from the portal nav on every page, was in no
// scan and disclaimed by nothing. Both failures happened the same way: the page
// described work that lives somewhere else, so it went stale on a MERGE rather
// than on an edit, and nothing failed.
//
// So the exception list is no longer written on the page. The page renders it
// from `SCAN_EXCEPTIONS` below, the specs loop over the same arrays they always
// did, and `tests/a11y-scan-coverage.test.ts` fails when a route under
// `apps/web/app` appears in neither list. A new page is now a failing test
// rather than a quietly false sentence.

/// PRD 01 §6.8: "CI includes automated a11y checks (axe) on all key templates."
/// Every public route is listed here — a new page that is not added is a page
/// nobody checks, so this list is the contract.
export const PUBLIC_SCAN_ROUTES = [
  '/',
  '/storage/search?q=78704',
  // The three search outcomes render different templates, so each is its own
  // page as far as axe is concerned. 99501 is Anchorage — a real place with no
  // facility near it, which is the "nothing nearby" state.
  '/storage/search?q=99501',
  '/storage/search?q=zzzzz',
  // B-082 part 2. The city landing template — a list of facility cards, the
  // generated intro, and a second copy of the search form, which is the part
  // most likely to produce a duplicate-id or duplicate-landmark finding.
  '/storage/tx/austin',
  // B-089. The per-city/size landing page. Austin's 10×10 is the one that
  // renders every section this template has that no other page does — the
  // "what fits" list from the guide catalogue and the sibling-size links to
  // 5×5 and 10×20 — so a heading orphaned by any of them shows up here.
  '/storage/tx/austin/size/10x10',
  // US-103's facility detail template: hours tables, live unit list, and the
  // map iframe, which is the part axe is most likely to have an opinion about.
  '/storage/tx/austin/demo-austin-south',
  // The filtered view is a different template from the unfiltered one — it
  // renders the "nothing matches those filters" state and the applied controls.
  '/storage/tx/austin/demo-austin-south?size=small&features=climate&sort=size',
  // B-122. The promo-code box in its REFUSED state, which is different markup
  // from the resting one — `aria-invalid`, a described-by error, and red text
  // on a background nothing else on this page puts it on. The resting state
  // rides along on the two routes above; this is the one worth naming, because
  // an error message that fails contrast is an error message nobody reads.
  '/storage/tx/austin/demo-austin-south?promo=NOT-A-REAL-CODE',
  '/storage/size-guide',
  // B-082 part 3. The content hub's two templates. `climate-control` is the
  // richest guide — MDX prose, a CTA with a filter label, and an FAQ block of
  // <details> — and `packing-tips` is the same template with the FAQ and the
  // label absent, which is where a heading is most likely to end up orphaned.
  '/guides',
  '/guides/climate-control',
  '/guides/packing-tips',
  // B-267. This URL REDIRECTS — `unitType=INVALID` matches no unit type, so
  // `reserve/page.tsx` sends the visitor back to the facility page with
  // `?unavailable=1`, and the four loops below have always scanned that notice
  // rather than the reservation form. Named by its real destination now: the
  // coverage test strips the query string, so as
  // `.../reserve?unitType=INVALID` it satisfied the
  // `/storage/[state]/[city]/[slug]/reserve` pattern and the form itself went
  // unscanned by anything while the public statement counted it as covered.
  // The form is in `SCANNED_BY_OWN_SPEC` below — it needs a real unit-type
  // cuid, which no fixed URL can hold across a reseed.
  '/storage/tx/austin/demo-austin-south?unavailable=1',
  // The token-less and bad-token states of the reservation page are the ones a
  // crawler or a mistyped link reaches; the live states need a real hold.
  // B-090 part 1. The waitlist cancel link's not-found state — what a
  // truncated or already-used link from an email actually lands on, and the
  // only state of that page a scan can reach without a live entry.
  '/waitlist/cancel/not-a-real-token',
  '/reservations?token=not-a-real-token',
  '/checkout?token=not-a-real-session',
  '/faq',
  '/about',
  '/contact',
  '/terms',
  '/privacy',
  '/accessibility',
  '/messaging-policy',
  // B-119 (accessibility review 2026-08-12, test gap 1). Reachable by anyone
  // signed out — a bounced staff or tenant visit, a support email's link, a
  // mistyped one — and none of the five had ever been scanned. `/mfa` and
  // `/reauth` are NOT here: both require a session and just redirect to
  // `/login` without one, so they are scanned signed in, in `admin.spec.ts`,
  // alongside every other route that needs an actor.
  '/login',
  '/forgot-password',
  // No token, same as the reservation/checkout bad-token states above — the
  // state an expired or already-used email link actually lands on.
  '/reset-password',
  '/unsubscribe/not-a-real-token',
  // B-139. Two more states a real link lands on, both reachable with a bad
  // token — the same posture as the four routes above.
  '/checkout/resume/not-a-real-token',
  '/confirm-email',
]

/// B-119 (accessibility review 2026-08-12, test gap 2). Every STATIC portal
/// page — no `[param]` segment — belongs here, or nobody checks it, the same
/// contract `ADMIN_SCAN_ROUTES` keeps.
///
/// Left out on purpose: `/portal/documents/{id}` and
/// `/portal/statements/{leaseId}/{period}` need a real document or statement
/// id, and they are in `SCAN_EXCEPTIONS` below rather than merely absent.
/// `/portal/pay` needs a real lease id to render its actual content rather than
/// an empty-state stand-in, so `portal.spec.ts` reaches it through a real "Pay
/// now" click instead — recorded in `SCANNED_BY_OWN_SPEC`.
export const PORTAL_SCAN_ROUTES = [
  '/portal',
  '/portal/access',
  '/portal/contact',
  '/portal/documents',
  '/portal/methods',
  '/portal/move-out',
  '/portal/notifications',
  '/portal/protection',
  // B-139. Linked from the portal nav on EVERY page, in no scan, and
  // disclaimed by nothing — which is exactly what made the public
  // accessibility page's "one exception" sentence false in the overstating
  // direction.
  '/portal/refer',
  '/portal/statements',
  // B-139. Only its not-found state is reachable without a real payment, the
  // same posture as the bad-token public routes. The receipt's four outcome
  // states are a STATE gap, and B-156 owns those.
  '/portal/pay/done',
  // B-090 part 3. The "you're not on a plan" empty state is real, renderable
  // content for any logged-in tenant — unlike `/portal/pay`, nothing here
  // needs a real fixture to reach it, so the generic loop is enough. The
  // ACTIVE-plan state needs a real plan and is a STATE gap, in
  // `SCANNED_STATES` below.
  '/portal/payment-plan',
]

/// B-119 (accessibility review 2026-08-12, test gap 2). "Coverage grew by
/// accident rather than by contract" — B-115 added Tasks and Delinquency, B-116
/// fixed three routes' reflow, and nothing ever stepped back to name every
/// route admin actually has. This is that list: every STATIC admin page — one
/// with no `[param]` segment — belongs here, or nobody checks it.
///
/// Per-entity dynamic routes need a real demo id, which a list of static
/// strings cannot hold without breaking on every reseed. Each is either in
/// `SCANNED_BY_OWN_SPEC` (scanned against real demo data in its own topic file)
/// or in `SCAN_EXCEPTIONS`, and B-139's coverage test is what stops that
/// sentence going stale: the claim "each already has its own axe scan" was an
/// OVERSTATEMENT for months — the per-lease notices sub-route had none until
/// B-083 — because a comment asserting coverage rots exactly like the public
/// accessibility statement does, and for the same reason.
///
/// `/mfa` and `/reauth` are here rather than in the public list: both need a
/// session and redirect to `/login` without one.
export const ADMIN_SCAN_ROUTES = [
  '/admin',
  '/admin/comms/broadcast',
  '/admin/units',
  '/admin/units/types',
  '/admin/units/ready',
  '/admin/units/setup',
  // B-088 part 1. A price-change surface nobody scans is a price-change
  // surface nobody has checked.
  '/admin/units/rates',
  '/admin/tenants',
  '/admin/tenants/former',
  '/admin/leads',
  '/admin/billing',
  '/admin/billing/accounts',
  '/admin/delinquency',
  '/admin/overlocks',
  '/admin/walkthrough',
  '/admin/maintenance',
  '/admin/auctions',
  '/admin/rate-increases',
  '/admin/pos',
  '/admin/pos/drawer',
  '/admin/pos/merchandise',
  '/admin/pos/summary',
  // B-230. Where the Payment Element lands after a card taken at the counter.
  // Only its not-found state is reachable without a real card payment — the
  // same posture as `/portal/pay/done`, and for the same reason. The three
  // outcome states (taken, still confirming, declined) are a STATE gap the
  // tenant-facing receipt shares.
  '/admin/pos/card/done',
  '/admin/tasks',
  '/admin/access',
  '/admin/access/queue',
  '/admin/access/health',
  '/admin/reports',
  '/admin/reports/delinquency',
  '/admin/reports/deliverability',
  '/admin/reports/deposits',
  '/admin/reports/funnel',
  // B-082 part 4. Same contract as the public list: a page not here is a page
  // nobody checks.
  // B-084 parts 1 and 3. A page not on this list is a page nobody scans.
  '/admin/reports/close',
  // B-088 part 2.
  '/admin/reports/kpi',
  '/admin/reports/pack',
  '/admin/reports/subscriptions',
  '/admin/reports/promotions',
  '/admin/reports/indexation',
  '/admin/reports/duplicate-content',
  // B-087 part 1.
  '/admin/reports/structured-data',
  // B-090 part 1.
  '/admin/reports/waitlist',
  // B-195. A money screen nobody scans is a money screen nobody has checked.
  // Against demo data this renders its EMPTY state — nothing in the demo seed
  // places a hold or agrees a plan — so what is covered here is the page
  // furniture, the two tables' headers and the month picker. The populated
  // state needs the demo `PaymentPlan` and hold that B-196 owns.
  '/admin/reports/plans-holds',
  // B-163.
  '/admin/reports/protection',
  '/admin/reports/rent-roll',
  '/admin/reports/revenue',
  // B-092. A page not on this list is a page nobody scans — and this one is
  // reached by an owner reviewing whether staff misused a tenant's account,
  // which is not a screen to leave unchecked.
  '/admin/impersonation',
  '/admin/settings',
  '/admin/settings/delinquency',
  // B-237. The largest new form in this block, and the one that commits a site
  // to billing real tenants.
  '/admin/settings/facilities/new',
  '/admin/settings/marketing',
  // B-128. A page not on this list is a page nobody scans.
  '/admin/settings/marketing/cities',
  '/admin/settings/notices',
  '/admin/settings/org',
  '/admin/settings/promotions',
  '/admin/settings/reviews',
  // B-197. Four money limits and five forms — the screen that decides who may
  // give money away is not one to leave unscanned.
  '/admin/settings/roles',
  '/admin/settings/staff',
  '/admin/settings/suppressions',
  '/admin/settings/templates',
  '/admin/dev/keypad',
  '/mfa',
  '/reauth',
]

/// Routes scanned by a spec of their own rather than by the loops above,
/// because they need a click-through or a live fixture to render their real
/// content. Named here so the coverage test can tell "covered elsewhere" from
/// "not covered at all", and so a spec that stops scanning becomes a failing
/// test rather than a quiet gap — the test checks each file still runs axe.
export const SCANNED_BY_OWN_SPEC = [
  { route: '/portal/transfer', spec: 'e2e/portal-transfer.spec.ts' },
  { route: '/portal/pay', spec: 'e2e/portal.spec.ts' },
  { route: '/admin/tenants/[tenantId]', spec: 'e2e/admin-tenants.spec.ts' },
  { route: '/admin/tenants/[tenantId]/ledger/[leaseId]', spec: 'e2e/admin-tenants.spec.ts' },
  { route: '/admin/tenants/[tenantId]/notices/[leaseId]', spec: 'e2e/admin-tenants.spec.ts' },
  { route: '/admin/tenants/[tenantId]/move-out', spec: 'e2e/admin-move-out.spec.ts' },
  // B-156 / PRD 02 §5.5 FR-25(2). Was in `SCAN_EXCEPTIONS` claiming it "needs
  // a live tenant and an available unit" — the same requirement the move-out
  // row above has always met by reaching it through a real click-through
  // rather than a bare `goto`. The reviewers named this one specifically as
  // "in no scan at all"; it no longer is.
  { route: '/admin/tenants/[tenantId]/transfer', spec: 'e2e/admin-transfer.spec.ts' },
  // B-230. A static route, but its real content needs a live lease with a
  // balance — a bare `goto` renders only "we couldn't find a live lease", and
  // scanning that instead of the money form is exactly the overstatement this
  // file exists to stop. Reached the way the counter reaches it: a click from
  // a tenant's profile.
  { route: '/admin/pos/card', spec: 'e2e/admin-pos.spec.ts' },
  // B-090 part 5. Needs a real account id. A bare `goto` cannot produce one,
  // and the substance of the page — the units table, its totals and the two
  // controls beside them — only exists once an account has units, so reaching
  // it by a click from the list is the only way to scan the page rather than
  // an empty state.
  { route: '/admin/billing/accounts/[id]', spec: 'e2e/admin-billing-accounts.spec.ts' },
  // B-256. Needs a real account id AND a real month, neither of which a bare
  // `goto` can produce — and the substance of the page is the row per unit,
  // which only exists once an account has some. Reached the way the payer
  // reaches it: sign in, open the statements list, click a month under the
  // account heading.
  {
    route: '/portal/statements/account/[accountId]/[period]',
    spec: 'e2e/portal-billing-account.spec.ts',
  },
  // B-267. Needs a real unit-type cuid, which a fixed URL cannot hold across a
  // reseed — the reason the entry that used to stand for it in
  // `PUBLIC_SCAN_ROUTES` carried `unitType=INVALID` and therefore only ever
  // scanned the page it redirects to. Reached the way a renter reaches it: a
  // click on "Reserve for free" from a unit card.
  { route: '/storage/[state]/[city]/[slug]/reserve', spec: 'e2e/smoke.spec.ts' },
] as const

/// Who the page is for. The public statement lists the first two and not
/// `admin`: a visitor is owed an honest account of the surfaces THEY use, and a
/// list of unscanned staff reports would be noise on a page whose whole value
/// is that somebody reads it to the end.
export type ScanAudience = 'public' | 'portal' | 'admin'

export type ScanException = {
  /// The route as Next.js names it, `[param]` segments and all.
  route: string
  audience: ScanAudience
  /// Written for a visitor rather than for us: what is not checked, and why it
  /// cannot be. This is the sentence the public page renders verbatim.
  reason: string
  /// The same sentence in Spanish, because the accessibility statement itself
  /// is now bilingual (B-262) and half a list of gaps in the reader's language
  /// is worse than none — it reads as though the untranslated rows were the
  /// ones that did not matter.
  ///
  /// Optional rather than required, and enforced by
  /// `tests/a11y-scan-coverage.test.ts` instead of by the type: the admin rows
  /// are never rendered to a customer (staff screens are English throughout,
  /// D-122), so requiring one would buy nine Spanish sentences nobody ever
  /// reads. The test holds the rule that actually matters — every row a
  /// visitor is shown carries both languages.
  reasonEs?: string
}

/// Every route the automated run does not cover, with the reason it does not.
///
/// The bar for a row here is that scanning it is genuinely blocked, not that it
/// is awkward: `/portal/refer` was awkward, and it is scanned now.
export const SCAN_EXCEPTIONS: readonly ScanException[] = [
  {
    route: '/checkout#confirmation',
    audience: 'public',
    reason:
      'the checkout confirmation screen, which only exists after a real payment redirect and cannot be reproduced from outside the card processor\u2019s own frame',
    reasonEs:
      'la pantalla de confirmación de la renta, que solo existe después de un cobro real y no se puede reproducir fuera del marco del propio procesador de tarjetas',
  },
  {
    route: '/pay/[token]',
    audience: 'public',
    reason:
      'the one-tap payment screen a reminder links to, which needs a live link issued against a real balance',
    reasonEs:
      'la pantalla de pago de un toque a la que lleva un recordatorio, que necesita un enlace vivo emitido contra un saldo real',
  },
  {
    route: '/pay/[token]/done',
    audience: 'public',
    reason: 'the receipt shown after paying from that link, for the same reason',
    reasonEs:
      'el recibo que se muestra después de pagar desde ese enlace, por la misma razón',
  },
  {
    route: '/checkout/resume/[token]',
    audience: 'public',
    reason:
      'the live state of a resume link from an abandoned-booking email \u2014 the expired-link state it lands on is checked',
    reasonEs:
      'el estado vivo de un enlace para retomar una renta abandonada — el estado de enlace vencido al que llega sí se revisa',
  },
  {
    route: '/portal/documents/[documentId]',
    audience: 'portal',
    reason: 'a single stored document, which needs a real document on a real account',
    reasonEs:
      'un documento guardado en particular, que necesita un documento real en una cuenta real',
  },
  {
    route: '/portal/statements/[leaseId]/[period]',
    audience: 'portal',
    reason: 'a single month\u2019s statement, which needs a real statement on a real account',
    reasonEs:
      'el estado de cuenta de un mes en particular, que necesita un estado de cuenta real en una cuenta real',
  },
  {
    route: '/admin/auctions/[caseId]',
    audience: 'admin',
    reason: 'a staff-only auction case, which needs a live case',
  },
  {
    route: '/admin/leads/[leadId]',
    audience: 'admin',
    reason: 'a staff-only lead record, which needs a live lead',
  },
  {
    route: '/admin/tenants/[tenantId]/ledger/[leaseId]/statements',
    audience: 'admin',
    reason: 'a staff-only statement list, which needs a live lease',
  },
  {
    route: '/admin/tenants/[tenantId]/ledger/[leaseId]/statements/[period]',
    audience: 'admin',
    reason: 'a staff-only statement, which needs a live lease',
  },
] as const

/// The exceptions a visitor is owed, in the order the page prints them.
export function customerFacingExceptions(): readonly ScanException[] {
  return SCAN_EXCEPTIONS.filter((row) => row.audience !== 'admin')
}

// B-184 (T1) / PRD 02 §5.5 FR-25, FR-24. Everything above is keyed by ROUTE,
// so a page reached by `goto` alone is either scanned or excepted — but a
// route's real markup often depends on what you DID on it: a refusal, a
// disclosure opened, a confirm-and-echo step. B-159 finding 3 named the
// consequence: the exception list is route-keyed by construction, so a state
// gap could never appear in it while the page kept claiming to name every gap.
//
// This pair is the same contract, one level down. `SCANNED_STATES` is a
// promise the unit test below can check: the named spec actually runs axe on
// that route in that state, via a `// a11y-state: <route> | <state>` comment
// next to the scan, the same way `SCANNED_BY_OWN_SPEC` checks a route claim.
// `STATE_EXCEPTIONS` is for a state that is genuinely blocked rather than
// merely unscanned — needs live data nothing seeds, or a mismatch the UI no
// longer lets a real visitor reach at all.
//
// Neither list is exhaustive. A route can have states nobody has named here
// yet; that is a true gap, not one this pair claims to close. What it stops is
// the OVERSTATEMENT — a state named in a review, in a comment, in a test title
// — going unrecorded on the page that promises to name every gap.
export type ScannedState = {
  /// The route this is a state OF, not a URL of its own — `[param]` segments
  /// kept, same as `route` above.
  route: string
  /// A short name for the state, printed on the page and matched against the
  /// spec's `// a11y-state:` comment.
  state: string
  spec: string
  /// B-246, and this is the half B-215 left open.
  ///
  /// `SCANNED_STATES` is the AXE claim. The LAYOUT claim — 320px reflow, 200%
  /// zoom, forced text spacing — is `STATE_REACH` in
  /// `e2e/a11y-own-spec-routes.spec.ts`, and the contract between them ran one
  /// way only: every `STATE_REACH` key had to name a real scanned state, but
  /// nothing said a scanned state had to be measured or to say why not. So a
  /// state could have axe and no width at any viewport, be in neither list,
  /// and be invisible. Two of them were, both shipped by B-202–B-220.
  ///
  /// `reached` means `STATE_REACH` has a key for it. `excepted` means it is
  /// deliberately not measured, and `layoutException` says why. The unit test
  /// enforces both directions, so the third option — saying nothing — is gone.
  layout: 'reached' | 'excepted'
  /// Required when `layout` is `excepted`. A reason a person can disagree with,
  /// not "not done yet".
  layoutException?: string
}

export const SCANNED_STATES: readonly ScannedState[] = [
  // B-090 part 6 (D-122). The site now ships a second language, and the route
  // loops scan it in exactly one: they carry no locale cookie, so every one of
  // them measures English. That is not a defect — English is what a crawler
  // and a first-time visitor get — but it does mean the AA claim on this page
  // covered a set of strings no Spanish reader ever sees.
  //
  // One route closes that honestly rather than all of them badly: the facility
  // page, because it is the densest customer-facing layout at 320px and the
  // one a renter spends longest on. `layout: 'reached'` — `STATE_REACH` has a
  // key for it, so it is measured for reflow, zoom and text spacing as well as
  // scanned, which is the half that matters when the strings get ~20% longer.
  //
  // The other Spanish routes are a named gap, not a silent one: they are in
  // `STATE_EXCEPTIONS` below.
  {
    route: '/storage/[state]/[city]/[slug]',
    state: 'Spanish',
    spec: 'e2e/i18n.spec.ts',
    layout: 'reached',
  },
  // B-260. The portal dashboard in Spanish. Dana is seeded past-due with a
  // suspended access grant, so this scans the money and access branches rather
  // than an empty account — the states a Spanish reader is most likely to be
  // on this page for. `layout: 'excepted'` because `STATE_REACH` signs its
  // audiences in through `signIn` and the reflow loops in `portal.spec.ts`
  // already measure `/portal` as Dana at every width; what Spanish changes on
  // this route is string length inside the same one-column cards, and the
  // densest layout at 320px is the facility page, which IS measured above.
  {
    route: '/portal',
    state: 'Spanish',
    spec: 'e2e/i18n.spec.ts',
    layout: 'excepted',
    layoutException:
      'the portal reflow loops measure /portal as the same tenant at every width; Spanish changes string length inside the same single-column cards, and the tightest translated layout — the facility page — is measured above',
  },
  // B-269. The two pages D-123 and D-124 keep in ENGLISH, visited as a Spanish
  // reader. Not a translation check — there is nothing to translate — but the
  // one state in which the defect this item fixed could exist at all: the shell
  // is `<html lang="es">` and the prose inside it is English, so the markup
  // either declares the part's language (SC 3.1.2) or reads legal text aloud
  // with Spanish phonemes. Scanning them as an English visitor, which is all
  // the route loops have ever done, enters the state where the markup is
  // trivially correct and can never fail.
  //
  // `layout: 'excepted'` and the reason is unusually solid for once: the
  // rendered STRINGS are byte-for-byte the ones the public reflow, zoom and
  // text-spacing loops already measure on these two routes. What changes
  // between the two states is one attribute, which has no width.
  {
    route: '/terms',
    state: 'Spanish',
    spec: 'e2e/i18n.spec.ts',
    layout: 'excepted',
    layoutException:
      'the English strings on this route are identical in both states and are already measured at 320px, 200% zoom and forced text spacing by the public route loops; what the Spanish state changes is the lang attribute, which has no layout',
  },
  {
    route: '/privacy',
    state: 'Spanish',
    spec: 'e2e/i18n.spec.ts',
    layout: 'excepted',
    layoutException:
      'the English strings on this route are identical in both states and are already measured at 320px, 200% zoom and forced text spacing by the public route loops; what the Spanish state changes is the lang attribute, which has no layout',
  },
  // B-256. The portal route loop scans `/portal` and `/portal/pay` as Dana,
  // who holds units of her own and pays for no account — so a business
  // account's card, its units table and the consolidated bill on the pay
  // screen were markup no scan had ever seen. Both are reached by signing in
  // as the demo payer, which is what makes them measurable below too.
  {
    route: '/portal',
    state: 'business account card',
    spec: 'e2e/portal-billing-account.spec.ts',
    layout: 'reached',
  },
  {
    route: '/portal/pay',
    state: 'business account',
    spec: 'e2e/portal-billing-account.spec.ts',
    layout: 'reached',
  },
  // B-258. The MEMBER's half of that card is different markup, not a subset of
  // it: no Pay button, one fewer column in the units table, and a paragraph
  // saying who does pay. A scan of the payer's card measures none of it.
  {
    route: '/portal',
    state: 'business account card, member',
    spec: 'e2e/portal-billing-account.spec.ts',
    layout: 'reached',
  },
  // B-090 part 1's waitlist form, opened. The route loop scans the closed
  // disclosure; nothing inside it is in the accessibility tree until a click.
  {
    route: '/storage/tx/austin/demo-austin-south',
    state: 'waitlist form opened',
    spec: 'e2e/a11y.spec.ts',
    layout: 'excepted',
    layoutException:
      "The public route loop already measures this page at all three widths, and the disclosure adds one short form to a column layout the loop has held — the reflow risk is in the page, not in the two fields.",
  },
  // B-171. Both public marketing forms, refused.
  {
    route: '/storage/tx/austin/demo-austin-south',
    state: 'waitlist form refused',
    spec: 'e2e/smoke.spec.ts',
    layout: 'excepted',
    layoutException:
      "Same page and same form as the state above; the refusal adds an error summary to a container the public loop measures.",
  },
  {
    route: '/storage/tx/austin/demo-austin-south',
    state: 'lead form refused',
    spec: 'e2e/smoke.spec.ts',
    layout: 'excepted',
    layoutException:
      "As above — the public route loop measures this page, and the refusal adds a summary rather than a new layout.",
  },
  // A settings form refused (3.3.1/3.3.3/4.1.3) — axe only ever sees a
  // freshly-loaded page unless a spec drives it into the error branch itself.
  {
    route: '/admin/settings',
    state: 'settings submit refused',
    spec: 'e2e/admin.spec.ts',
    layout: 'excepted',
    layoutException:
      "The admin route loop measures `/admin/settings` at all three widths, and a refused submit adds `AdminForm`'s summary to that same measured container.",
  },
  // B-237. The new-facility form refused, and the same confirm-and-echo step
  // as the tax rate below — reused rather than reinvented, which is what the
  // backlog row asked for and what keeps 3.3.4 one pattern instead of two.
  {
    route: '/admin/settings/facilities/new',
    state: 'new facility submit refused',
    spec: 'e2e/admin.spec.ts',
    layout: 'excepted',
    layoutException:
      "The admin route loop measures this page at all three widths, and a refused submit adds `AdminForm`'s summary to that same measured container.",
  },
  {
    route: '/admin/settings/facilities/new',
    state: 'new facility confirm-and-echo',
    spec: 'e2e/admin.spec.ts',
    // NOT excepted: the echo is a six-row `<dl>` of long values — a full
    // address and a web address among them — which is a different shape from
    // the tax step's two short rows, and 320px is exactly where a `<dl>` of
    // long values stops being one.
    layout: 'reached',
  },
  // B-184 (T5). The confirm-and-echo step 3.3.4 depends on — the one place in
  // the product where an append-only row is agreed to before it publishes.
  {
    route: '/admin/settings',
    state: 'tax rate confirm-and-echo',
    spec: 'e2e/admin.spec.ts',
    layout: 'excepted',
    layoutException:
      "The confirm step renders inside the same `AdminForm` container on `/admin/settings` that the admin route loop measures at all three widths; what it adds is a `<dl>` of two columns, not a new grid.",
  },
  // The transfer wizard's priced settlement, which only renders after picking
  // a unit and recalculating — the base wizard is SCANNED_BY_OWN_SPEC, this is
  // the state one step past it.
  {
    route: '/admin/tenants/[tenantId]/transfer',
    state: 'settlement recalculated',
    spec: 'e2e/admin-transfer.spec.ts',
    layout: 'excepted',
    layoutException:
      "Reaching it needs a live settlement quote to go stale mid-flow (B-173), which is a timing state no measurement run can hold still.",
  },
  // The tenant profile with a disclosure open — everything behind a closed
  // <details> is invisible to axe, so the base scan alone would have missed
  // half the page's controls.
  {
    route: '/admin/tenants/[tenantId]',
    state: 'disclosure open',
    spec: 'e2e/admin-tenants.spec.ts',
    layout: 'excepted',
    layoutException:
      "The widest thing behind a disclosure on this profile is the payment-plan builder, and B-246 added that specifically to STATE_REACH — this state opens a narrower one on the same page.",
  },
  // B-086 part 1. The "Add someone" disclosure on the tenant's shared-access
  // list, opened. Same reason as the tenant profile above and the same rule
  // D-95 settled: this row put two new controls (a schedule select and a date
  // field) inside a closed <details>, and the base scan would have moved them
  // OUT of the audit rather than into it.
  {
    route: '/portal/access',
    state: 'add-someone disclosure open',
    spec: 'e2e/portal.spec.ts',
    layout: 'excepted',
    layoutException:
      "One short form inside the portal container the portal route loop already measures at all three widths.",
  },
  // B-086 part 2. The phone unlock refused. The enrolled state and the refusal
  // arrive together — the spec turns the key on if it is off, then presses
  // Open the gate against a suspended demo tenant — so one scan covers both
  // the control and the branch that matters: what the page looks like when the
  // gate does not open is the state a tenant is standing outside in.
  {
    route: '/portal/access',
    state: 'phone unlock refused',
    spec: 'e2e/portal.spec.ts',
    layout: 'excepted',
    layoutException:
      "A button and a sentence inside the portal container the portal route loop already measures at all three widths.",
  },
  // B-184 (T3). A refused task completion, added alongside the invalid-submit
  // scan this row required.
  {
    route: '/admin/tasks',
    state: 'completion refused',
    spec: 'e2e/admin-tasks.spec.ts',
    layout: 'excepted',
    layoutException:
      "B-221 gave this its own per-worker fixture; the card sits inside the queue list the admin route loop measures, and the refusal adds a summary rather than a grid.",
  },
  // B-233. The claimed state of a task card: the same card, with "Take this"
  // replaced by "Give back" and a live-region announcement of the change.
  // Driven against the same per-worker fixture as the refusal above.
  {
    route: '/admin/tasks',
    state: 'task claimed',
    spec: 'e2e/admin-tasks.spec.ts',
    layout: 'excepted',
    layoutException:
      'Shares B-221\'s per-worker fixture with the refusal state above, and for the same reason: the card sits inside the queue list the admin route loop already measures.',
  },
  // B-174. The one portal refusal that IS scanned — the sibling stale-preview
  // mismatch below is not (see STATE_EXCEPTIONS).
  {
    route: '/portal/move-out',
    state: 'date past the ceiling (refused)',
    spec: 'e2e/portal-move-out.spec.ts',
    layout: 'excepted',
    layoutException:
      "The portal route loop measures this page; the refusal adds a summary to it.",
  },
  // B-173's stale-preview guard, on all three screens it protects — type a
  // new value, skip the explicit recalculate control ("Recalculate",
  // "Update", "Show me what it costs"), submit directly. `stalePreview`
  // returns before anything is written on any of the three, which is what
  // makes the portal two safe against B-120's rule for shared demo state.
  {
    route: '/admin/tenants/[tenantId]/move-out',
    state: 'stale-preview refusal',
    spec: 'e2e/admin-move-out.spec.ts',
    layout: 'excepted',
    layoutException:
      "All three of these need a priced preview to go stale between render and submit (B-173) — a timing state, not a layout one, and the underlying pages are in the route loops.",
  },
  {
    route: '/portal/move-out',
    state: 'stale-preview refusal',
    spec: 'e2e/portal-move-out.spec.ts',
    layout: 'excepted',
    layoutException:
      "All three of these need a priced preview to go stale between render and submit (B-173) — a timing state, not a layout one, and the underlying pages are in the route loops.",
  },
  {
    route: '/portal/transfer',
    state: 'stale-preview refusal',
    spec: 'e2e/portal-transfer.spec.ts',
    layout: 'excepted',
    layoutException:
      "All three of these need a priced preview to go stale between render and submit (B-173) — a timing state, not a layout one, and the underlying pages are in the route loops.",
  },
  // B-187. Reachable only for a lapsed checkout session whose size has since
  // sold out — no route can be visited to reach it, the same reason the
  // waitlist-opened and stale-preview states above are states rather than
  // routes. `/checkout?token=not-a-real-session` in PUBLIC_SCAN_ROUTES scans
  // the bad-token state, not this one.
  {
    route: '/checkout',
    state: 'unit lost',
    spec: 'e2e/checkout-unit-lost.spec.ts',
    layout: 'excepted',
    layoutException:
      "Needs another session to claim the unit mid-checkout; the fallback offer renders inside the checkout container the public loop measures.",
  },
  // B-196. Six states behind ONE missing fixture. Every surface below renders
  // only for a lease under a hold or on a plan, and the demo seed placed
  // neither — so four of them were scanned in their empty state and declared as
  // STATE_EXCEPTIONS (three by B-090c/B-191/B-193, a third pair by B-195 the day
  // before this row), and two had never been scanned in any state at all. The
  // answer was a seed row rather than another exception: an agreed plan on its
  // own demo tenant, which reaches all six.
  {
    route: '/portal/payment-plan',
    state: 'active plan schedule',
    spec: 'e2e/portal.spec.ts',
    layout: 'reached',
  },
  {
    route: '/portal',
    state: 'payment plan card',
    spec: 'e2e/portal.spec.ts',
    layout: 'reached',
  },
  {
    route: '/admin/delinquency',
    state: 'the halted-leases section',
    spec: 'e2e/admin.spec.ts',
    layout: 'excepted',
    layoutException:
      "Rendered by `ArAgingSplitTable`, whose scroll wrapper and column count B-216 and B-217 measured on the two report routes the admin loop covers.",
  },
  {
    route: '/admin/reports/plans-holds',
    state: 'a facility with halted leases',
    spec: 'e2e/admin-reports.spec.ts',
    layout: 'excepted',
    layoutException:
      "Same component and same wrapper as the state above, behind a per-facility disclosure.",
  },
  // B-247. `/portal` is in the portal route loop, but the Manage disclosure is
  // CLOSED there — so the six links it reveals were in the accessibility tree
  // of no scan and measured at no width, which is how they kept a ~20px tap
  // target on the one nav a customer uses on a phone.
  {
    route: '/portal',
    state: 'manage menu open',
    spec: 'e2e/portal.spec.ts',
    layout: 'reached',
  },
  // The READ half of the profile's plan section, and a refused submit of the
  // builder — twelve fields called "Due" and "Amount ($)", scanned until now
  // only pristine. Two tenants: the schedule needs a lease WITH a plan, and the
  // builder is deliberately hidden on one, so the refusal happens on Dana's.
  // B-240. The sticky summary and the in-page nav, SCROLLED — which is the
  // only state in which the bar overlays anything. The route's own entry in
  // `SCANNED_BY_OWN_SPEC` measures this page at the top of the document, where
  // a sticky element is indistinguishable from a static one.
  {
    route: '/admin/tenants/[tenantId]',
    state: 'sticky summary',
    spec: 'e2e/admin-tenants.spec.ts',
    layout: 'reached',
  },
  {
    route: '/admin/tenants/[tenantId]',
    state: 'payment plan schedule',
    spec: 'e2e/admin-tenants.spec.ts',
    layout: 'reached',
  },
  {
    route: '/admin/tenants/[tenantId]',
    state: 'payment plan builder refused',
    spec: 'e2e/admin-tenants.spec.ts',
    layout: 'reached',
  },
  // B-213. The refusal that lands ON an installment, which is a different
  // rendering from the one above and had never been painted by any test: an
  // empty submit produces only plan-level problems, so `fieldErrors` is `{}`
  // and the fieldset error branch never runs.
  {
    route: '/admin/tenants/[tenantId]',
    state: 'payment plan builder refused per installment',
    spec: 'e2e/admin-tenants.spec.ts',
    layout: 'excepted',
    layoutException:
      "The same builder as the state above, which IS measured — this differs only in which error branch renders inside it, not in the grid that could overflow.",
  },
] as const

export type StateException = {
  route: string
  state: string
  audience: ScanAudience
  reason: string
  /// The same sentence in Spanish, because the accessibility statement itself
  /// is now bilingual (B-262) and half a list of gaps in the reader's language
  /// is worse than none — it reads as though the untranslated rows were the
  /// ones that did not matter.
  ///
  /// Optional rather than required, and enforced by
  /// `tests/a11y-scan-coverage.test.ts` instead of by the type: the admin rows
  /// are never rendered to a customer (staff screens are English throughout,
  /// D-122), so requiring one would buy nine Spanish sentences nobody ever
  /// reads. The test holds the rule that actually matters — every row a
  /// visitor is shown carries both languages.
  reasonEs?: string
}

/// The states a route can be in that no scan reaches, and why — the same bar
/// as `SCAN_EXCEPTIONS`: genuinely blocked, not merely unscanned yet.
export const STATE_EXCEPTIONS: readonly StateException[] = [
  // B-090 part 6 (D-122). Declared rather than left for the route loops to
  // quietly not reach. Every public route renders in Spanish and only the
  // facility page is scanned in it (`SCANNED_STATES` above), so the rest are
  // named here — the page promises to name every gap, and "the scan runs in
  // English" is a gap that did not exist a day ago.
  {
    route: '/',
    state: 'Spanish',
    audience: 'public',
    reason:
      'the a11y route loops carry no locale cookie, so every public route is scanned in English only; the facility page is scanned and measured in Spanish, and the two English legal pages are scanned as a Spanish reader sees them (both above), while the rest of the public site, this route included, is not yet',
    reasonEs:
      'las corridas de revisión automática no llevan la cookie de idioma, así que cada página pública se revisa solo en inglés; la página de una sucursal sí se revisa y se mide en español, y las dos páginas legales en inglés se revisan tal como las ve quien lee en español (ambas arriba), mientras que el resto del sitio público, incluida esta página, todavía no',
  },
  // B-260. The same gap one level in: the portal route loop signs a tenant in
  // with no locale cookie, so it scans English. `/portal` itself is scanned in
  // Spanish (above); the other ten portal routes are not yet.
  {
    route: '/portal/methods',
    state: 'Spanish',
    audience: 'portal',
    reason:
      'the portal a11y route loop carries no locale cookie, so every portal route but /portal is scanned in English only',
    reasonEs:
      'la corrida de revisión de la cuenta en línea no lleva la cookie de idioma, así que todas sus páginas menos /portal se revisan solo en inglés',
  },
  {
    route: '/checkout',
    state: 'Spanish',
    audience: 'public',
    reason:
      'reached in Spanish by e2e/i18n.spec.ts as far as step 1, which asserts the language rather than running axe — the later steps need a session the scan loop does not build',
    reasonEs:
      'en español se llega hasta el paso 1, que comprueba el idioma en vez de correr el revisor automático — los pasos siguientes necesitan una sesión que la corrida de revisión no arma',
  },
  // B-139 named `/portal/pay/done`'s not-found state as scanned; the four
  // outcomes below are what a real payment settles to, and the demo seed
  // creates none to settle.
  {
    route: '/portal/pay/done',
    state: 'succeeded',
    audience: 'portal',
    reason: 'the receipt for a payment that actually succeeded, which needs a real one on a real account',
    reasonEs:
      'el recibo de un pago que de verdad se aprobó, que necesita uno real en una cuenta real',
  },
  {
    route: '/portal/pay/done',
    state: 'failed',
    audience: 'portal',
    reason: 'the receipt for a payment that was actually declined, for the same reason',
    reasonEs:
      'el recibo de un pago que de verdad se rechazó, por la misma razón',
  },
  {
    route: '/portal/pay/done',
    state: 'processing',
    audience: 'portal',
    reason: 'the receipt for a payment still mid-flight, for the same reason',
    reasonEs:
      'el recibo de un pago todavía en curso, por la misma razón',
  },
  {
    route: '/portal/pay/done',
    state: 'pending',
    audience: 'portal',
    reason: 'the receipt for a payment awaiting settlement, for the same reason',
    reasonEs:
      'el recibo de un pago en espera de liquidación, por la misma razón',
  },
  // B-194. `recordNoticeGiven`'s two refusals now land on the field instead of
  // being discarded — but neither is reachable from a browser. `future_date`
  // is blocked first by the input's own `max`, which stops the submit before a
  // request leaves; `not_occupying` needs the lease to end in another tab
  // between this page rendering and its save. They are defence against a
  // crafted POST rather than states a scan can visit, and the copy behind them
  // is asserted by unit test instead (`tests/move-out-db.test.ts`).
  {
    route: '/admin/tenants/[tenantId]/move-out',
    state: 'notice-date refusal',
    audience: 'admin',
    reason:
      "unreachable from a browser: the input's own `max` blocks a future date before submit, and an ended lease needs it to end in another tab mid-page",
  },
  // B-179. Named in the accessibility statement's own history as the
  // route-versus-state gap this pair exists to close, rather than infer from
  // a green scan.
  {
    route: '/portal/documents',
    state: 'returned payment row',
    audience: 'portal',
    reason: 'the row a bounced payment renders, which needs one and the demo seed creates none',
    reasonEs:
      'la fila que dibuja un pago devuelto, que necesita uno y los datos de demostración no crean ninguno',
  },
  // B-137. Considered and deliberately not built: the demo seed's one
  // pending_auction lease belongs to a tenant with no portal credential, and
  // minting one to scan a paragraph and a link is a fixture nobody else needs.
  {
    route: '/portal/transfer',
    state: 'pending_auction refusal',
    audience: 'portal',
    reason:
      'the refusal shown to a tenant in the lien pipeline, which needs a lease in that state paired with a portal credential — the one demo lease that qualifies has none',
    reasonEs:
      'el rechazo que se le muestra a un inquilino que está en proceso de gravamen, que necesita un contrato en ese estado junto con un acceso a la cuenta en línea — el único contrato de demostración que califica no lo tiene',
  },
  // B-90 part 3 / B-193. The route loop scans the "you're not on a plan" empty
  // state; B-196's seed reaches the ACTIVE schedule, the "Left after" column and
  // the portal nav entry that renders alongside it (all now in SCANNED_STATES).
  //
  // What is left is what the seed deliberately does not create: a plan the
  // tenant has finished with. The page renders broken, cancelled and completed
  // schedules with their own status copy, and each needs a plan that reached
  // that end — a broken one needs a missed installment, which the delinquency
  // job would then produce on a schedule nobody controls, so the fixture would
  // show a different thing depending on when the jobs last ran. Narrowed rather
  // than deleted: the states are real and unscanned, and the page says so.
  {
    route: '/portal/payment-plan',
    state: 'a broken, cancelled or completed plan',
    audience: 'portal',
    reason:
      'the schedule of a plan the tenant has finished with, in any of its three ended states, which needs a plan that actually reached one — the demo plan is live and stays that way',
    reasonEs:
      'el calendario de un plan que el inquilino ya terminó, en cualquiera de sus tres estados finales, que necesita un plan que de verdad haya llegado a uno — el plan de demostración está vivo y así se queda',
  },
  // B-210. The same fixture problem one row down: every installment in the
  // demo plan is in the FUTURE by design (a past one would be broken by the
  // nightly job on a schedule nobody controls), so the schedule's two other
  // row states have never been scanned. B-210 added the second of them — an
  // installment inside D-98's grace, which now reads "Late — pay by <date>"
  // instead of "Missed" — so declaring the pair is the honest move rather than
  // leaving a state this item created undeclared.
  {
    route: '/portal/payment-plan',
    state: 'a late or missed installment row',
    audience: 'portal',
    reason:
      'the schedule rows for an installment past its date — inside its grace, and past it — which need an installment that has actually gone by, and one moves on its own the moment the nightly jobs run',
    reasonEs:
      'las filas del calendario de un abono que ya pasó su fecha — dentro de su periodo de gracia y después de él — que necesitan un abono que de verdad haya pasado, y uno de ellos se mueve solo en cuanto corren los trabajos nocturnos',
  },
  // B-215. `/admin/auctions` is in ADMIN_SCAN_ROUTES, and against demo data it
  // renders "no sale here is ready to advertise" — the lot sheet's populated
  // branch (the download link, the lot count, and B-205's per-lot
  // missing-description note with its links to each case) has been rendered by
  // no scan, and appeared in neither list while this pair claimed to name every
  // state anybody had named. Declared rather than seeded: reaching it needs a
  // case scheduled with a sale date that also clears every refusal the case
  // screen applies, and the demo seed schedules no sale.
  {
    route: '/admin/auctions',
    state: 'a sale ready to advertise',
    audience: 'admin',
    reason:
      'the lot sheet with lots on it, which needs a scheduled sale carrying a sale date and clearing every refusal check — the demo seed schedules none',
  },
  // B-191. The twin of the row above, and an omission B-090c left behind: the
  // dashboard has carried a payment-plan card since that item, in a state no
  // scan reached. B-196 closed the common one — "you're on a plan", with the
  // next payment named — and these two remain for the same reason as the row
  // above: both need a payment to have been missed, which no fixture can hold
  // still.
  // B-210 widened this from two warning states to three: a payment inside its
  // grace is now told apart from one past it, because the card called both a
  // missed payment while the plan was in fact alive for `planGraceDays` more.
  {
    route: '/portal',
    state: 'payment plan card, after a late or missed payment or a break',
    audience: 'portal',
    reason:
      'the three warning states of the plan card — a payment late inside its grace, a payment missed past it, and the plan ended because one was — which all need a plan that has actually let an installment date go by, and that state moves on its own the moment the nightly jobs run',
    reasonEs:
      'los tres estados de aviso de la tarjeta del plan — un abono con retraso dentro de su gracia, un abono perdido después de él, y el plan terminado porque uno lo estuvo — que necesitan un plan que de verdad haya dejado pasar la fecha de un abono, y ese estado se mueve solo en cuanto corren los trabajos nocturnos',
  },
] as const

/// The state exceptions a visitor is owed, same rule as `customerFacingExceptions`.
export function customerFacingStateExceptions(): readonly StateException[] {
  return STATE_EXCEPTIONS.filter((row) => row.audience !== 'admin')
}

// B-269 / WCAG 2.1 SC 3.1.2 Language of Parts (AA). The third contract in this
// file, and it exists for the same reason as the other two: a defect that no
// scan can see.
//
// ── Why axe cannot close this one ───────────────────────────────────────────
//
// D-122 keeps the chosen language in a cookie and the root layout sets
// `<html lang>` from it, so a Spanish visitor is served `<html lang="es">` on
// EVERY route — including the pages that are English, whether by decision
// (`/terms`, `/privacy`; D-123, D-124) or because nobody has translated them
// yet. English prose inside a Spanish document is announced with Spanish
// phonemes, and axe cannot detect it: no rule reads prose and decides what
// language it is in. `html-has-lang` and `valid-lang` both pass on the broken
// page. The route loops made it worse rather than better — they carry no
// locale cookie, so every automated scan visits as an English visitor, where
// the markup is trivially correct and the defect does not exist.
//
// So this is a LIST, checked by `tests/a11y-scan-coverage.test.ts` against the
// pages on disk, in the same shape as everything above: a public page either
// translates, or it says here that it does not and declares its language in
// its own markup. The next English page added under the translated shell is a
// failing unit test in the fast CI lane rather than a sentence somebody
// notices while reading markup for another reason.
export type EnglishPage = {
  /// The route, as Next.js names it — `[param]` segments kept, route groups
  /// stripped, the same spelling the lists above use.
  route: string
  /// Why this page is English, which is a different fact from whether it is
  /// marked: `decision` is settled (a decision row keeps it English),
  /// `untranslated` is a gap somebody will close.
  why: 'decision' | 'untranslated'
  /// What a reader is owed, in one line.
  note: string
}

/// Every public page that does NOT render from the dictionary. Each one carries
/// `lang="en"` in its own markup — the unit test checks that, so removing the
/// attribute fails the build rather than the page.
///
/// **A row leaves this list when its page is translated, not when somebody
/// remembers.** `/storage/[state]/[city]/[slug]/reserve` was here for the
/// length of one merge: B-269 marked it `lang="en"` against a `main` where the
/// form was still English, B-267 translated it, and the walker's
/// "lists no page that has since been translated" check failed on the merge —
/// which is the direction it was written for. A page-level `lang="en"` on a
/// translated page is the mirror defect, so the mark and the row go together.
export const ENGLISH_UNDER_A_TRANSLATED_SHELL: readonly EnglishPage[] = [
  {
    route: '/terms',
    why: 'decision',
    note: 'D-123 keeps the terms English until a lawyer says otherwise; `ProsePage` declares it',
  },
  {
    route: '/privacy',
    why: 'decision',
    note: 'D-124, same footing as the terms above; `ProsePage` declares it',
  },
  {
    route: '/waitlist/cancel/[token]',
    why: 'untranslated',
    note: 'reached from an email link and never translated; `ProsePage` declares it',
  },
  {
    route: '/reservations',
    why: 'untranslated',
    note: 'the reservation confirmation and its dead-link state, both English',
  },
  {
    route: '/checkout/resume/[token]',
    why: 'untranslated',
    note: 'two dead-link sentences, both English, on a page that otherwise redirects',
  },
  {
    route: '/guides',
    why: 'untranslated',
    note: 'the content hub; the guides themselves are authored English MDX',
  },
  {
    route: '/guides/[slug]',
    why: 'untranslated',
    note: 'one authored English guide, and translating the catalogue is not a dictionary change',
  },
  {
    route: '/storage/size-guide',
    why: 'untranslated',
    note: 'authored English marketing prose, same as the guides above',
  },
  {
    route: '/storage/[state]/[city]/size/[dimension]',
    why: 'untranslated',
    note: 'the generated per-city/size landing page, English generator and all',
  },
  {
    route: '/storage/[state]/[city]',
    why: 'untranslated',
    note: 'the one MIXED page on the public site: English prose around a translated search form, so the wrapper says `en` and the form declares the shell language back',
  },
]
