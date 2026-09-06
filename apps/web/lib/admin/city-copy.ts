import { prisma } from '@storage/db'
import { recordAudit } from '@storage/core/audit'
import { citySlug } from '@storage/core/marketing'
import { citiesWithFacilities, facilitiesInCity } from '@/lib/facility/city-facilities'
import { cityIntro } from '@/lib/marketing/city-copy'
import { LOCALES, type Locale } from '@/lib/i18n'
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
//
// B-262 gave the page a second language, so this screen has a box per language
// rather than one box. They are INDEPENDENT: writing English does not oblige
// anybody to write Spanish, and each language falls back to its own generated
// intro on its own. That is this repo's "a new column that configures behaviour
// gets its control in the same item" rule — `City.introEs` and the field that
// writes it ship together, because the alternative is a column reachable only
// from a database client, which took two clean-up passes to close last time.

/// One language's worth of a city page's intro.
export type CityCopyLocale = {
  /// What has been written, or null when nobody has.
  authored: string | null
  /// What the page shows today — the authored paragraphs, or the generated
  /// ones. Rendered on the editor beside the box so "empty means generated" is
  /// something an operator can see rather than something a hint claims.
  rendered: string[]
}

export type CityCopyRow = {
  state: string
  /// The stored spelling, for display and for the URL.
  city: string
  slug: string
  facilityCount: number
  /// B-262: keyed by language, so the screen renders one box per language from
  /// the list rather than from two hard-coded halves that a third language
  /// would silently not reach.
  copy: Record<Locale, CityCopyLocale>
}

export async function cityCopyRows(actor: Actor): Promise<CityCopyRow[]> {
  requirePermission(actor, 'marketing:city_copy', null)

  const cities = await citiesWithFacilities()
  const rows = await prisma.city.findMany({
    select: { state: true, slug: true, intro: true, introEs: true },
  })
  // Keyed the way `authoredCityIntro` queries — lower-cased state and slug —
  // so the editor and the public page cannot disagree about which row belongs
  // to which page.
  const authoredBy = new Map(
    rows.map((row) => [
      `${row.state.toLowerCase()}/${row.slug}`,
      { en: row.intro?.trim() || null, es: row.introEs?.trim() || null },
    ]),
  )

  return Promise.all(
    cities.map(async (city) => {
      const slug = citySlug(city.city)
      const stored = authoredBy.get(`${city.state.toLowerCase()}/${slug}`)
      const facilities = await facilitiesInCity(city.state, city.city)
      const copy = Object.fromEntries(
        LOCALES.map((locale) => {
          const authored = stored?.[locale] ?? null
          return [
            locale,
            {
              authored,
              rendered: cityIntro(city.city, city.state, facilities, authored, locale),
            },
          ]
        }),
      ) as Record<Locale, CityCopyLocale>

      return { state: city.state, city: city.city, slug, facilityCount: facilities.length, copy }
    }),
  )
}

export type CityCopyResult = { ok: true } | { ok: false; field: string; problem: string }

/// Roughly two screens of prose. High enough that nobody writing a genuine
/// city page hits it, low enough that a pasted document is refused rather than
/// published — the same "only the hard maximum refuses" rule the facility copy
/// editor follows.
export const CITY_INTRO_HARD_MAX = 4_000

/// Which column each language writes.
///
/// A map rather than a ternary at the two call sites, so adding a language is a
/// line here and a typecheck failure everywhere it is missed — the same reason
/// `Dictionary` is keyed rather than optional.
const INTRO_COLUMN: Record<Locale, 'intro' | 'introEs'> = {
  en: 'intro',
  es: 'introEs',
}

export async function saveCityCopy(
  actor: Actor,
  state: string,
  city: string,
  intro: string,
  locale: Locale,
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
  const column = INTRO_COLUMN[locale]
  const before = await prisma.city.findUnique({
    where: { state_slug: key },
    select: { intro: true, introEs: true },
  })

  await prisma.$transaction(async (tx) => {
    await tx.city.upsert({
      where: { state_slug: key },
      // Only the language being saved is written. Spelling it as a computed key
      // rather than two branches is what stops a Spanish save from clearing the
      // English column via an `intro: undefined` that Prisma would ignore on
      // `update` but write as null on `create`.
      create: { ...key, [column]: after, updatedByStaffId: staffIdOf(actor) },
      update: { [column]: after, updatedByStaffId: staffIdOf(actor) },
    })
    await recordAudit(
      {
        actor: toAuditActor(actor),
        action: 'city.copy_changed',
        entityType: 'City',
        // The slug, not a cuid: the row may not have existed a statement ago,
        // and the identity a person searching the audit log has is the URL.
        entityId: `${key.state.toLowerCase()}/${slug}`,
        before: { [column]: before?.[column] ?? null },
        after: { [column]: after },
        // The language goes in `context`, not in the before/after pair, and the
        // reason is `diffSnapshots`: it keeps only the keys that CHANGED, so a
        // locale present and identical on both sides is dropped before the row
        // is written. `context` is merged into `after` unconditionally, which
        // is what this field is for. An auditor reading "city.copy_changed"
        // needs to know WHICH page moved — `/storage/tx/austin` and
        // `/es/storage/tx/austin` are two pages.
        context: { locale },
      },
      tx,
    )
  })

  return { ok: true }
}

function staffIdOf(actor: Actor): string | null {
  return actor.kind === 'staff' ? actor.staffUserId : null
}
