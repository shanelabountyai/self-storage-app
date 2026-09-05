import { LocaleLink } from '@/components/site/locale-link'
import { notFound, permanentRedirect } from 'next/navigation'
import { SITE } from '@/lib/site-config'
import { formatRate } from '@/lib/format'
import { facilityPath } from '@/lib/facility/public-facility'
import { sizesInCity, type SizeFacility } from '@/lib/facility/city-size-pages'
import {
  breadcrumbJsonLd,
  canonicalDimension,
  citySizeDescription,
  citySizeIntro,
  citySizeTitle,
  dimensionLabel,
  dimensionSpoken,
  itemListJsonLd,
  renderJsonLd,
  sizeFacts,
  sizeIndexGate,
  UNIT_SIZE_ORDER,
} from '@storage/core/marketing'
import { getLocale } from '@/lib/i18n/server'
import { dictionaryFor, translate, LOCALES, type Locale } from '@/lib/i18n'
import { OPEN_GRAPH_LOCALE } from '@/lib/i18n/routing'
import { localeAlternates, localeUrl } from '@/lib/marketing/alternates'
import { citySizePath, citySlugPath } from '@/lib/marketing/paths'

// PRD 00 §6 Phase 3 (B-089). The per-city/size landing page.
//
// The query this exists for is "10x10 storage austin" — high intent, and a
// different query from the one the facility page targets ("storage units in
// Austin, TX"). It is also the page type that manufactures thin content if
// built carelessly, which is why two rules bind it and both are enforced here
// rather than documented:
//
//   1. **It exists only where inventory does.** A size is a page because a
//      facility in this city has a priced unit type with those dimensions.
//      Anything else 404s, the same rule US-4 AC1 puts on a city page.
//   2. **It is indexed only if it earned it (D-77).** The intro is scored
//      against every sibling size's intro before render, and a page over the
//      duplicate threshold is served `noindex, follow` rather than published.
//
// Cached for five minutes, matching the city page and `cachedPublicInventory`
// — this prints prices, and three surfaces disagreeing about how stale a price
// may be is how a page ends up quoting a rate checkout will not honour.

export const revalidate = 300

/// One resolution of the URL segments, shared by the metadata and the page so
/// they cannot disagree about whether this page exists.
async function resolve(state: string, city: string, dimension: string, locale: Locale) {
  const canonical = canonicalDimension(dimension)
  if (!canonical) return null

  const sizes = await sizesInCity(state, city)
  const size = sizes.get(canonical)
  if (!size || size.facilities.length === 0) return null

  // The stored spelling wins, for the city as well as the dimension: every
  // facility here is in the same city by construction, so the first carries the
  // canonical name and state casing.
  const [first] = size.facilities
  const path = citySizePath(first.state, first.city, canonical)

  // Every sibling's intro, from the same load, in every language. This is what
  // the gate scores against, and building it here rather than per-page is the
  // reason the gate costs no extra queries.
  //
  // B-262 made it per language, and the gate now has to pass in ALL of them for
  // the page to be indexed. Two reasons, and the first is the one that decides
  // it: `/storage/…/size/10x10` and `/es/storage/…/size/10x10` are one hreflang
  // cluster, and a cluster whose members disagree about `noindex` is a cluster
  // Google discards — so a per-language verdict would silently cost the English
  // page its Spanish alternate. The second is that translation FLATTENS
  // distinctions: two sizes whose English intros differ enough can come out
  // closer in Spanish, and that page is thin content in Spanish whatever the
  // English scored.
  const introsFor = (target: Locale) =>
    new Map(
      [...sizes.values()].map((sibling) => [
        sibling.dimension,
        citySizeIntro(
          sibling.widthFt,
          sibling.lengthFt,
          first.city,
          first.state,
          sibling.facilities,
          target,
        ),
      ]),
    )

  const intros = introsFor(locale)
  const gates = LOCALES.map((candidate) =>
    sizeIndexGate(canonical, candidate === locale ? intros : introsFor(candidate)),
  )
  // The first refusal, so the reason a reader or the duplicate report is given
  // names the language that actually failed rather than the one being rendered.
  const gate = gates.find((verdict) => !verdict.indexable) ?? gates[0]

  return { size, sizes, first, canonical, path, intros, gate }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ state: string; city: string; dimension: string }>
}) {
  const { state, city, dimension } = await params
  const locale = await getLocale()
  const resolved = await resolve(state, city, dimension, locale)
  if (!resolved) {
    return { title: translate(dictionaryFor(locale), 'size.notFound') }
  }

  const { size, first, path, gate } = resolved
  const title = citySizeTitle(size.widthFt, size.lengthFt, first.city, first.state, locale)
  const description = citySizeDescription(
    size.widthFt,
    size.lengthFt,
    first.city,
    first.state,
    size.facilities,
    locale,
  )

  return {
    title,
    description,
    alternates: localeAlternates(locale, path),
    // D-77's gate. A page too close to its siblings still renders — a visitor
    // who followed a link gets the inventory they came for — but it is not
    // offered to an index, and `follow` keeps the facility links it carries
    // worth crawling.
    ...(gate.indexable ? {} : { robots: { index: false, follow: true } }),
    openGraph: {
      type: 'website',
      title,
      description,
      url: localeUrl(locale, path),
      siteName: SITE.name,
      locale: OPEN_GRAPH_LOCALE[locale],
    },
    twitter: { card: 'summary_large_image', title, description },
  }
}

