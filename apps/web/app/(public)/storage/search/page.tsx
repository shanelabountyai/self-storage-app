import Link from 'next/link'
import { FacilitySearchForm } from '@/components/site/facility-search-form'
import { SITE } from '@/lib/site-config'
import { formatRate } from '@/lib/format'
import { facilityPath } from '@/lib/facility/public-facility'
import {
  searchFacilities,
  SEARCH_RADIUS_MILES,
  type FacilityResult,
  type SearchOutcome,
} from '@/lib/geo/facility-search'
import { ResultsMap, type MapFacility } from '@/components/site/results-map'
import { FEATURE_FILTERS, parseFilters, SIZE_BANDS } from '@/lib/inventory/unit-filters'

export const metadata = {
  title: 'Find storage',
  // One canonical for every result view. This page takes `?q=`, `?lat=&lng=`
  // and now `?size=`/`?features=` (B-082 part 3), each of which is a distinct
  // URL a crawler can reach and none of which is a distinct page worth
  // indexing — `?size=medium` renders the same results as no parameter at all,
  // because the filter is carried onward rather than applied here. Without
  // this, the guides' CTAs would have manufactured a duplicate of the search
  // page per size band.
  alternates: { canonical: '/storage/search' },
}

/// PRD 04 US-4 AC3 (B-082 part 3): a guide's CTA lands here carrying the size
/// or feature it recommended, and the reader should arrive at the facility page
/// already filtered to it — "size guide → unit-type filter on nearest facility
/// page", with the nearest facility being whichever one they pick from this
/// list.
///
/// Values are NOT validated here on purpose: `parseFilters` on the facility
/// page is the one place that decides what a valid filter is, and a second
/// opinion in this file would be a second place to update when a band is added.
/// An unknown value arrives there and is ignored, which is the same outcome as
/// dropping it — minus the risk of the two disagreeing.
function carriedFilters(query: { size?: string; features?: string | string[] }): string {
  const params = new URLSearchParams()
  if (query.size) params.set('size', query.size)
  for (const feature of [query.features ?? []].flat()) params.append('features', feature)
  return params.toString()
}

/// The carried filters in words, for the line that tells a renter they are
/// still holding one.
///
/// A filter that travels invisibly is a filter the renter cannot undo and did
/// not know they had — they clicked "climate-controlled units near you" on a
/// guide, landed on a search box, and nothing on the page mentions climate
/// again until a facility opens with a checkbox already ticked.
///
/// `parseFilters` does the recognising, so this file still holds no second
/// opinion about what a valid filter is: an unrecognised value produces no
/// label here and is carried onward regardless, where the facility page ignores
/// it exactly as it would have.
function carriedFilterLabels(query: { size?: string; features?: string | string[] }): string[] {
  const { size, features } = parseFilters(query)
  return [
    ...(size ? [SIZE_BANDS[size].label] : []),
    ...features.map((feature) => FEATURE_FILTERS[feature].label),
  ]
}

// B-107. Both are public by necessity — they ship to the browser — so the key
// must be referrer-restricted and scoped to the Maps JavaScript API alone
// (D-46). With either unset the map is simply absent and this page is exactly
// what it was before: the list is the product, not the fallback.
const MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
const MAPS_MAP_ID = process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID

// US-101 results page. Reads its whole state from the URL (`?q=` or
// `?lat=&lng=`) so every result view is shareable and bookmarkable, and the
// back button behaves.

function formatMiles(miles: number): string {
  // Below ten miles, one decimal; above it, whole miles — more precision than
  // that is more than a zip-centroid geocode can honestly claim.
  return `${miles < 10 ? miles.toFixed(1) : Math.round(miles)} mi`
}

function formatAddress(facility: FacilityResult): string {
  return `${facility.addressLine1}${facility.addressLine2 ? `, ${facility.addressLine2}` : ''}, ${facility.city}, ${facility.state} ${facility.postalCode}`
}

