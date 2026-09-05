import { LocaleLink } from '@/components/site/locale-link'
import { notFound, permanentRedirect } from 'next/navigation'
import { SITE } from '@/lib/site-config'
import { formatRate } from '@/lib/format'
import { facilityPath } from '@/lib/facility/public-facility'
import {
  authoredCityIntro,
  facilitiesInCity,
  type CityFacility,
} from '@/lib/facility/city-facilities'
import { FacilitySearchForm } from '@/components/site/facility-search-form'
import {
  absoluteUrl,
  breadcrumbJsonLd,
  itemListJsonLd,
  renderJsonLd,
} from '@storage/core/marketing'
import { siteOrigin } from '@/lib/marketing/origin'
import { getLocale } from '@/lib/i18n/server'
import { OPEN_GRAPH_LOCALE, localePath } from '@/lib/i18n/routing'
import { localeAlternates, localeUrl } from '@/lib/marketing/alternates'
import { citySlugPath } from '@/lib/marketing/paths'
import {
  cityAmenities,
  cityDescription,
  cityIntro,
  cityLabel,
  cityTitle,
} from '@/lib/marketing/city-copy'

// PRD 04 §3.2 US-4 AC1 (B-082 part 2). The city landing page.
//
// This URL has been a live 301 target since B-066 and a 404 the whole time:
// `recordFacilityRetirement` sends every retired facility's page here, the
// facility page's breadcrumb names it, and `paths.ts` has carried a comment
// saying "B-071 builds the page itself" since — B-071 shipped reviews. Nothing
// caught it because nothing links here from a page a person browses.
//
// Rendered on demand and cached for five minutes rather than prerendered:
// AC3's "≤15-minute cache" on prices is the binding constraint and 300s is the
// same window `cachedPublicInventory` uses, so the two cannot disagree about
// how stale a price on this page may be. There is no `generateStaticParams` on
// purpose — a build-time list of cities goes stale the moment a facility is
// added, and this page's whole indexability rule (AC1) is "only when ≥1
// facility exists".

export const revalidate = 300

/// One resolution of the URL segments, used by the metadata and the page.
///
/// Returns the canonical path alongside the facilities so the caller can
/// redirect a non-canonical spelling — `/storage/tx/austin` is the page and
/// `/storage/tx/austin-tx` is not, and with no middleware in this app the page
/// is the only place that can enforce it (the facility page does the same).
async function resolveCity(state: string, city: string) {
  const facilities = await facilitiesInCity(state, city)
  if (facilities.length === 0) return null

  // The stored spelling wins. Every facility in the list is in the same city by
  // construction, so the first one carries the canonical name and state casing.
  const [first] = facilities
  return { facilities, canonical: citySlugPath(first.state, first.city), first }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ state: string; city: string }>
}) {
  const { state, city } = await params
  const resolved = await resolveCity(state, city)
  // AC1: "indexable only when ≥1 facility exists in the city." The page 404s
  // below; this is only what the head says on the way there.
  if (!resolved) return { title: 'City not found' }

  const { first, facilities, canonical } = resolved
  const title = cityTitle(first.city, first.state)
  const description = cityDescription(first.city, first.state, facilities)
  const locale = await getLocale()
  const url = absoluteUrl(siteOrigin(), localePath(locale, canonical))

  return {
    title,
    description,
    alternates: localeAlternates(locale, canonical),
    openGraph: {
      type: 'website',
      title,
      description,
      url,
      siteName: SITE.name,
      locale: OPEN_GRAPH_LOCALE[locale],
    },
    twitter: { card: 'summary_large_image', title, description },
  }
}

function FacilityCard({ facility }: { facility: CityFacility }) {
  const address = `${facility.addressLine1}${facility.addressLine2 ? `, ${facility.addressLine2}` : ''}, ${facility.city}, ${facility.state} ${facility.postalCode}`

  return (
    <li className="rounded-lg border p-4">
      <h3 className="text-lg font-medium">
        {/* The name is the link, not the card. A card-wide target swallows the
            address a reader may want to select and gives a screen reader one
            enormous link name — the same rule the search results follow. */}
        <LocaleLink href={facilityPath(facility)} className="underline underline-offset-4">
          {facility.name}
        </LocaleLink>
      </h3>

      <address className="text-muted-foreground mt-1 text-sm not-italic">{address}</address>

      {/* AC1's rating. Words and digits, no stars: a row of glyphs carries the
          score visually and says "black star black star" out loud, and 1.4.1
          forbids meaning carried by a visual treatment alone. The facility page
          has the reviews themselves; this is the comparison figure. */}
      {facility.rating && (
        <p className="text-muted-foreground mt-1 text-sm">
          Rated {facility.rating.ratingValue.toFixed(1)} out of 5, from{' '}
          {facility.rating.reviewCount} review{facility.rating.reviewCount === 1 ? '' : 's'}
        </p>
      )}

      {facility.amenities.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-2">
          {facility.amenities.map((amenity) => (
            <li key={amenity} className="bg-muted rounded-full px-3 py-1 text-xs">
              {amenity}
            </li>
          ))}
        </ul>
      )}

      <p className="mt-3 font-medium">
        {facility.fromWebRateCents === null ? (
          // Never a price for a facility with nothing rentable, and never $0.
          <>
            No units available right now —{' '}
            <a href={`tel:${SITE.phone.href}`} className="underline underline-offset-4">
              call {SITE.phone.display}
            </a>
          </>
        ) : (
          <>
            Units from {formatRate(facility.fromWebRateCents)}
            <span className="text-muted-foreground font-normal">/mo</span>
          </>
        )}
      </p>
    </li>
  )
}

