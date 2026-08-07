import { prisma } from '@storage/db'
import { canonicalPath, citySlugPath } from '@/lib/marketing/paths'

// PRD 04 FR-SEO-2 / US-3 AC4 (B-066). Keeping old URLs working.
//
// Two rules the PRD states separately and which are the same rule:
//
//   * "facility slug changes auto-create redirects" — a slug that has been
//     public has been linked to, indexed and possibly printed on a sign.
//   * "404/410 handling for retired facilities with 301s to the nearest city
//     page" — a closed site should hand its visitors to the next nearest
//     option, not to a dead end.
//
// Both are "never let a URL that once worked stop working", and both are
// cheapest to honour at the moment the change is made, which is why these are
// called from the mutation rather than swept up by a job.

/// Looks up a redirect for a path. Called from middleware on a would-be 404.
///
/// The path is canonicalised first so `/Storage/TX/Old-Slug/` finds the entry
/// stored as `/storage/tx/old-slug`.
export async function redirectFor(
  pathname: string,
): Promise<{ toPath: string; permanent: boolean } | null> {
  const { target } = canonicalPath(pathname)
  const hit = await prisma.urlRedirect.findUnique({
    where: { fromPath: target },
    select: { toPath: true, permanent: true },
  })
  return hit ?? null
}

/// Records a redirect. Idempotent, and never overwrites an existing entry.
///
/// First write wins deliberately. A slug renamed twice — `a` → `b` → `c` —
/// must leave `a → b` alone rather than rewriting it to `a → c`: the chain
/// still resolves in two hops, and blindly rewriting is how a rename cycle
/// (`a → b`, then `b → a`) turns into a redirect loop that takes the page off
/// the index entirely.
export async function recordRedirect(input: {
  fromPath: string
  toPath: string
  reason: string
  permanent?: boolean
}): Promise<void> {
  const from = canonicalPath(input.fromPath).target
  const to = canonicalPath(input.toPath).target
  // A self-redirect is a loop. Silently skipped rather than thrown: callers
  // reach here from a settings save, and a no-op rename should not error.
  if (from === to) return

  await prisma.urlRedirect.createMany({
    data: [{ fromPath: from, toPath: to, reason: input.reason, permanent: input.permanent ?? true }],
    skipDuplicates: true,
  })
}

/// FR-SEO-2's "facility slug changes auto-create redirects".
///
/// Called with the facility as it was BEFORE the change and as it is after —
/// because the old path cannot be reconstructed once the row has been updated,
/// and reconstructing it from a stale cache is how this quietly stops working.
export async function recordFacilityMove(
  before: { state: string; city: string; slug: string },
  after: { state: string; city: string; slug: string },
): Promise<void> {
  const from = facilityPathFor(before)
  const to = facilityPathFor(after)
  if (from === to) return

  await recordRedirect({ fromPath: from, toPath: to, reason: 'facility slug changed' })

  // The sub-pages move too. A renter with `/…/old-slug/reserve` bookmarked is
  // further along than one on the landing page, and dropping them at a 404 is
  // the more expensive of the two failures.
  for (const child of ['reserve', 'rent']) {
    await recordRedirect({
      fromPath: `${from}/${child}`,
      toPath: `${to}/${child}`,
      reason: 'facility slug changed',
    })
  }
}

/// US-3 AC4: a retired facility 301s to its city page rather than 404ing.
///
/// The city page is the "nearest" option in the sense that matters — it lists
/// every other site in the same city, which is what somebody looking for
/// storage in that city actually wants.
export async function recordFacilityRetirement(facility: {
  state: string
  city: string
  slug: string
}): Promise<void> {
  const from = facilityPathFor(facility)
  const to = citySlugPath(facility.state, facility.city)

  await recordRedirect({ fromPath: from, toPath: to, reason: 'facility retired' })
  for (const child of ['reserve', 'rent']) {
    await recordRedirect({
      fromPath: `${from}/${child}`,
      toPath: to,
      reason: 'facility retired',
    })
  }
}

function facilityPathFor(facility: { state: string; city: string; slug: string }): string {
  return canonicalPath(
    `/storage/${facility.state}/${facility.city.replace(/[^a-zA-Z0-9]+/g, '-')}/${facility.slug}`,
  ).target
}
