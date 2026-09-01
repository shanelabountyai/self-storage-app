// Pure resolution logic, deliberately free of any DB or Next.js import so it
// can run identically in a Server Component (for query scoping) and a Client
// Component (for rendering the <select>) without dragging Prisma into the
// browser bundle.

export const ALL_FACILITIES = 'all' as const

/// B-220. `timezone` (IANA, e.g. "America/Chicago") rides along because every
/// month-boundary default on an admin screen is a facility-local question and
/// the switcher is where a page learns which facility it is on. The management
/// pack read `getUTCMonth()` for want of it and offered a month that had not
/// ended locally.
export type SwitcherFacility = { id: string; name: string; slug: string; timezone: string }

export type SelectedFacility =
  | { mode: 'all' }
  | { mode: 'single'; facility: SwitcherFacility }
  | { mode: 'none' }

/// Resolves the switcher's current value from the cookie, falling back to a
/// sane default when the cookie is absent, stale, or points at a facility the
/// actor no longer has (a role change since the cookie was set must narrow
/// access immediately, not honor a cached choice).
///
/// `allowAll` gates both whether an 'all' cookie value is honored and whether
/// the UI renders the "All facilities" option — they must stay in lockstep, or
/// a <select> can end up with a value that has no matching <option>.
export function resolveSelectedFacility(
  cookieValue: string | undefined,
  facilities: readonly SwitcherFacility[],
  allowAll: boolean,
): SelectedFacility {
  if (cookieValue === ALL_FACILITIES && allowAll) return { mode: 'all' }

  const match = facilities.find((facility) => facility.id === cookieValue)
  if (match) return { mode: 'single', facility: match }

  if (facilities.length > 0) return { mode: 'single', facility: facilities[0] }
  return allowAll ? { mode: 'all' } : { mode: 'none' }
}

/// PRD 02 US-1 AC2: "All facilities" is offered only where there is something
/// to see across all of them.
///
/// It was `pathname === '/admin'` with a note saying the dashboard was the only
/// roll-up screen "before B-042's portfolio report". B-113 made four more, and
/// the mismatch was not cosmetic: the PAGES resolved with `canSeeAll` while the
/// SWITCHER resolved with this, so a persisted "all" cookie rendered a roll-up
/// under a switcher displaying a single facility's name.
export const ROLLUP_ROUTES = [
  '/admin',
  '/admin/units',
  '/admin/delinquency',
  '/admin/leads',
  '/admin/tasks',
  '/admin/reports',
] as const

export function isRollupRoute(pathname: string): boolean {
  return ROLLUP_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`))
}
