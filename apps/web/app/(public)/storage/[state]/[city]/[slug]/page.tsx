import Link from 'next/link'
import { notFound, permanentRedirect } from 'next/navigation'
import { MapPin, Phone } from 'lucide-react'
import { DAYS_OF_WEEK, type WeeklySchedule } from '@storage/core/facility-settings'
import { formatRate } from '@/lib/format'
import { SITE } from '@/lib/site-config'
import {
  directionsUrl,
  facilityPath,
  formatAddress,
  formatTimeOfDay,
  mapEmbedUrl,
  publicFacilityBySlug,
  type PublicFacility,
} from '@/lib/facility/public-facility'
import {
  cachedPublicInventory,
  type PublicPricingContext,
  type PublicUnitType,
} from '@/lib/inventory/public-inventory'
import { calculateMoveInCost } from '@storage/core/pricing'
import {
  absoluteUrl,
  breadcrumbJsonLd,
  defaultFacilityFaqs,
  facilityDescription,
  facilityTitle,
  faqPageJsonLd,
  renderJsonLd,
  selfStorageJsonLd,
} from '@storage/core/marketing'
import { siteOrigin } from '@/lib/marketing/origin'
import { redirectFor } from '@/lib/marketing/redirects'
import { citySlugPath } from '@/lib/marketing/paths'
import {
  applyFilters,
  FEATURE_FILTERS,
  hasActiveFilters,
  parseFilters,
  SIZE_BANDS,
  SORTS,
  type UnitFilters,
} from '@/lib/inventory/unit-filters'

// PRD 01 §4.1 US-103 — the facility detail page.
//
// Section order follows §6.3 exactly: name/address/call/directions → gate &
// office hours → available units → amenities → map → FAQ. The photo gallery
// US-103 also asks for is missing on purpose: nothing in the product stores a
// photo yet, and B-067 owns photo management *with required alt text*. A
// gallery built here would either ship without alt text or duplicate that item.

// B-016 prerendered this segment with `generateStaticParams` and a 300s
// `revalidate`. B-017 added filter and sort parameters, and a route that reads
// `searchParams` cannot be prerendered — so both were removed rather than left
// in place as configuration that no longer does anything, which is the exact
// trap B-016 found them in to begin with. FR-2.1's staleness ceiling now lives
// on the data read (`cachedPublicInventory`), where it still holds.

export async function generateMetadata({
  params,
}: {
  params: Promise<{ state: string; city: string; slug: string }>
}) {
  const { slug } = await params
  const facility = await publicFacilityBySlug(slug)
  if (!facility) return { title: 'Facility not found' }

  // FR-SEO-3's template, verbatim: `{Facility Name} | Storage Units in {City},
  // {State}`. B-067 makes both fields overridable per facility (US-2 AC1);
  // until then every page gets a title and description built from the record,
  // which beats the alternative — an engine inventing its own from page text,
  // where what it picks is usually the cookie banner.
  // B-067: the marketer's own copy wins where they have written any; the
  // generated template is the floor, not the ceiling.
  const title = facility.seoTitle ?? facilityTitle(facility)
  const description = facility.metaDescription ?? facilityDescription(facility)
  const canonical = facilityPath(facility)
  const url = absoluteUrl(siteOrigin(), canonical)

  return {
    title,
    description,
    // The slug alone resolves the facility, so a wrong state/city still renders.
    // Declaring the canonical keeps that from reading as duplicate content.
    alternates: { canonical },
    // FR-SEO-3's Open Graph and Twitter tags. Same title and description as the
    // page itself — a share card that says something different from the search
    // result is two claims about one page.
    openGraph: {
      type: 'website',
      title,
      description,
      url,
      siteName: SITE.name,
      locale: 'en_US',
    },
    twitter: { card: 'summary_large_image', title, description },
  }
}

/// The one place the page decides which number to show. Mixing the facility's
/// own line with the org line on a single page sends a renter to a different
/// number than the button they just read — so this is resolved once and passed
/// down, never re-derived per component.
function phoneFor(facility: PublicFacility) {
  if (facility.phone) {
    return { href: facility.phone.replace(/[^\d+]/g, ''), display: facility.phone, isMain: false }
  }
  return { href: SITE.phone.href, display: SITE.phone.display, isMain: true }
}

