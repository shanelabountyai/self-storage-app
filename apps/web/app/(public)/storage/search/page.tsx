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

export const metadata = { title: 'Find storage' }

// US-101 results page. Reads its whole state from the URL (`?q=` or
// `?lat=&lng=`) so every result view is shareable and bookmarkable, and the
// back button behaves.

function formatMiles(miles: number): string {
  // Below ten miles, one decimal; above it, whole miles — more precision than
  // that is more than a zip-centroid geocode can honestly claim.
  return `${miles < 10 ? miles.toFixed(1) : Math.round(miles)} mi`
}

function ResultCard({ facility, query }: { facility: FacilityResult; query: string }) {
  return (
    <li className="rounded-lg border p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="text-lg font-medium">
          {/* The name is the link rather than the whole card: a card-wide click
              target swallows the address text a user may want to select, and
              gives screen readers one enormous link name (US-103). */}
          {/* `from` carries the search onward so the facility page can offer a
              way back without the comparer retyping their zip (US-103). */}
          <Link
            href={query ? `${facilityPath(facility)}?from=${encodeURIComponent(query)}` : facilityPath(facility)}
            className="underline underline-offset-4"
          >
            {facility.name}
          </Link>
        </h3>
        <p className="text-muted-foreground text-sm">{formatMiles(facility.distanceMiles)}</p>
      </div>

      <address className="text-muted-foreground mt-1 text-sm not-italic">
        {facility.addressLine1}
        {facility.addressLine2 ? `, ${facility.addressLine2}` : ''}, {facility.city},{' '}
        {facility.state} {facility.postalCode}
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

function Results({ outcome }: { outcome: SearchOutcome }) {
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
            <ResultCard key={facility.id} facility={facility} query={query} />
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
          <ResultCard key={facility.id} facility={facility} query={query} />
        ))}
      </ul>
    </div>
  )
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; lat?: string; lng?: string }>
}) {
  const { q, lat, lng } = await searchParams

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
  const heading =
    outcome.status === 'ok' || outcome.status === 'none_nearby'
      ? `Storage near ${outcome.label}`
      : 'Find storage'

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-12">
      <h1 className="text-3xl font-semibold tracking-tight text-balance">{heading}</h1>

      <div className="mt-6">
        <FacilitySearchForm defaultValue={q} label="Zip code or city" />
      </div>

      <Results outcome={outcome} />

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