export default async function CityPage({
  params,
}: {
  params: Promise<{ state: string; city: string }>
}) {
  const { state, city } = await params
  const resolved = await resolveCity(state, city)

  // AC1's indexability rule, enforced as a 404 rather than a `noindex` on an
  // empty page. A city with no facilities has nothing to say and no reason to
  // exist as a URL — and a thin page returning 200 is the shape a crawler
  // penalises the rest of the site for.
  if (!resolved) notFound()

  const { facilities, canonical, first } = resolved
  // B-262: every URL this page's structured data names is built in the language
  // being rendered, so a Spanish page's breadcrumb walks Spanish URLs.
  const locale = await getLocale()
  // One URL per city in the index rather than one per spelling anybody links.
  //
  // This is the SECOND of two layers, not the only one. The edge proxy
  // (`apps/web/proxy.ts` — Next 16's name for what used to be middleware, which
  // is why grepping for `middleware.ts` finds nothing) already lower-cases the
  // path, strips a trailing slash and collapses repeated slashes, so casing
  // never reaches this line. What does reach it is a spelling the proxy
  // considers canonical and the city record does not: `/storage/tx/austin--`
  // and `/storage/tx/fort--worth` are both lower-case with no trailing slash,
  // both resolve through `citySlug`, and neither is the URL the sitemap lists.
  // The facility page below carries the same guard for the same reason.
  if (`/storage/${state}/${city}` !== canonical) permanentRedirect(canonical)

  const label = cityLabel(first.city, first.state)
  // B-128 / D-62. Authored copy when somebody has written it, the generated
  // intro when nobody has — which is every city until they do. Looked up with
  // the STORED spelling rather than the URL segment so the two callers of
  // `authoredCityIntro` (here and the duplicate-content corpus) cannot resolve
  // to different rows for the same page.
  const intro = cityIntro(
    first.city,
    first.state,
    facilities,
    await authoredCityIntro(first.state, first.city),
  )
  const amenities = cityAmenities(facilities)
  const canonicalUrl = localeUrl(locale, canonical)

  // FR-SEO-4's `ItemList` for a city page — the list IS the page, and its
  // items are the facility links rendered below, built from the same array so
  // the markup cannot describe a list the reader is not looking at.
  const schema = [
    itemListJsonLd(
      facilities.map((facility) => ({
        name: facility.name,
        url: localeUrl(locale, facilityPath(facility)),
      })),
      `Self-storage facilities in ${label}`,
    ),
    breadcrumbJsonLd([
      { name: 'Storage', url: localeUrl(locale, '/storage/search') },
      { name: label, url: canonicalUrl },
    ]),
  ].filter((node): node is NonNullable<typeof node> => node !== null)

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-12">
      {schema.map((node, index) => (
        <script
          key={index}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: renderJsonLd(node) }}
        />
      ))}

      <h1 className="text-3xl font-semibold tracking-tight text-balance">
        Storage units in {label}
      </h1>

      <div className="mt-4 flex flex-col gap-3">
        {intro.map((paragraph, index) => (
          <p key={index} className="text-pretty">
            {paragraph}
          </p>
        ))}
      </div>

      <section aria-labelledby="locations" className="mt-10">
        <h2 id="locations" className="text-xl font-medium">
          {facilities.length === 1 ? 'Our location' : `All ${facilities.length} locations`} in{' '}
          {label}
        </h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Cheapest first. Prices are the online rate and update through the day.
        </p>
        <ul className="mt-4 flex flex-col gap-4">
          {facilities.map((facility) => (
            <FacilityCard key={facility.id} facility={facility} />
          ))}
        </ul>
      </section>

      {/* Only worth a section once there is more than one facility to pool.
          With a single location this section is the card's own amenity pills
          printed a second time, twenty lines lower — which is padding, and
          padding is the thin content the unique-copy requirement is about. */}
      {facilities.length > 1 && amenities.length > 0 && (
        <section aria-labelledby="amenities" className="mt-10">
          <h2 id="amenities" className="text-xl font-medium">
            What you will find in {first.city}
          </h2>
          <p className="text-muted-foreground mt-1 text-sm text-pretty">
            Across these locations. Not every feature is at every site — each facility page lists
            its own.
          </p>
          <ul className="mt-4 flex flex-wrap gap-2">
            {amenities.map((amenity) => (
              <li key={amenity} className="bg-muted rounded-full px-3 py-1 text-sm">
                {amenity}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* AC1 also asks for distance, and a city page has no point to measure
          from — nobody typed a zip to get here. Rather than print a distance
          from an invented origin (D-59), this hands over the search that can
          actually compute one, prefilled with the city. */}
      <section aria-labelledby="nearby" className="mt-10">
        <h2 id="nearby" className="text-xl font-medium">
          Somewhere specific in {first.city}?
        </h2>
        <p className="text-muted-foreground mt-1 text-sm text-pretty">
          Search by zip code to see distances from where you are.
        </p>
        <div className="mt-4">
          <FacilitySearchForm defaultValue={label} labelKey="search.labelZipOrCity" />
        </div>
      </section>

      <p className="text-muted-foreground mt-10 text-sm text-pretty">
        Not sure what size you need? Read the{' '}
        <LocaleLink href="/storage/size-guide" className="underline underline-offset-4">
          size guide
        </LocaleLink>
        , or{' '}
        <LocaleLink href="/storage/search" className="underline underline-offset-4">
          look at other cities
        </LocaleLink>
        .
      </p>
    </div>
  )
}
