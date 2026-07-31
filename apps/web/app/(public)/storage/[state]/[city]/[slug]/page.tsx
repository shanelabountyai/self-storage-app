import Link from 'next/link'
import { notFound, permanentRedirect } from 'next/navigation'
import { MapPin, Phone } from 'lucide-react'
import { prisma } from '@storage/db'
import { DAYS_OF_WEEK, type WeeklySchedule } from '@storage/core/facility-settings'
import { formatRate } from '@/lib/format'
import { SITE } from '@/lib/site-config'
import {
  citySlug,
  directionsUrl,
  facilityPath,
  formatAddress,
  formatTimeOfDay,
  mapEmbedUrl,
  publicFacilityBySlug,
  type PublicFacility,
} from '@/lib/facility/public-facility'
import { publicInventoryForFacility, type PublicUnitType } from '@/lib/inventory/public-inventory'

// PRD 01 §4.1 US-103 — the facility detail page.
//
// Section order follows §6.3 exactly: name/address/call/directions → gate &
// office hours → available units → amenities → map → FAQ. The photo gallery
// US-103 also asks for is missing on purpose: nothing in the product stores a
// photo yet, and B-067 owns photo management *with required alt text*. A
// gallery built here would either ship without alt text or duplicate that item.

/// Matches INVENTORY_CACHE_TTL_SECONDS (300). Next needs this to be a literal,
/// so it cannot import the constant. Two jobs at once: it holds FR-2.1's
/// ≤5-minute staleness ceiling for the availability numbers, and it is what
/// makes US-103's "if the API is down, show cached data" real — when a
/// revalidation render fails, Next keeps serving the last good page instead of
/// throwing an error page at the renter.
export const revalidate = 300

/// Prerenders one page per active facility. Without this the segment is
/// on-demand only and `revalidate` above is dead config — the build output says
/// ƒ (Dynamic) with no revalidate window at all.
///
/// The facility set is small and changes when a site opens, so building them all
/// is cheap. A facility added after the build still renders on first request
/// (`dynamicParams` defaults to true); it just isn't warm.
///
/// The catch is deliberate: a database that is unreachable during a build should
/// degrade to on-demand rendering, not fail the deploy.
export async function generateStaticParams() {
  try {
    const facilities = await prisma.facility.findMany({
      where: { status: 'active' },
      select: { state: true, city: true, slug: true },
    })
    return facilities.map((facility) => ({
      state: facility.state.toLowerCase(),
      city: citySlug(facility.city),
      slug: facility.slug,
    }))
  } catch {
    return []
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ state: string; city: string; slug: string }>
}) {
  const { slug } = await params
  const facility = await publicFacilityBySlug(slug)
  if (!facility) return { title: 'Facility not found' }

  return {
    title: `${facility.name} — self storage in ${facility.city}, ${facility.state}`,
    description: `Storage units at ${formatAddress(facility)}. See sizes, prices and gate hours, and rent online.`,
    // The slug alone resolves the facility, so a wrong state/city still renders.
    // Declaring the canonical keeps that from reading as duplicate content.
    // B-066 owns the wider canonical/301 policy and the JSON-LD that goes with it.
    alternates: { canonical: facilityPath(facility) },
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

function features(unitType: PublicUnitType): string[] {
  const list: string[] = []
  if (unitType.climateControlled) list.push('Climate controlled')
  if (unitType.driveUp) list.push('Drive-up — pull your car right to the door')
  if (unitType.powerAvailable) list.push('Power outlet')
  if (unitType.floor > 1) list.push(`Floor ${unitType.floor}`)
  return list
}

function UnitTypeCard({ unitType, phone }: { unitType: PublicUnitType; phone: Phone }) {
  const available = unitType.availableCount
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
          <span className="text-muted-foreground font-normal">/mo</span>
        </p>
      </div>

      <p className="text-muted-foreground mt-1 text-sm">
        {unitType.sqFt} sq ft
        {unitType.heightFt !== null ? ` · ${unitType.heightFt} ft ceiling` : ''}
      </p>

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
            {available} available
            {/* Reserve and Rent now arrive with B-018 and B-020. Naming them here
                would be a button that does nothing. */}
          </>
        )}
      </p>
    </li>
  )
}

function UnitList({ unitTypes, phone }: { unitTypes: PublicUnitType[] | null; phone: Phone }) {
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
    return (
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
            <UnitTypeCard key={unitType.unitTypeId} unitType={unitType} phone={phone} />
          ))}
        </ul>
      )}

      {full.length > 0 && (
        <>
          <h3 className="mt-8 text-base font-medium">Also here, currently full</h3>
          <ul className="mt-4 flex flex-col gap-4">
            {full.map((unitType) => (
              <UnitTypeCard key={unitType.unitTypeId} unitType={unitType} phone={phone} />
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
          className="hover:bg-accent inline-flex min-h-11 items-center gap-2 rounded-md border px-4 text-sm font-medium"
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
}: {
  params: Promise<{ state: string; city: string; slug: string }>
}) {
  const { state, city, slug } = await params

  const facility = await publicFacilityBySlug(slug)
  if (!facility) notFound()

  // The slug is the real identifier, so /storage/ca/nowhere/{slug} would happily
  // render. A permanent redirect to the canonical path means one URL per
  // facility in the index instead of one per spelling anybody links.
  const canonical = facilityPath(facility)
  if (`/storage/${state}/${city}/${slug}` !== canonical) permanentRedirect(canonical)

  // A failed availability read must not take the page down (US-103), so the
  // inventory call is the only one allowed to fail soft. The profile read above
  // is not: a facility page with no address is not worth serving.
  const unitTypes = await publicInventoryForFacility(slug)
    .then((inventory) => inventory?.unitTypes ?? [])
    .catch(() => null)

  const embed = mapEmbedUrl(facility)
  const phone = phoneFor(facility)

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-12">
      <h1 className="text-3xl font-semibold tracking-tight text-balance">{facility.name}</h1>
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
        <div className="mt-4">
          <UnitList unitTypes={unitTypes} phone={phone} />
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
            <summary className="inline-flex min-h-11 cursor-pointer items-center rounded-md border px-4 text-sm font-medium">
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

      <p className="text-muted-foreground mt-10 text-sm text-pretty">
        Not sure what size you need? Read the{' '}
        <Link href="/faq" className="underline underline-offset-4">
          FAQ
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