function FacilityCard({ facility, label }: { facility: SizeFacility; label: string }) {
  const address = `${facility.addressLine1}${facility.addressLine2 ? `, ${facility.addressLine2}` : ''}, ${facility.city}, ${facility.state} ${facility.postalCode}`

  return (
    <li className="rounded-lg border p-4">
      <h3 className="text-lg font-medium">
        {/* The name is the link, not the card — one enormous link name is what
            a screen reader gets otherwise, and a card-wide target swallows the
            address a reader may want to select. Same rule as the city page. */}
        <LocaleLink href={facilityPath(facility)} className="underline underline-offset-4">
          {facility.name}
        </LocaleLink>
      </h3>

      <address className="text-muted-foreground mt-1 text-sm not-italic">{address}</address>

      <p className="mt-3 font-medium">
        {facility.webRateCents === null ? (
          <>
            No {label} available here right now —{' '}
            <a href={`tel:${SITE.phone.href}`} className="underline underline-offset-4">
              call {SITE.phone.display}
            </a>
          </>
        ) : (
          <>
            {formatRate(facility.webRateCents)}
            <span className="text-muted-foreground font-normal">/mo online</span>
            {/* Real count only, and only when it is genuinely low — US-201's
                rule for the facility page's "only 2 left". A comfortable
                number is not printed at all, because "14 available" invites
                waiting. */}
            {facility.availableCount > 0 && facility.availableCount <= 3 && (
              <span className="text-muted-foreground ml-2 text-sm font-normal">
                {facility.availableCount} left
              </span>
            )}
          </>
        )}
      </p>
    </li>
  )
}

