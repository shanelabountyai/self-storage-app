import Link from 'next/link'
import { SearchFilterRail } from '@/components/site/search-filter-rail'
import { OfficeToday } from '@/components/site/facility-card'
import { Button } from '@/components/ui/button'
import { FacilitySearchForm } from '@/components/site/facility-search-form'
import { SITE } from '@/lib/site-config'
import { formatMiles, formatRate } from '@/lib/format'
import { facilityPath } from '@/lib/facility/public-facility'
import {
  searchFacilities,
  SEARCH_RADIUS_MILES,
  type FacilityResult,
  type SearchOutcome,
} from '@/lib/geo/facility-search'
import { parseGeoPoint } from '@/lib/geo/geocode'
import { ResultsMap, type MapFacility } from '@/components/site/results-map'
import { parseFilters, SIZE_BANDS } from '@/lib/inventory/unit-filters'
import {
  dictionaryFor,
  plural,
  translate,
  type Dictionary,
  type MessageKey,
} from '@/lib/i18n'
import { getLocale } from '@/lib/i18n/server'

// B-090 part 6: `generateMetadata` rather than a static `metadata`, so the tab
// title follows the language the page is actually in. The canonical does not
// move — there is one URL per result view whatever language it renders in,
// which is the whole point of the cookie strategy (D-122).
export async function generateMetadata() {
  const dict = dictionaryFor(await getLocale())
  return {
  title: translate(dict, 'search.title'),
  // One canonical for every result view. This page takes `?q=`, `?lat=&lng=`
  // and `?size=`/`?features=` (B-082 part 3), each of which is a distinct URL a
  // crawler can reach and none of which is a distinct page worth indexing — a
  // filtered view is the same list narrowed. Without this, the guides' CTAs
  // would have manufactured a duplicate of the search page per filter.
  alternates: { canonical: '/storage/search' },
  }
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

// B-107. Both are public by necessity — they ship to the browser — so the key
// must be referrer-restricted and scoped to the Maps JavaScript API alone
// (D-46). With either unset the map is simply absent and this page is exactly
// what it was before: the list is the product, not the fallback.
const MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
const MAPS_MAP_ID = process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID

// US-101 results page. Reads its whole state from the URL (`?q=` or
// `?lat=&lng=`) so every result view is shareable and bookmarkable, and the
// back button behaves.

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

function ResultCard({
  facility,
  href,
  dict,
  sizeLabel,
}: {
  facility: FacilityResult
  href: string
  dict: Dictionary
  /// B-376: the carried size band in words, when the price is band-scoped.
  sizeLabel?: string
}) {
  const t = (key: MessageKey, vars?: Record<string, string | number>) =>
    translate(dict, key, vars)
  const from = facility.from
  return (
    <li className="bg-card flex flex-col overflow-hidden rounded-xl border">
      {/* B-118 established that a renter comparing three sites judges "clean,
          lit, not a dump" from a photo; the facility page got that treatment
          and the list that ranks facilities did not. Same rule as there: a
          facility with no photo renders no frame, because there is nothing
          honest to reserve the space for. */}
      {facility.photo && (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={facility.photo.url}
          // Decorative: it sits beside a link that already names the
          // facility, so a repeated name is noise rather than information
          // (WCAG 1.1.1). It is deliberately not a link either — the name
          // above is the one target.
          alt=""
          loading="lazy"
          decoding="async"
          // The aspect ratio for the browser's CLS reservation, matching
          // `aspect-4/3` below, exactly as the facility gallery does —
          // FacilityPhoto stores no pixel dimensions.
          width={800}
          height={600}
          className="aspect-4/3 w-full border-b object-cover"
        />
      )}

      <div className="flex min-w-0 flex-1 flex-col gap-2 p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h3 className="font-heading text-lg font-bold">
            {/* The name is the link rather than the whole card: a card-wide click
                target swallows the address text a user may want to select, and
                gives screen readers one enormous link name (US-103). The
                distance rides inside the accessible name (WCAG 2.4.4) rather
                than being read twice — the visible copy below is hidden from
                assistive technology for exactly that reason. */}
            <Link href={href} className="underline-offset-4 hover:underline">
              {facility.name}
              <span className="sr-only">, {formatMiles(facility.distanceMiles)}</span>
            </Link>
          </h3>
          <p className="text-muted-foreground text-sm" aria-hidden="true">
            {formatMiles(facility.distanceMiles)}
          </p>
        </div>

        <OfficeToday facility={facility} dict={dict} />

        <address className="text-muted-foreground text-sm not-italic">
          {formatAddress(facility)}
        </address>

        {facility.amenities.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {facility.amenities.map((amenity) => (
              <li key={amenity} className="bg-muted rounded-full px-3 py-1 text-xs">
                {amenity}
              </li>
            ))}
          </ul>
        )}

        <p className="mt-auto pt-1 font-medium">
          {from === null ? (
            // Never render a price for a facility with nothing rentable, and never
            // render $0. Saying so plainly beats an empty space the reader has to
            // interpret (§6.7).
            <>
              {sizeLabel ? t('card.noneInSize', { size: sizeLabel }) : t('card.noUnits')}{' '}
              <a href={`tel:${SITE.phone.href}`} className="underline underline-offset-4">
                {t('card.call', { phone: SITE.phone.display })}
              </a>
            </>
          ) : (
            // B-242: the price names the size it belongs to, and the two are ONE
            // sentence in the accessible name. "Units from $60/mo" and "5×5" read
            // as separate nodes tell a renter nothing about the relationship
            // between them. U+00D7 announces as a multiplication operator, so the
            // sighted compact form and the spoken sentence are separate spans —
            // the pattern B-016 shipped and this is the fourth surface to need.
            <>
              <span aria-hidden="true">
                {from.widthFt}×{from.lengthFt} {t('card.from')}{' '}
                {formatRate(from.webRateCents)}
                <span className="text-muted-foreground font-normal">
                  {t('card.perMonth')}
                </span>
              </span>
              <span className="sr-only">
                {t('card.priceSr', {
                  width: from.widthFt,
                  length: from.lengthFt,
                  price: formatRate(from.webRateCents),
                })}
              </span>
            </>
          )}
        </p>

        {/* §6.6 / US-201: scarcity language only ever comes from the real count,
            in the vocabulary the facility page already uses. There is no
            countdown and no "in demand" — the number is the whole claim, and a
            badge without one would be fabricated scarcity. */}
        {from !== null && (
          <p className="text-muted-foreground text-sm">
            {from.availableUnits <= 3
              ? plural(dict, from.availableUnits, 'card.onlyLeftOne', 'card.onlyLeftOther')
              : plural(
                  dict,
                  from.availableSizes,
                  'card.sizesAvailableOne',
                  'card.sizesAvailableOther',
                )}
          </p>
        )}

        {/* B-401: the same button the facility card carries (B-387). */}
        <Button asChild variant="outline" className="mt-1 min-h-11 self-start">
          <Link href={href}>
            {t('card.viewUnits')}
            <span className="sr-only"> {t('card.viewUnitsSr', { name: facility.name })}</span>
          </Link>
        </Button>
      </div>
    </li>
  )
}

