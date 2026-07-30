// Pure resolution logic, deliberately free of any DB or Next.js import so it
// can run identically in a Server Component (for query scoping) and a Client
// Component (for rendering the <select>) without dragging Prisma into the
// browser bundle.

export const ALL_FACILITIES = 'all' as const

export type SwitcherFacility = { id: string; name: string; slug: string }

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
