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
  '/storage/tx/austin/demo-austin-south/reserve?unitType=INVALID',
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
  '/admin/settings/marketing',
  // B-128. A page not on this list is a page nobody scans.
  '/admin/settings/marketing/cities',
  '/admin/settings/notices',
  '/admin/settings/org',
  '/admin/settings/promotions',
  '/admin/settings/reviews',
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
  },
  {
    route: '/pay/[token]',
    audience: 'public',
    reason:
      'the one-tap payment screen a reminder links to, which needs a live link issued against a real balance',
  },
  {
    route: '/pay/[token]/done',
    audience: 'public',
    reason: 'the receipt shown after paying from that link, for the same reason',
  },
  {
    route: '/checkout/resume/[token]',
    audience: 'public',
    reason:
      'the live state of a resume link from an abandoned-booking email \u2014 the expired-link state it lands on is checked',
  },
  {
    route: '/portal/documents/[documentId]',
    audience: 'portal',
    reason: 'a single stored document, which needs a real document on a real account',
  },
  {
    route: '/portal/statements/[leaseId]/[period]',
    audience: 'portal',
    reason: 'a single month\u2019s statement, which needs a real statement on a real account',
  },
  {
    route: '/admin/[section]',
    audience: 'admin',
    reason: 'staff-only placeholder sections',
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
}

export const SCANNED_STATES: readonly ScannedState[] = [
  // B-090 part 1's waitlist form, opened. The route loop scans the closed
  // disclosure; nothing inside it is in the accessibility tree until a click.
  {
    route: '/storage/tx/austin/demo-austin-south',
    state: 'waitlist form opened',
    spec: 'e2e/a11y.spec.ts',
  },
  // B-171. Both public marketing forms, refused.
  {
    route: '/storage/tx/austin/demo-austin-south',
    state: 'waitlist form refused',
    spec: 'e2e/smoke.spec.ts',
  },
  {
    route: '/storage/tx/austin/demo-austin-south',
    state: 'lead form refused',
    spec: 'e2e/smoke.spec.ts',
  },
  // A settings form refused (3.3.1/3.3.3/4.1.3) — axe only ever sees a
  // freshly-loaded page unless a spec drives it into the error branch itself.
  {
    route: '/admin/settings',
    state: 'settings submit refused',
    spec: 'e2e/admin.spec.ts',
  },
  // B-184 (T5). The confirm-and-echo step 3.3.4 depends on — the one place in
  // the product where an append-only row is agreed to before it publishes.
  {
    route: '/admin/settings',
    state: 'tax rate confirm-and-echo',
    spec: 'e2e/admin.spec.ts',
  },
  // The transfer wizard's priced settlement, which only renders after picking
  // a unit and recalculating — the base wizard is SCANNED_BY_OWN_SPEC, this is
  // the state one step past it.
  {
    route: '/admin/tenants/[tenantId]/transfer',
    state: 'settlement recalculated',
    spec: 'e2e/admin-transfer.spec.ts',
  },
  // The tenant profile with a disclosure open — everything behind a closed
  // <details> is invisible to axe, so the base scan alone would have missed
  // half the page's controls.
  {
    route: '/admin/tenants/[tenantId]',
    state: 'disclosure open',
    spec: 'e2e/admin-tenants.spec.ts',
  },
  // B-184 (T3). A refused task completion, added alongside the invalid-submit
  // scan this row required.
  {
    route: '/admin/tasks',
    state: 'completion refused',
    spec: 'e2e/admin-tasks.spec.ts',
  },
  // B-174. The one portal refusal that IS scanned — the sibling stale-preview
  // mismatch below is not (see STATE_EXCEPTIONS).
  {
    route: '/portal/move-out',
    state: 'date past the ceiling (refused)',
    spec: 'e2e/portal-move-out.spec.ts',
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
  },
  {
    route: '/portal/move-out',
    state: 'stale-preview refusal',
    spec: 'e2e/portal-move-out.spec.ts',
  },
  {
    route: '/portal/transfer',
    state: 'stale-preview refusal',
    spec: 'e2e/portal-transfer.spec.ts',
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
  },
] as const

export type StateException = {
  route: string
  state: string
  audience: ScanAudience
  reason: string
}

/// The states a route can be in that no scan reaches, and why — the same bar
/// as `SCAN_EXCEPTIONS`: genuinely blocked, not merely unscanned yet.
export const STATE_EXCEPTIONS: readonly StateException[] = [
  // B-139 named `/portal/pay/done`'s not-found state as scanned; the four
  // outcomes below are what a real payment settles to, and the demo seed
  // creates none to settle.
  {
    route: '/portal/pay/done',
    state: 'succeeded',
    audience: 'portal',
    reason: 'the receipt for a payment that actually succeeded, which needs a real one on a real account',
  },
  {
    route: '/portal/pay/done',
    state: 'failed',
    audience: 'portal',
    reason: 'the receipt for a payment that was actually declined, for the same reason',
  },
  {
    route: '/portal/pay/done',
    state: 'processing',
    audience: 'portal',
    reason: 'the receipt for a payment still mid-flight, for the same reason',
  },
  {
    route: '/portal/pay/done',
    state: 'pending',
    audience: 'portal',
    reason: 'the receipt for a payment awaiting settlement, for the same reason',
  },
  // B-179. Named in the accessibility statement's own history as the
  // route-versus-state gap this pair exists to close, rather than infer from
  // a green scan.
  {
    route: '/portal/documents',
    state: 'returned payment row',
    audience: 'portal',
    reason: 'the row a bounced payment renders, which needs one and the demo seed creates none',
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
  },
  // B-90 part 3. The base route loop scans the "you're not on a plan" empty
  // state (the common case); the schedule TABLE only renders once a lease
  // actually has an active plan, which the demo seed does not create.
  {
    route: '/portal/payment-plan',
    state: 'active plan schedule',
    audience: 'portal',
    reason:
      'the installment table a tenant on a plan sees, which needs a real PaymentPlan on a demo lease paired with a portal credential — none exists in the seed',
  },
] as const

/// The state exceptions a visitor is owed, same rule as `customerFacingExceptions`.
export function customerFacingStateExceptions(): readonly StateException[] {
  return STATE_EXCEPTIONS.filter((row) => row.audience !== 'admin')
}