type Phone = ReturnType<typeof phoneFor>

/// "Call (512) 555-0100" / "Call our main line, (512) 555-0100" — a renter who
/// might get transferred should know that before they dial.
function CallLink({ phone, className }: { phone: Phone; className?: string }) {
  return (
    <a href={`tel:${phone.href}`} className={className}>
      Call {phone.isMain ? 'our main line, ' : ''}
      {phone.display}
    </a>
  )
}

function HoursTable({
  caption,
  schedule,
  phone,
}: {
  caption: string
  schedule: WeeklySchedule | null
  phone: Phone
}) {
  if (!schedule) {
    return (
      <div>
        <h3 className="font-medium">{caption}</h3>
        <p className="text-muted-foreground mt-1 text-sm text-pretty">
          Not published yet —{' '}
          <CallLink phone={phone} className="underline underline-offset-4" /> to check before you
          drive out.
        </p>
      </div>
    )
  }

  return (
    <div>
      {/* The caption names the table for the rotor; the heading puts the same
          distinction in the document outline, where far more people will meet
          it. §6.3 says these two schedules must never be conflated, and a
          reader who never opens the table list would otherwise hear one
          undifferentiated "Hours" section. */}
      <h3 className="font-medium">{caption}</h3>
      <table className="mt-2 w-full text-sm">
        {/* One row per day rather than collapsed ranges ("Mon–Fri 9–6").
            Collapsing reads better but guesses at which days are equivalent; a
            renter who drives out on the one day that is different has been
            misled by the nicer format. */}
        <caption className="sr-only">{caption}</caption>
        <tbody>
          {DAYS_OF_WEEK.map((day) => {
            const hours = schedule[day]
            return (
              <tr key={day} className="border-b last:border-0">
                <th scope="row" className="py-1.5 pr-4 text-left font-normal capitalize">
                  {day}
                </th>
                <td className="py-1.5 text-right tabular-nums">
                  {hours.closed ? (
                    'Closed'
                  ) : (
                    <>
                      <time>{formatTimeOfDay(hours.open)}</time>
                      {/* The en dash carries the entire meaning of the row and
                          most screen readers don't speak it at default
                          verbosity — "nine AM, six PM" leaves the listener to
                          guess which is opening. The word is spoken; the dash
                          is seen. */}
                      <span aria-hidden="true"> – </span>
                      <span className="sr-only"> to </span>
                      <time>{formatTimeOfDay(hours.close)}</time>
                    </>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/// US-202's real-world comparison, inline on the card. Keyed by square footage
/// rather than by name so an operator naming a type "Big Locker" still gets the
/// right hint. The full guide is /storage/size-guide.
function sizeHint(sqFt: number): string {
  if (sqFt <= 25) return 'Holds about a large closet — boxes, a bike, seasonal things.'
  if (sqFt <= 50) return 'Holds about a studio flat — a mattress set, boxes, small furniture.'
  if (sqFt <= 100) return 'Holds about a one-bedroom apartment, including a sofa.'
  if (sqFt <= 200) return 'Holds about a two- or three-bedroom house.'
  return 'Holds a three-bedroom house, or a car with room to spare.'
}

/// US-301's "What you'd pay today", closed by default. A native <details>: no
/// JavaScript, no client bundle, and it keeps working with the bundle disabled
/// like the rest of the public path.
function CostBreakdown({
  unitType,
  pricing,
}: {
  unitType: PublicUnitType
  pricing: PublicPricingContext
}) {
  // The one shared calculation (US-301). B-020's checkout stepper calls the
  // same function with the same inputs; a disagreement between the two is a
  // release-blocking defect, not a rounding issue.
  const cost = calculateMoveInCost({
    webRateCents: unitType.webRateCents,
    streetRateCents: unitType.streetRateCents,
    adminFeeCents: pricing.adminFeeCents,
    taxRates: pricing.taxRates,
  })

  return (
    <details className="mt-3">
      <summary className="border-input inline-flex min-h-11 cursor-pointer items-center rounded-md border px-3 text-sm font-medium">
        What you&apos;d pay today
      </summary>

      <dl className="mt-3 flex flex-col gap-2 text-sm">
        {cost.lines.map((line) => (
          <div key={line.key} className="flex flex-col">
            <div className="flex justify-between gap-4">
              <dt>{line.label}</dt>
              <dd className="tabular-nums">
                {line.key === 'protection' ? 'chosen at checkout' : formatRate(line.amountCents)}
              </dd>
            </div>
            {line.note && (
              <p className="text-muted-foreground mt-0.5 text-xs text-pretty">{line.note}</p>
            )}
          </div>
        ))}

        <div className="flex justify-between gap-4 border-t pt-2 font-medium">
          <dt>Total due today</dt>
          <dd className="tabular-nums">{formatRate(cost.totalDueTodayCents)}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt>Then each month</dt>
          <dd className="tabular-nums">{formatRate(cost.ongoingMonthlyCents)}/mo</dd>
        </div>
      </dl>
    </details>
  )
}

function features(unitType: PublicUnitType): string[] {
  const list: string[] = []
  if (unitType.climateControlled) list.push('Climate controlled')
  if (unitType.driveUp) list.push('Drive-up — pull your car right to the door')
  if (unitType.powerAvailable) list.push('Power outlet')
  if (unitType.floor > 1) list.push(`Floor ${unitType.floor}`)
  return list
}

function UnitTypeCard({
  unitType,
  phone,
  pricing,
  facility,
}: {
  unitType: PublicUnitType
  phone: Phone
  pricing: PublicPricingContext
  facility: PublicFacility
}) {
  const available = unitType.availableCount
  const saving = Math.max(0, unitType.streetRateCents - unitType.webRateCents)
  return (
    <li className="rounded-lg border p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="text-lg font-medium">
          {/* U+00D7 is the multiplication sign and is read as "ten times
              twenty", with the unit missing entirely. Sighted readers get the
              compact form; everyone else gets the sentence. */}
          <span aria-hidden="true">
            {unitType.widthFt}×{unitType.lengthFt}
          </span>
          <span className="sr-only">
            {unitType.widthFt} foot by {unitType.lengthFt} foot
          </span>
          <span className="text-muted-foreground font-normal"> · {unitType.name}</span>
        </h3>
        <p className="font-medium">
          {formatRate(unitType.webRateCents)}
          <span className="text-muted-foreground font-normal">/mo online</span>
        </p>
      </div>

      {/* US-301: the in-store rate is struck through ONLY when it differs. A
          struck-through price identical to the price charged is a fabricated
          discount, so the equal case renders one figure and no strike. The
          saving is also stated in words — a line through a number is a visual
          signal only, and 1.4.1 forbids carrying meaning that way alone. */}
      {saving > 0 && (
        <p className="text-muted-foreground mt-1 text-sm">
          <s>{formatRate(unitType.streetRateCents)}/mo in store</s>{' '}
          <span className="text-foreground">
            — {formatRate(saving)} off for renting online
          </span>
        </p>
      )}

      <p className="text-muted-foreground mt-1 text-sm">
        {unitType.sqFt} sq ft
        {unitType.heightFt !== null ? ` · ${unitType.heightFt} ft ceiling` : ''}
      </p>
      <p className="mt-1 text-sm text-pretty">{sizeHint(unitType.sqFt)}</p>

      {features(unitType).length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-2">
          {features(unitType).map((feature) => (
            <li key={feature} className="bg-muted rounded-full px-3 py-1 text-xs">
              {feature}
            </li>
          ))}
        </ul>
      )}

      {unitType.description && <p className="mt-3 text-sm text-pretty">{unitType.description}</p>}

      {available > 0 && <CostBreakdown unitType={unitType} pricing={pricing} />}

      {available > 0 && (
        <div className="mt-4">
          {/* US-401's entry point. Rent now (B-020) joins it here later; §6.6's
              trust line sits beside the CTA, not buried in the lease. */}
          <div className="flex flex-wrap gap-3">
            {/* POST, not a link: starting a checkout takes a unit off the
                market, so it must not fire on a prefetch or a back-button
                visit (B-020). */}
            <form method="POST" action={`${facilityPath(facility)}/rent`}>
              <input type="hidden" name="unitTypeId" value={unitType.unitTypeId} />
              <button
                type="submit"
                className="bg-primary text-primary-foreground inline-flex min-h-11 items-center rounded-md px-4 text-sm font-medium"
              >
                Rent now
              </button>
            </form>
            <Link
              href={`${facilityPath(facility)}/reserve?unitType=${unitType.unitTypeId}`}
              className="border-input hover:bg-accent inline-flex min-h-11 items-center rounded-md border px-4 text-sm font-medium"
            >
              Reserve for free
            </Link>
          </div>
          {/* §6.6: the trust line for each action, beside the action. */}
          <p className="text-muted-foreground mt-2 text-xs">
            Month-to-month, no long-term commitment · Reserving is free and needs no card
          </p>
        </div>
      )}

      {/* §6.6 / US-201: scarcity language only ever comes from the real count.
          There is no countdown and no "in demand" — the number is the claim. */}
      <p className="mt-3 text-sm">
        {available === 0 ? (
          <>
            <span className="text-muted-foreground">All rented right now — </span>
            <CallLink phone={phone} className="underline underline-offset-4" />
            <span className="text-muted-foreground"> about this size; units open up most weeks.</span>
          </>
        ) : (
          <>
            {/* US-201 permits a scarcity label only at ≤3 and only from the real
                count. Above that the number reads as commodity and adds
                nothing, so it stays plain. No countdown, no "in demand" — the
                count is the entire claim.
                Reserve and Rent now arrive with B-018 and B-020; naming them
                here would be a button that does nothing. */}
            {available <= 3 ? (
              <span className="font-medium">
                Only {available} left
              </span>
            ) : (
              <>{available} available</>
            )}
          </>
        )}
      </p>
    </li>
  )
}

function FilterForm({ filters, resultCount }: { filters: UnitFilters; resultCount: number }) {
  return (
    <form method="GET" className="border-input rounded-lg border p-4">
      <h3 className="text-base font-medium">Narrow these down</h3>

      <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:flex-wrap">
        <div className="flex flex-col gap-1 text-sm">
          <label htmlFor="size">Size</label>
          <select
            id="size"
            name="size"
            defaultValue={filters.size ?? ''}
            className="border-input bg-background h-11 rounded-md border px-2"
          >
            <option value="">Any size</option>
            {Object.entries(SIZE_BANDS).map(([key, band]) => (
              <option key={key} value={key}>
                {band.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1 text-sm">
          <label htmlFor="sort">Sort by</label>
          <select
            id="sort"
            name="sort"
            defaultValue={filters.sort}
            className="border-input bg-background h-11 rounded-md border px-2"
          >
            {Object.entries(SORTS).map(([key, sort]) => (
              <option key={key} value={key}>
                {sort.label}
              </option>
            ))}
          </select>
        </div>

        <fieldset className="flex flex-col gap-1 text-sm">
          <legend className="mb-1">Features</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {Object.entries(FEATURE_FILTERS).map(([key, feature]) => (
              <label key={key} className="inline-flex min-h-11 items-center gap-2">
                <input
                  type="checkbox"
                  name="features"
                  value={key}
                  defaultChecked={filters.features.includes(key as never)}
                />
                {feature.label}
              </label>
            ))}
          </div>
        </fieldset>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {/* An explicit Apply, never a submit on `change`. Arrow-keying a select
            fires `change` on every option passed on some platforms, so an
            auto-submitting filter walks a keyboard user through several
            reloads to reach one option (3.2.2). It also means the whole thing
            works with JavaScript disabled. */}
        <button
          type="submit"
          className="bg-primary text-primary-foreground inline-flex min-h-11 items-center rounded-md px-4 text-sm font-medium"
        >
          Apply
        </button>
        {hasActiveFilters(filters) && (
          <a href="?" className="text-sm underline underline-offset-4">
            Clear filters
          </a>
        )}
      </div>

      {/* 4.1.3: the result of applying a filter is announced, not just
          re-rendered. The region is in the DOM on every load, so the count
          changing is a mutation rather than an insertion. */}
      <p role="status" className="text-muted-foreground mt-3 text-sm">
        {resultCount === 1 ? '1 size matches' : `${resultCount} sizes match`}
      </p>
    </form>
  )
}

function UnitList({
  unitTypes,
  phone,
  pricing,
  filtered,
  facility,
}: {
  unitTypes: PublicUnitType[] | null
  phone: Phone
  pricing: PublicPricingContext
  filtered: boolean
  facility: PublicFacility
}) {
  if (unitTypes === null) {
    // US-103: an inventory read that fails shows a call-to-confirm notice, never
    // an error page. The rest of the page — address, hours, directions — is
    // still worth the renter's trip.
    return (
      <p className="rounded-lg border p-4 text-pretty">
        We can&apos;t show live availability right now.{' '}
        <CallLink phone={phone} className="font-medium underline underline-offset-4" /> to confirm
        what is open and we will hold it for you.
      </p>
    )
  }

  if (unitTypes.length === 0) {
    // Two different problems with two different fixes: widen your filters, or
    // there is genuinely nothing here (§6.7 — name the problem, then the next
    // action).
    return filtered ? (
      <p className="rounded-lg border p-4 text-pretty">
        Nothing here matches those filters.{' '}
        <a href="?" className="font-medium underline underline-offset-4">
          Clear them
        </a>{' '}
        to see every size at this location.
      </p>
    ) : (
      <p className="rounded-lg border p-4 text-pretty">
        We haven&apos;t published sizes for this location yet.{' '}
        <CallLink phone={phone} className="font-medium underline underline-offset-4" /> and we will
        tell you what is here.
      </p>
    )
  }

  // Sold-out sizes stay on the page rather than being filtered out. Hiding a
  // full 10x20 tells a renter looking for one that we don't offer it, and they
  // leave instead of calling — the opposite of what the empty state is for.
  // Available first, so the page still leads with what can be rented today.
  const available = unitTypes.filter((unitType) => unitType.availableCount > 0)
  const full = unitTypes.filter((unitType) => unitType.availableCount === 0)

  return (
    <>
      <p className="text-muted-foreground text-sm">
        {/* Filters and sort are B-017; the honest default until then is smallest
            first, which is also cheapest first. */}
        {available.length === 0
          ? 'Everything here is rented right now.'
          : `${available.length} ${available.length === 1 ? 'size' : 'sizes'} available, smallest first`}
      </p>

      {available.length > 0 && (
        <ul className="mt-4 flex flex-col gap-4">
          {available.map((unitType) => (
            <UnitTypeCard
              key={unitType.unitTypeId}
              unitType={unitType}
              phone={phone}
              pricing={pricing}
              facility={facility}
            />
          ))}
        </ul>
      )}

      {full.length > 0 && (
        <>
          <h3 className="mt-8 text-base font-medium">Also here, currently full</h3>
          <ul className="mt-4 flex flex-col gap-4">
            {full.map((unitType) => (
              <UnitTypeCard
              key={unitType.unitTypeId}
              unitType={unitType}
              phone={phone}
              pricing={pricing}
              facility={facility}
            />
            ))}
          </ul>
        </>
      )}
    </>
  )
}

function ContactBlock({ facility, phone }: { facility: PublicFacility; phone: Phone }) {
  return (
    <>
      <address className="mt-2 text-base not-italic">{formatAddress(facility)}</address>

      {/* §4.1: click-to-call must be visible without scrolling on mobile, so the
          call and directions actions sit directly under the address rather than
          beside the unit list. Both are ≥44px tall (§6.2). */}
      <div className="mt-4 flex flex-wrap gap-3">
        <a
          href={`tel:${phone.href}`}
          className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex min-h-11 items-center gap-2 rounded-md px-4 text-sm font-medium"
        >
          <Phone className="size-4" aria-hidden="true" />
          Call {phone.isMain ? 'our main line, ' : ''}
          {phone.display}
        </a>
        <a
          href={directionsUrl(facility)}
          className="border-input hover:bg-accent inline-flex min-h-11 items-center gap-2 rounded-md border px-4 text-sm font-medium"
        >
          <MapPin className="size-4" aria-hidden="true" />
          Get directions
          <span className="sr-only"> to {facility.name}, opens your map app</span>
        </a>
      </div>
    </>
  )
}

export default async function FacilityPage({
  params,
  searchParams,
}: {
  params: Promise<{ state: string; city: string; slug: string }>
  searchParams: Promise<{
    size?: string
    features?: string | string[]
    sort?: string
    from?: string
    unavailable?: string
    soldout?: string
  }>
}) {
  const { state, city, slug } = await params
  const query = await searchParams
  const filters = parseFilters(query)

  const facility = await publicFacilityBySlug(slug)
  if (!facility) {
    // PRD 04 US-3 AC4 before 404ing: a facility that was renamed or retired has
    // an entry in the redirect map, and a 301 to where it went is worth far
    // more than a tidy 404 — every link, every printed sign and every index
    // entry pointing at the old URL keeps working.
    //
    // The lookup is here rather than in middleware on purpose: middleware runs
    // on every request and must not touch the database, while this path is only
    // reached by a request that was already going to fail.
    const moved = await redirectFor(`/storage/${state}/${city}/${slug}`)
    if (moved) permanentRedirect(moved.toPath)
    notFound()
  }

  // The slug is the real identifier, so /storage/ca/nowhere/{slug} would happily
  // render. A permanent redirect to the canonical path means one URL per
  // facility in the index instead of one per spelling anybody links.
  const canonical = facilityPath(facility)
  if (`/storage/${state}/${city}/${slug}` !== canonical) permanentRedirect(canonical)

  // A failed availability read must not take the page down (US-103), so the
  // inventory call is the only one allowed to fail soft. The profile read above
  // is not: a facility page with no address is not worth serving.
  const inventory = await cachedPublicInventory(slug).catch(() => null)
  const unitTypes = inventory?.unitTypes ?? (inventory === null ? null : [])
  const pricing = inventory?.pricing ?? { taxRates: [] }
  const visible = unitTypes === null ? null : applyFilters(unitTypes, filters)

  const embed = mapEmbedUrl(facility)
  const phone = phoneFor(facility)

  // FR-SEO-4. Built from the facility record and the live inventory, never
  // hand-authored — structured data that contradicts the visible page is the
  // thing that gets penalised, and the only way to guarantee it cannot is for
  // both to read the same source.
  const canonicalUrl = absoluteUrl(siteOrigin(), canonical)
  // A facility's own FAQs replace the generated set outright rather than
  // appending to it: a marketer who has written four answers has decided what
  // this page says, and quietly padding it back to five with boilerplate would
  // put words in their mouth. US-1 AC2's "at least 5" is why the generated set
  // is still the fallback when they have written none.
  const faqs = facility.faqs.length > 0 ? facility.faqs : defaultFacilityFaqs(facility)
  const schema = [
    selfStorageJsonLd({
      facility,
      url: canonicalUrl,
      images: facility.photos.map((photo) => photo.url),
      unitTypes: (unitTypes ?? []).map((unitType) => ({
        name: unitType.name,
        sqFt: unitType.sqFt,
        webRateCents: unitType.webRateCents,
        availableCount: unitType.availableCount,
        description: unitType.description,
      })),
    }),
    faqPageJsonLd(faqs),
    breadcrumbJsonLd([
      { name: 'Storage', url: absoluteUrl(siteOrigin(), '/storage/search') },
      {
        name: `${facility.city}, ${facility.state}`,
        url: absoluteUrl(siteOrigin(), citySlugPath(facility.state, facility.city)),
      },
      { name: facility.name, url: canonicalUrl },
    ]),
  ].filter((node): node is NonNullable<typeof node> => node !== null)

  // US-101 → US-103: a comparer arriving from a search should be able to get
  // back to it without retyping their zip. `from` carries the original query;
  // absent, the back link is omitted rather than pointing at an empty results
  // page.
  const backToSearch = query.from ? `/storage/search?q=${encodeURIComponent(query.from)}` : null

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-12">
      {schema.map((node, index) => (
        <script
          key={index}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: renderJsonLd(node) }}
        />
      ))}

      {backToSearch && (
        <p className="mb-4 text-sm">
          <Link href={backToSearch} className="underline underline-offset-4">
            ← Back to storage near {query.from}
          </Link>
        </p>
      )}

      {query.soldout && (
        <p role="status" className="border-input mb-4 rounded-md border p-3 text-sm text-pretty">
          Someone took the last one of that size just before you. Nothing has been charged — here is
          what we still have.
        </p>
      )}

      {query.unavailable && (
        <p role="status" className="border-input mb-4 rounded-md border p-3 text-sm text-pretty">
          That size isn&apos;t available here any more. Here is everything we do have.
        </p>
      )}

      <h1 className="text-3xl font-semibold tracking-tight text-balance">{facility.name}</h1>

      {/* US-2 AC1's hero copy — the first thing a renter reads after the name.
          Absent for a facility nobody has written copy for, and the page reads
          fine without it, which is why it is not backfilled with a generated
          sentence that would be the same on every site. */}
      {facility.heroCopy && (
        <p className="mt-3 text-lg text-pretty">{facility.heroCopy}</p>
      )}

      <ContactBlock facility={facility} phone={phone} />

      {/* §6.6: the commitment terms belong next to the decision, not buried in
          the lease. */}
      <p className="text-muted-foreground mt-4 text-sm">
        Month-to-month · no long-term commitment
      </p>

      <section aria-labelledby="hours" className="mt-10">
        <h2 id="hours" className="text-xl font-medium">
          Hours
        </h2>
        {/* §6.3: office hours and gate access hours must never be conflated.
            They are two separately captioned tables for exactly that reason —
            the gate is usually open long after the office closes, and a renter
            who confuses them shows up to a locked office or an unstaffed site. */}
        <p className="text-muted-foreground mt-1 text-sm text-pretty">
          The office is where staff are. Gate access is when your code opens the
          gate — usually longer.
        </p>
        <div className="mt-4 grid gap-8 sm:grid-cols-2">
          <HoursTable caption="Office hours" schedule={facility.officeHours} phone={phone} />
          <HoursTable caption="Gate access hours" schedule={facility.gateHours} phone={phone} />
        </div>
      </section>

      <section aria-labelledby="units" className="mt-10">
        <h2 id="units" className="text-xl font-medium">
          Available units
        </h2>
        {unitTypes !== null && unitTypes.length > 0 && (
          <div className="mt-4">
            <FilterForm filters={filters} resultCount={visible?.length ?? 0} />
          </div>
        )}

        <div className="mt-4">
          <UnitList
            unitTypes={visible}
            phone={phone}
            pricing={pricing}
            filtered={hasActiveFilters(filters)}
            facility={facility}
          />
        </div>
      </section>

      {facility.amenities.length > 0 && (
        <section aria-labelledby="amenities" className="mt-10">
          <h2 id="amenities" className="text-xl font-medium">
            At this facility
          </h2>
          <ul className="mt-4 flex flex-wrap gap-2">
            {facility.amenities.map((amenity) => (
              <li key={amenity} className="bg-muted rounded-full px-3 py-1 text-sm">
                {amenity}
              </li>
            ))}
          </ul>
        </section>
      )}

      {embed && (
        <section aria-labelledby="map" className="mt-10">
          <h2 id="map" className="text-xl font-medium">
            Where we are
          </h2>
          {/* The text equivalent comes FIRST. The embed is a third-party
              document we cannot remediate — its zoom controls are named "+" and
              "−" and its marker has no text alternative — so a screen-reader or
              keyboard user should reach the link that replaces it without
              traversing it. The address above is text and this link works with
              the frame blocked entirely. */}
          <p className="mt-2 text-sm">
            <a href={directionsUrl(facility)} className="underline underline-offset-4">
              Open directions in your map app
            </a>
          </p>
          {/* Behind a native <details> rather than rendered eagerly, for two
              reasons that happen to have the same fix. Cost: the embed put the
              page's LCP at 2613ms against a 2500ms budget, ~140ms above the
              otherwise-identical homepage; collapsed, the third-party document
              is never fetched unless asked for. Access: a closed <details>
              keeps the frame out of the tab order, so nobody has to traverse a
              map they cannot use to reach the directions link above it.

              <details> and not a button because this needs no JavaScript — the
              whole public path works with the bundle disabled (B-015). */}
          <details className="mt-4">
            <summary className="border-input inline-flex min-h-11 cursor-pointer items-center rounded-md border px-4 text-sm font-medium">
              Show map
            </summary>
            {/* `title` gives the frame an accessible name; without one a screen
                reader announces a nameless frame full of unlabelled tiles. */}
            <iframe
              title={`Map showing ${facility.name} at ${formatAddress(facility)}`}
              src={embed}
              loading="lazy"
              className="mt-4 aspect-video w-full rounded-lg border"
            />
          </details>
        </section>
      )}

      {/* US-2 AC1's long-form description. The single biggest lever on whether
          this page reads as its own page rather than a template with the city
          swapped — which is what a thin-content penalty is. Rendered as
          paragraphs split on blank lines: a marketer typing into a textarea
          expects a blank line to make a paragraph, and the alternative is
          either one wall of text or a rich-text editor nobody asked for. */}
      {facility.longDescription && (
        <section aria-labelledby="about" className="mt-10">
          <h2 id="about" className="text-xl font-medium">
            About this location
          </h2>
          <div className="mt-2 flex flex-col gap-3">
            {facility.longDescription
              .split(/\n\s*\n/)
              .map((paragraph) => paragraph.trim())
              .filter(Boolean)
              .map((paragraph, index) => (
                <p key={index} className="text-muted-foreground text-pretty">
                  {paragraph}
                </p>
              ))}
          </div>
        </section>
      )}

      {/* US-2 AC1's photo set. Alt text is a required column, so there is no
          decorative-image branch here — every one of these describes something
          a renter is trying to judge from a screen. `loading="lazy"` on all but
          the first, which is above the fold and is the LCP candidate. */}
      {facility.photos.length > 0 && (
        <section aria-labelledby="photos" className="mt-10">
          <h2 id="photos" className="text-xl font-medium">
            Photos
          </h2>
          <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {facility.photos.map((photo, index) => (
              <li key={photo.url}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={photo.url}
                  alt={photo.alt}
                  loading={index === 0 ? 'eager' : 'lazy'}
                  decoding="async"
                  // A fixed aspect ratio reserves the space before the bytes
                  // arrive. Without it every photo that loads shoves the page
                  // down, which is exactly the CLS the performance budget
                  // (FR-SEO-6) fails on.
                  className="aspect-4/3 w-full rounded-lg border object-cover"
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* US-1 AC2: "at least 5 facility-specific FAQs." Generated from the
          facility record (packages/core/marketing/faqs.ts) so an answer can
          never contradict the hours table above it; B-067 lets a marketer
          replace any of them. Native <details> — no JavaScript, keyboard
          operable as shipped, and the answers are in the HTML whether or not
          they are open, which is what the FAQPage schema is describing. */}
      <section aria-labelledby="faq" className="mt-10">
        <h2 id="faq" className="text-xl font-medium">
          Questions people ask
        </h2>
        <div className="mt-4 flex flex-col gap-2">
          {faqs.map((entry) => (
            <details key={entry.question} className="border-input rounded-lg border p-4">
              <summary className="cursor-pointer font-medium">{entry.question}</summary>
              <p className="text-muted-foreground mt-2 text-sm text-pretty">{entry.answer}</p>
            </details>
          ))}
        </div>
      </section>

      <p className="text-muted-foreground mt-10 text-sm text-pretty">
        Not sure what size you need? Read the{' '}
        <Link href="/storage/size-guide" className="underline underline-offset-4">
          size guide
        </Link>
        , or{' '}
        <Link href="/storage/search" className="underline underline-offset-4">
          look at other locations
        </Link>
        .
      </p>
    </div>
  )
}