/// §6.7: an error state names the problem, the consequence, and the next
/// action, in that order — and a full-page error always offers a human.
function Dead({
  heading,
  dict,
  children,
}: {
  heading: string
  dict: Dictionary
  children: React.ReactNode
}) {
  return (
    <div className="mt-8">
      <h2 className="text-xl font-medium">{heading}</h2>
      <div className="text-muted-foreground mt-2 flex flex-col gap-2 text-pretty">{children}</div>
      <p className="bg-muted mt-4 rounded-xl p-6">
        <a href={`tel:${SITE.phone.href}`} className="font-medium underline underline-offset-4">
          {translate(dict, 'dead.call', { phone: SITE.phone.display })}
        </a>{' '}
        <span className="text-muted-foreground">{translate(dict, 'dead.callSuffix')}</span>
      </p>
    </div>
  )
}

function Results({
  outcome,
  filters,
  dict,
  sizeLabel,
  featuresApplied,
}: {
  outcome: SearchOutcome
  filters: string
  dict: Dictionary
  sizeLabel?: string
  featuresApplied: boolean
}) {
  const t = (key: MessageKey, vars?: Record<string, string | number>) =>
    translate(dict, key, vars)
  // "Your location" results have no text query to hand on; the back link is
  // simply absent there rather than pointing at an empty search.
  const query = outcome.status === 'ok' || outcome.status === 'none_nearby' ? outcome.query : ''
  if (outcome.status === 'empty') {
    return (
      <p className="text-muted-foreground mt-8 text-pretty">{t('search.empty')}</p>
    )
  }

  if (outcome.status === 'not_found') {
    return (
      <Dead dict={dict} heading={t('search.notFoundHeading', { query: outcome.query })}>
        <p>{t('search.notFoundBody')}</p>
      </Dead>
    )
  }

  if (outcome.status === 'none_nearby') {
    // B-395: every facility was dropped for lacking the features, which is not
    // "we have none listed". The rail above is open, with Clear all in it.
    if (outcome.results.length === 0 && featuresApplied) {
      return (
        <Dead
          dict={dict}
          heading={t('search.noneNearbyHeading', {
            miles: SEARCH_RADIUS_MILES,
            label: outcome.label,
          })}
        >
          <p>{t('search.noneMatchingBody')}</p>
        </Dead>
      )
    }

    if (outcome.results.length === 0) {
      return (
        <Dead dict={dict} heading={t('search.noneListedHeading')}>
          <p>{t('search.noneListedBody')}</p>
        </Dead>
      )
    }

    return (
      <div className="mt-8">
        {/* US-101: the zero-results state suggests the nearest facilities
            beyond the radius, with distances — never a dead end. */}
        <h2 className="text-xl font-medium">
          {t('search.noneNearbyHeading', {
            miles: SEARCH_RADIUS_MILES,
            label: outcome.label,
          })}
        </h2>
        <p className="text-muted-foreground mt-2 text-pretty">{t('search.noneNearbyBody')}</p>
        <ul className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {outcome.results.map((facility) => (
            <ResultCard
              key={facility.id}
              facility={facility}
              href={facilityHref(facility, query, filters)}
              dict={dict}
              sizeLabel={sizeLabel}
            />
          ))}
        </ul>
        <div className="bg-muted mt-6 flex items-center gap-4 rounded-xl p-6">
          <a href={`tel:${SITE.phone.href}`} className="font-medium underline underline-offset-4">
            {t('dead.call', { phone: SITE.phone.display })}
          </a>
          <span className="text-muted-foreground">{t('search.callCloser')}</span>
        </div>
      </div>
    )
  }

  return (
    <div className="mt-8">
      <h2 className="sr-only">{t('search.resultsHeading')}</h2>
      <p className="text-muted-foreground text-sm">
        {plural(dict, outcome.results.length, 'search.countOne', 'search.countOther', {
          miles: SEARCH_RADIUS_MILES,
        })}
      </p>
      <ul className="mt-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {outcome.results.map((facility) => (
          <ResultCard
              key={facility.id}
              facility={facility}
              href={facilityHref(facility, query, filters)}
              dict={dict}
              sizeLabel={sizeLabel}
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
    /// B-082 part 3 sets these from a guide's CTA; B-388's rail sets them
    /// here. Size prices the cards (B-376); features also drop facilities
    /// with no matching unit free (B-395). Both are carried onward.
    size?: string
    features?: string | string[]
  }>
}) {
  const { q, lat, lng, size, features } = await searchParams
  const dict = dictionaryFor(await getLocale())
  const filters = carriedFilters({ size, features })

  // Coordinates come from "Use my location", parsed defensively — anything
  // out of range falls back to the text query rather than ranking every
  // facility against NaN. Shared with B-366's locations page.
  const point = parseGeoPoint({ lat, lng })

  // B-376/B-395: unrecognised values parse away and filter nothing.
  const { size: sizeBand, features: featureKeys } = parseFilters({ size, features })
  const outcome = await searchFacilities({ q, point, size: sizeBand, features: featureKeys })

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
            facility.fromWebRateCents === null
              ? translate(dict, 'map.full')
              : formatRate(facility.fromWebRateCents),
          latitude: facility.latitude,
          longitude: facility.longitude,
        }))
      : []

  const heading =
    outcome.status === 'ok' || outcome.status === 'none_nearby'
      ? translate(dict, 'search.headingNear', { label: outcome.label })
      : translate(dict, 'search.title')

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-12">
      <nav aria-label={translate(dict, 'chrome.breadcrumb')} className="text-muted-foreground mb-3 text-sm">
        <ol className="flex flex-wrap gap-x-2">
          <li>
            <Link href="/" className="underline underline-offset-4">
              {translate(dict, 'chrome.home')}
            </Link>
            <span aria-hidden="true"> /</span>
          </li>
          <li aria-current="page">{translate(dict, 'chrome.findStorage')}</li>
        </ol>
      </nav>
      <h1 className="text-3xl font-semibold tracking-tight text-balance">{heading}</h1>

      <div className="mt-6 max-w-3xl">
        <FacilitySearchForm defaultValue={q} labelKey="search.labelZipOrCity" carry={filters} />
      </div>

      <SearchFilterRail dict={dict} query={{ q, lat, lng, size, features }} />

      <Results
        outcome={outcome}
        filters={filters}
        dict={dict}
        sizeLabel={sizeBand ? translate(dict, SIZE_BANDS[sizeBand].labelKey) : undefined}
        featuresApplied={featureKeys.length > 0}
      />

      {/* B-376: the directory is otherwise reachable only from the home page. */}
      <p className="mt-8 text-sm">
        <Link href="/storage/locations" className="underline underline-offset-4">
          {translate(dict, 'home.allLocations')}
        </Link>
      </p>

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
        {translate(dict, 'search.sizeGuideBefore')}{' '}
        <Link href="/storage/size-guide" className="underline underline-offset-4">
          {translate(dict, 'search.sizeGuideLink')}
        </Link>
        .
      </p>
    </div>
  )
}
