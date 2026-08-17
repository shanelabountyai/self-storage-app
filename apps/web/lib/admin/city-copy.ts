import { prisma } from '@storage/db'
import { recordAudit } from '@storage/core/audit'
import { citySlug } from '@storage/core/marketing'
import { citiesWithFacilities, facilitiesInCity } from '@/lib/facility/city-facilities'
import { cityIntro } from '@/lib/marketing/city-copy'
import { requirePermission } from '@/lib/rbac/authorize'
import { toAuditActor } from '@/lib/rbac/audit-actor'
import type { Actor } from '@/lib/rbac/actor'

// PRD 04 §3.2 US-4 AC1 (B-128, D-62). Writing a city page's intro.
//
// The permission is asked for with a NULL facility, like `org:defaults`: a city
// page lists every facility in the city, so there is no single site to scope
// the edit to and only an all-facilities assignment satisfies it. Using
// `facility:settings` instead would let a manager at one Austin location edit
// the page that also lists the two they do not run.
//
// The list of cities comes from the FACILITIES, never from the `city` table. A
// row can only be created for a city a facility puts on the map, so this screen
// cannot become a way to publish copy about a place we do not operate in.

export type CityCopyRow = {
  state: string
  /// The stored spelling, for display and for the URL.
  city: string
  slug: string
  facilityCount: number
  /// What has been written, or null when nobody has.
  authored: string | null
  /// What the page shows today — the authored paragraphs, or the generated
  /// ones. Rendered on the editor beside the box so "empty means generated" is
  /// something an operator can see rather than something a hint claims.
  rendered: string[]
}

export async function cityCopyRows(actor: Actor): Promise<CityCopyRow[]> {
  requirePermission(actor, 'marketing:city_copy', null)

  const cities = await citiesWithFacilities()
  const rows = await prisma.city.findMany({ select: { state: true, slug: true, intro: true } })
  // Keyed the way `authoredCityIntro` queries — lower-cased state and slug —
  // so the editor and the public page cannot disagree about which row belongs
  // to which page.
  const authoredBy = new Map(
    rows.map((row) => [`${row.state.toLowerCase()}/${row.slug}`, row.intro?.trim() || null]),
  )

  return Promise.all(
    cities.map(async (city) => {
      const slug = citySlug(city.city)
      const authored = authoredBy.get(`${city.state.toLowerCase()}/${slug}`) ?? null
      const facilities = await facilitiesInCity(city.state, city.city)
      return {
        state: city.state,
        city: city.city,
        slug,
        facilityCount: facilities.length,
        authored,
        rendered: cityIntro(city.city, city.state, facilities, authored),
      }
    }),
  )
}

export type CityCopyResult = { ok: true } | { ok: false; field: string; problem: string }

/// Roughly two screens of prose. High enough that nobody writing a genuine
/// city page hits it, low enough that a pasted document is refused rather than
/// published — the same "only the hard maximum refuses" rule the facility copy
/// editor follows.
export const CITY_INTRO_HARD_MAX = 4_000

export async function saveCityCopy(
  actor: Actor,
  state: string,
  city: string,
  intro: string,
): Promise<CityCopyResult> {
  requirePermission(actor, 'marketing:city_copy', null)

  const slug = citySlug(city)
  // A city with no active facility has no page (AC1 — it 404s), so writing copy
  // for one would publish nothing and quietly accumulate rows for places we do
  // not operate in. Checked against the facilities rather than against the form,
  // because the form's own values are whatever was posted.
  const facilities = await facilitiesInCity(state, city)
  if (!slug || facilities.length === 0) {
    return {
      ok: false,
      field: 'intro',
      problem: 'There are no active facilities in that city, so it has no page to put copy on.',
    }
  }

  if (intro.trim().length > CITY_INTRO_HARD_MAX) {
    return {
      ok: false,
      field: 'intro',
      problem: `That is over ${CITY_INTRO_HARD_MAX.toLocaleString('en-US')} characters, which is longer than any landing-page intro needs to be. Trim it, or clear the box to go back to the generated copy.`,
    }
  }

  // Empty means "use the generated intro", never "publish an empty page".
  const after = intro.trim() === '' ? null : intro.trim()
  const key = { state: state.toUpperCase(), slug }
  const before = await prisma.city.findUnique({
    where: { state_slug: key },
    select: { intro: true },
  })

  await prisma.$transaction(async (tx) => {
    await tx.city.upsert({
      where: { state_slug: key },
      create: { ...key, intro: after, updatedByStaffId: staffIdOf(actor) },
      update: { intro: after, updatedByStaffId: staffIdOf(actor) },
    })
    await recordAudit(
      {
        actor: toAuditActor(actor),
        action: 'city.copy_changed',
        entityType: 'City',
        // The slug, not a cuid: the row may not have existed a statement ago,
        // and the identity a person searching the audit log has is the URL.
        entityId: `${key.state.toLowerCase()}/${slug}`,
        before: { intro: before?.intro ?? null },
        after: { intro: after },
      },
      tx,
    )
  })

  return { ok: true }
}

function staffIdOf(actor: Actor): string | null {
  return actor.kind === 'staff' ? actor.staffUserId : null
}