/// The one place a result's link is built.
///
/// It was assembled twice — once in the card and once for the map marker — and
/// B-082 part 3 gave it a third thing to carry, which is one more than a
/// duplicated expression survives. A marker and a card that disagree about
/// which URL a facility is at is the same class of bug as a map and a list
/// disagreeing about where it is.
function facilityHref(facility: FacilityResult, query: string, filters: string): string {
  const params = new URLSearchParams(filters)
  // `from` carries the search onward so the facility page can offer a way back
  // without the comparer retyping their zip (US-103).
  if (query) params.set('from', query)
  const search = params.toString()
  return search ? `${facilityPath(facility)}?${search}` : facilityPath(facility)
}

function ResultCard({ facility, href }: { facility: FacilityResult; href: string }) {
  return (
    <li className="rounded-lg border p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="text-lg font-medium">
          {/* The name is the link rather than the whole card: a card-wide click
              target swallows the address text a user may want to select, and
              gives screen readers one enormous link name (US-103). */}
          <Link href={href} className="underline underline-offset-4">
            {facility.name}
          </Link>
        </h3>
        <p className="text-muted-foreground text-sm">{formatMiles(facility.distanceMiles)}</p>
      </div>

      <address className="text-muted-foreground mt-1 text-sm not-italic">
        {formatAddress(facility)}
      </address>

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
          // Never render a price for a facility with nothing rentable, and never
          // render $0. Saying so plainly beats an empty space the reader has to
          // interpret (§6.7).
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

/// §6.7: an error state names the problem, the consequence, and the next
/// action, in that order — and a full-page error always offers a human.
function Dead({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <div className="mt-8">
      <h2 className="text-xl font-medium">{heading}</h2>
      <div className="text-muted-foreground mt-2 flex flex-col gap-2 text-pretty">{children}</div>
      <p className="mt-4">
        <a href={`tel:${SITE.phone.href}`} className="font-medium underline underline-offset-4">
          Call {SITE.phone.display}
        </a>{' '}
        <span className="text-muted-foreground">and we will find you a unit.</span>
      </p>
    </div>
  )
}

function Results({ outcome, filters }: { outcome: SearchOutcome; filters: string }) {
  // "Your location" results have no text query to hand on; the back link is
  // simply absent there rather than pointing at an empty search.
  const query = outcome.status === 'ok' || outcome.status === 'none_nearby' ? outcome.query : ''
  if (outcome.status === 'empty') {
    return (
      <p className="text-muted-foreground mt-8 text-pretty">
        Enter a zip code or city above to see facilities near you.
      </p>
    )
  }

  if (outcome.status === 'not_found') {
    return (
      <Dead heading={`We couldn't find "${outcome.query}"`}>
        <p>
          That doesn&apos;t look like a US zip code or city we recognise, so we can&apos;t work out
          what is nearby. Try a 5-digit zip code, or a city and state like &ldquo;Austin, TX&rdquo;.
        </p>
      </Dead>
    )
  }

  if (outcome.status === 'none_nearby') {
    if (outcome.results.length === 0) {
      return (
        <Dead heading="We have no facilities listed yet">
          <p>There is nothing to show you here, which is our gap and not your search.</p>
        </Dead>
      )
    }

    return (
      <div className="mt-8">
        {/* US-101: the zero-results state suggests the nearest facilities
            beyond the radius, with distances — never a dead end. */}
        <h2 className="text-xl font-medium">
          Nothing within {SEARCH_RADIUS_MILES} miles of {outcome.label}
        </h2>
        <p className="text-muted-foreground mt-2 text-pretty">
          These are the closest facilities we have. They are further than most people want to drive,
          so check the distance before you reserve.
        </p>
        <ul className="mt-6 flex flex-col gap-4">
          {outcome.results.map((facility) => (
            <ResultCard
              key={facility.id}
              facility={facility}
              href={facilityHref(facility, query, filters)}
            />
          ))}
        </ul>
        <p className="mt-6">
          <a href={`tel:${SITE.phone.href}`} className="underline underline-offset-4">
            Call {SITE.phone.display}
          </a>{' '}
          <span className="text-muted-foreground">
            if you need something closer — we may have space coming up.
          </span>
        </p>
      </div>
    )
  }

  return (
    <div className="mt-8">
      <h2 className="sr-only">Search results</h2>
      <p className="text-muted-foreground text-sm">
        {outcome.results.length} {outcome.results.length === 1 ? 'facility' : 'facilities'} within{' '}
        {SEARCH_RADIUS_MILES} miles, nearest first
      </p>
      <ul className="mt-4 flex flex-col gap-4">
        {outcome.results.map((facility) => (
          <ResultCard
              key={facility.id}
              facility={facility}
              href={facilityHref(facility, query, filters)}
            />
        ))}
      </ul>
    </div>
  )
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string
    lat?: string
    lng?: string
    /// B-082 part 3. Set by a guide's CTA and carried onward, never applied
    /// here — this page ranks facilities, and a size band says nothing about
    /// which one is closest.
    size?: string
    features?: string | string[]
  }>
}) {
  const { q, lat, lng, size, features } = await searchParams
  const filters = carriedFilters({ size, features })
  const filterLabels = carriedFilterLabels({ size, features })

  // Coordinates come from "Use my location". Parsed defensively because they
  // arrive in a URL anyone can edit; anything out of range falls back to the
  // text query rather than ranking every facility against NaN.
  const latitude = Number(lat)
  const longitude = Number(lng)
  const point =
    lat !== undefined &&
    lng !== undefined &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    Math.abs(latitude) <= 90 &&
    Math.abs(longitude) <= 180
      ? { latitude, longitude }
      : undefined

  const outcome = await searchFacilities({ q, point })

  // The map plots whatever the list showed, including the out-of-radius
  // suggestions — a renter told "nothing within 25 miles, here are three
  // further out" is exactly the one who wants to see where they are.
  const mapFacilities: MapFacility[] =
    outcome.status === 'ok' || outcome.status === 'none_nearby'
      ? outcome.results.map((facility) => ({
          id: facility.id,
          name: facility.name,
          address: formatAddress(facility),
          href: facilityHref(facility, outcome.query, filters),
          // "Full" rather than a price for a facility with nothing rentable —
          // the same refusal to print $0 the card makes one line above.
          priceLabel:
            facility.fromWebRateCents === null ? 'Full' : formatRate(facility.fromWebRateCents),
          latitude: facility.latitude,
          longitude: facility.longitude,
        }))
      : []

  const heading =
    outcome.status === 'ok' || outcome.status === 'none_nearby'
      ? `Storage near ${outcome.label}`
      : 'Find storage'

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-12">
      <h1 className="text-3xl font-semibold tracking-tight text-balance">{heading}</h1>

      <div className="mt-6">
        <FacilitySearchForm defaultValue={q} label="Zip code or city" carry={filters} />
      </div>

      {/* B-082 part 3. A guide's CTA arrives here holding a filter, and this is
          the only place it is visible before a facility page opens with a box
          already ticked. Named in words rather than as a chip, and it says what
          will happen to it — a renter who did not want it can clear it by
          searching from the header instead. */}
      {filterLabels.length > 0 && (
        <p className="text-muted-foreground mt-4 text-sm text-pretty">
          Carrying your{' '}
          <strong className="text-foreground font-medium">{filterLabels.join(' and ')}</strong>{' '}
          filter through — choose a location and we will apply it there.
        </p>
      )}

      <Results outcome={outcome} filters={filters} />

      {/* After the list, never instead of it, and never before it — the text
          equivalent has to precede the map the same way the facility page puts
          its address and directions link above its embed. */}
      {MAPS_API_KEY && MAPS_MAP_ID && mapFacilities.length > 0 && (
        <ResultsMap
          facilities={mapFacilities}
          apiKey={MAPS_API_KEY}
          mapId={MAPS_MAP_ID}
        />
      )}

      <p className="text-muted-foreground mt-10 text-sm text-pretty">
        Not sure what size you need? Read the{' '}
        <Link href="/storage/size-guide" className="underline underline-offset-4">
          size guide
        </Link>
        .
      </p>
    </div>
  )
}