export default async function CitySizePage({
  params,
}: {
  params: Promise<{ state: string; city: string; dimension: string }>
}) {
  const { state, city, dimension } = await params
  const locale = await getLocale()
  const resolved = await resolve(state, city, dimension, locale)
  if (!resolved) notFound()

  const { size, sizes, first, canonical, path, intros } = resolved

  // A recoverable spelling — `10X10`, `10 x 10`, `10×10`, or a non-canonical
  // city segment — is one page, not four. Redirected rather than rendered, with
  // no middleware in this app to do it earlier.
  if (dimension !== canonical || citySlugPath(state, city) !== citySlugPath(first.state, first.city)) {
    permanentRedirect(path)
  }

  const label = dimensionLabel(size.widthFt, size.lengthFt)
  const place = `${first.city}, ${first.state.toUpperCase()}`
  const intro = intros.get(canonical) ?? []
  const facts = sizeFacts(size.widthFt, size.lengthFt, locale)
  const canonicalUrl = localeUrl(locale, path)

  // Sibling sizes, in the guide's order — smallest first — with anything the
  // catalogue does not know about appended. This block is the largest reason a
  // visitor who guessed the wrong size does not leave: it is also what makes
  // the pages a set rather than a scatter of orphans.
  const siblings = [...sizes.values()]
    .filter((other) => other.dimension !== canonical)
    .sort((a, b) => {
      const left = UNIT_SIZE_ORDER.indexOf(a.dimension)
      const right = UNIT_SIZE_ORDER.indexOf(b.dimension)
      if (left !== right) return (left === -1 ? Infinity : left) - (right === -1 ? Infinity : right)
      return a.widthFt * a.lengthFt - b.widthFt * b.lengthFt
    })

  const schema = [
    // FR-SEO-4's `ItemList`. The items are the facility links rendered below,
    // built from the same array, so the markup cannot describe a list the
    // reader is not looking at.
    itemListJsonLd(
      size.facilities.map((facility) => ({
        name: facility.name,
        url: localeUrl(locale, facilityPath(facility)),
      })),
      `${label} storage units in ${place}`,
    ),
    breadcrumbJsonLd([
      { name: 'Storage', url: localeUrl(locale, '/storage/search') },
      { name: place, url: localeUrl(locale, citySlugPath(first.state, first.city)) },
      { name: `${label} units`, url: canonicalUrl },
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
        {/* The × is a multiplication sign and is announced as "times" with the
            unit missing — "10 times 10" is not a size. Sighted readers get the
            compact form, everyone else gets the sentence. Same treatment as the
            size guide and the facility page. */}
        <span aria-hidden="true">{label}</span>
        <span className="sr-only">{dimensionSpoken(size.widthFt, size.lengthFt)}</span> storage
        units in {place}
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
          {size.facilities.length === 1
            ? `Where to rent a ${label} in ${first.city}`
            : `${size.facilities.length} locations with a ${label}`}
        </h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Cheapest first. Prices are the online rate and update through the day.
        </p>
        <ul className="mt-4 flex flex-col gap-4">
          {size.facilities.map((facility) => (
            <FacilityCard key={facility.id} facility={facility} label={label} />
          ))}
        </ul>
      </section>

      {/* What fits, from the shared catalogue. Three or four bullets, not the
          whole guide: D-60's rule is that the guide is linked rather than
          re-published, and the link below is the rest of the answer. */}
      {facts && (
        <section aria-labelledby="fits" className="mt-10">
          <h2 id="fits" className="text-xl font-medium">
            What fits in a {label}?
          </h2>
          <ul className="mt-4 list-disc space-y-1 pl-5">
            {facts.fits.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      )}

      {siblings.length > 0 && (
        <section aria-labelledby="other-sizes" className="mt-10">
          <h2 id="other-sizes" className="text-xl font-medium">
            Other sizes in {first.city}
          </h2>
          <ul className="mt-4 flex flex-wrap gap-2">
            {siblings.map((other) => (
              <li key={other.dimension}>
                <LocaleLink
                  href={citySizePath(first.state, first.city, other.dimension)}
                  className="border-input hover:bg-accent inline-flex min-h-11 items-center rounded-md border px-4 text-sm underline underline-offset-4"
                >
                  <span aria-hidden="true">{dimensionLabel(other.widthFt, other.lengthFt)}</span>
                  <span className="sr-only">
                    {dimensionSpoken(other.widthFt, other.lengthFt)} units
                  </span>
                </LocaleLink>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="text-muted-foreground mt-10 text-sm text-pretty">
        Not sure a {label} is right? Read the{' '}
        <LocaleLink href="/storage/size-guide" className="underline underline-offset-4">
          size guide
        </LocaleLink>
        , or see{' '}
        <LocaleLink
          href={citySlugPath(first.state, first.city)}
          className="underline underline-offset-4"
        >
          every location in {first.city}
        </LocaleLink>
        .
      </p>
    </div>
  )
}
