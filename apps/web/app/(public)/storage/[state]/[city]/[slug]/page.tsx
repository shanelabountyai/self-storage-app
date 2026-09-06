import { LocaleLink } from '@/components/site/locale-link'
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
import { LeadForm } from '@/components/marketing/lead-form'
import { submitLeadAction, trackPageView } from './lead-actions'
import { joinWaitlistAction } from './waitlist-actions'
import { WaitlistForm } from '@/components/marketing/waitlist-form'
import { CallLink, phoneFor, type Phone as PhoneNumber } from '@/components/marketing/call-link'
import { citySlugPath } from '@/lib/marketing/paths'
import {
  dictionaryFor,
  plural,
  translate,
  type Dictionary,
  type MessageKey,
} from '@/lib/i18n'
import { getLocale } from '@/lib/i18n/server'
import { OPEN_GRAPH_LOCALE, localePath } from '@/lib/i18n/routing'
import { localeAlternates } from '@/lib/marketing/alternates'
import { costLineLabel, costLineNote } from '@/lib/pricing/cost-line-copy'
import { offerFor } from '@/lib/promotions/service'
import { PromoCodeEntry } from '@/components/promo-code-entry'
import type { CodeOutcome } from '@storage/core/promotions'
import { visibleReviewsForFacility } from '@/lib/reviews/public'
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
// Section order follows §6.3 exactly: name → hero photo → contact block →
// gate & office hours → available units → amenities → map → FAQ. B-118 moved
// the photo gallery's first 1–3 images above the contact block, as the LCP
// element; the rest of the gallery stays at its original position, further
// down the page.

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
  if (!facility) {
    const dict = dictionaryFor(await getLocale())
    return { title: translate(dict, 'facility.notFound') }
  }

  // FR-SEO-3's template, verbatim: `{Facility Name} | Storage Units in {City},
  // {State}`. B-067 makes both fields overridable per facility (US-2 AC1);
  // until then every page gets a title and description built from the record,
  // which beats the alternative — an engine inventing its own from page text,
  // where what it picks is usually the cookie banner.
  // B-067: the marketer's own copy wins where they have written any; the
  // generated template is the floor, not the ceiling.
  const title = facility.seoTitle ?? facilityTitle(facility)
  const description = facility.metaDescription ?? facilityDescription(facility)
  const locale = await getLocale()
  const canonical = facilityPath(facility)
  // B-262: the OG url is the URL THIS RENDER is at, not the English one. A
  // Spanish page whose share card points at the English page is a card that
  // sends every reader of it somewhere else.
  const url = absoluteUrl(siteOrigin(), localePath(locale, canonical))

  return {
    title,
    description,
    // The slug alone resolves the facility, so a wrong state/city still renders.
    // Declaring the canonical keeps that from reading as duplicate content.
    // B-262: one canonical per language, each naming the other.
    alternates: localeAlternates(locale, canonical),
    // FR-SEO-3's Open Graph and Twitter tags. Same title and description as the
    // page itself — a share card that says something different from the search
    // result is two claims about one page.
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

function HoursTable({
  caption,
  schedule,
  phone,
  dict,
}: {
  caption: string
  schedule: WeeklySchedule | null
  phone: PhoneNumber
  dict: Dictionary
}) {
  if (!schedule) {
    return (
      <div>
        <h3 className="font-medium">{caption}</h3>
        <p className="text-muted-foreground mt-1 text-sm text-pretty">
          {translate(dict, 'facility.hoursUnpublished')}{' '}
          <CallLink phone={phone} className="underline underline-offset-4" />{' '}
          {translate(dict, 'facility.hoursUnpublishedAfter')}
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
                    translate(dict, 'facility.closed')
                  ) : (
                    <>
                      <time>{formatTimeOfDay(hours.open)}</time>
                      {/* The en dash carries the entire meaning of the row and
                          most screen readers don't speak it at default
                          verbosity — "nine AM, six PM" leaves the listener to
                          guess which is opening. The word is spoken; the dash
                          is seen. */}
                      <span aria-hidden="true"> – </span>
                      <span className="sr-only">{translate(dict, 'facility.to')}</span>
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
function sizeHint(sqFt: number): MessageKey {
  if (sqFt <= 25) return 'facility.sizeHint.closet'
  if (sqFt <= 50) return 'facility.sizeHint.studio'
  if (sqFt <= 100) return 'facility.sizeHint.oneBed'
  if (sqFt <= 200) return 'facility.sizeHint.twoBed'
  return 'facility.sizeHint.house'
}

/// US-301's "What you'd pay today", closed by default. A native <details>: no
/// JavaScript, no client bundle, and it keeps working with the bundle disabled
/// like the rest of the public path.
function CostBreakdown({
  unitType,
  pricing,
  promo,
  dict,
}: {
  unitType: PublicUnitType
  pricing: PublicPricingContext
  promo: { terms: string; firstPeriodCents: number; fromCode: boolean } | null
  dict: Dictionary
}) {
  // The one shared calculation (US-301). B-020's checkout stepper calls the
  // same function with the same inputs; a disagreement between the two is a
  // release-blocking defect, not a rounding issue.
  //
  // B-226. **The promotion was missing from these inputs, and that is precisely
  // the disagreement the shared calculation exists to prevent** — reappearing
  // on the other side of the same function. The card rendered a *First month
  // free* badge and the sentence "it is already in the total below", and the
  // total below was computed without the discount; checkout applied it. So the
  // browse estimate and the money path differed by exactly the promotion, and a
  // comparison shopper who opened "What you'd pay today" under that badge and
  // saw full rent could only conclude the discount was fake.
  //
  // `calculateMoveInCost` has understood `promoDiscountCents` since B-070 —
  // it emits the line, its terms, and the reduced taxable base. Nothing needed
  // teaching; the value simply never arrived.
  const cost = calculateMoveInCost({
    webRateCents: unitType.webRateCents,
    streetRateCents: unitType.streetRateCents,
    adminFeeCents: pricing.adminFeeCents,
    taxRates: pricing.taxRates,
    // Positive cents off the first period. `firstPeriodCents` is what the
    // renter pays for month one, so the discount is the gap — floored, because
    // an offer that somehow priced above the web rate must not become a charge.
    ...(promo
      ? {
          promoDiscountCents: Math.max(0, unitType.webRateCents - promo.firstPeriodCents),
          promoTerms: promo.terms,
        }
      : {}),
  })

  return (
    <details className="mt-3">
      <summary className="border-input inline-flex min-h-11 cursor-pointer items-center rounded-md border px-3 text-sm font-medium">
        {translate(dict, 'facility.whatYoudPay')}
      </summary>

      {/* Grid rather than nested flex rows, and that is a correctness fix
          rather than a styling preference (found by B-090 part 1's scan of the
          opened disclosures). A `<dl>` may contain `<div>` groups, but each
          group has to hold its `<dt>`/`<dd>` DIRECTLY — the previous shape put
          them inside a second `<div>` with the note as their sibling, which
          axe reports as both `definition-list` and `dlitem`, and which means a
          screen reader does not read this as a term/value list at all. The
          note becomes a second `<dd>`, which is what it always was: more
          description of the same term. Two columns give the same
          label-left/amount-right layout, and the note spans both. */}
      <dl className="mt-3 flex flex-col gap-2 text-sm">
        {cost.lines.map((line) => (
          <div key={line.key} className="grid grid-cols-[1fr_auto] gap-x-4">
            <dt>{costLineLabel(dict, line, promo?.terms)}</dt>
            <dd className="tabular-nums">
              {line.key === 'protection'
                ? translate(dict, 'facility.chosenAtCheckout')
                : formatRate(line.amountCents)}
            </dd>
            {line.note && (
              <dd className="text-muted-foreground col-span-2 mt-0.5 text-xs text-pretty">
                {costLineNote(dict, line)}
              </dd>
            )}
          </div>
        ))}

        <div className="flex justify-between gap-4 border-t pt-2 font-medium">
          <dt>{translate(dict, 'facility.totalDueToday')}</dt>
          <dd className="tabular-nums">{formatRate(cost.totalDueTodayCents)}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt>{translate(dict, 'facility.thenEachMonth')}</dt>
          <dd className="tabular-nums">
            {formatRate(cost.ongoingMonthlyCents)}
            {translate(dict, 'card.perMonth')}
          </dd>
        </div>
      </dl>
    </details>
  )
}

function features(unitType: PublicUnitType, dict: Dictionary): string[] {
  const list: string[] = []
  if (unitType.climateControlled) list.push(translate(dict, 'facility.feature.climate'))
  if (unitType.driveUp) list.push(translate(dict, 'facility.feature.driveUp'))
  if (unitType.powerAvailable) list.push(translate(dict, 'facility.feature.power'))
  if (unitType.floor > 1)
    list.push(translate(dict, 'facility.feature.floor', { floor: unitType.floor }))
  return list
}

/// Everything except the code itself, so a GET form applying one does not drop
/// the filters and sort the renter already chose.
///
/// `unavailable` and `soldout` are deliberately NOT carried: both are one-shot
/// notices about something that just happened, and re-attaching them to a
/// promo-code submit would re-show "someone took the last one" for a unit
/// nobody was trying to take.
function carriedQuery(query: {
  size?: string
  features?: string | string[]
  sort?: string
  from?: string
}): Record<string, string | string[]> {
  const carried: Record<string, string | string[]> = {}
  if (query.size) carried.size = query.size
  if (query.sort) carried.sort = query.sort
  if (query.from) carried.from = query.from
  // Kept repeatable rather than comma-joined: `parseFilters` reads repeated
  // `features` parameters and does not split a string, so a join would leave
  // one value matching no `FeatureKey` and quietly clear every feature filter.
  if (query.features) carried.features = query.features
  return carried
}

/// The most useful of many per-size verdicts on one typed code.
///
/// Applied beats superseded beats rejected: if the code worked anywhere on this
/// page, that is the fact the renter needs, and the sizes it does not cover are
/// visible as cards without a badge.
function bestOutcome(outcomes: readonly CodeOutcome[]): CodeOutcome | null {
  const rank = { applied: 0, superseded: 1, rejected: 2 } as const
  return [...outcomes].sort((a, b) => rank[a.kind] - rank[b.kind])[0] ?? null
}

// B-262: async so it can read the locale for its "Rent now" action. The card is
// several components below `FacilityPage`, which has it — threading a prop
// through `UnitList` for one form attribute would be a wider change than
// reading the request again, and `getLocale()` is a header lookup.
async function UnitTypeCard({
  unitType,
  phone,
  pricing,
  facility,
  promo,
  code,
  dict,
}: {
  unitType: PublicUnitType
  phone: PhoneNumber
  pricing: PublicPricingContext
  facility: PublicFacility
  promo: { terms: string; firstPeriodCents: number; fromCode: boolean } | null
  /// B-122. Carried into the "Rent now" POST so the route re-evaluates the same
  /// code and locks the same offer onto the session. Without it a renter who
  /// applied a code and pressed Rent now would be quoted the automatic promo,
  /// or none — the browse estimate and the money path disagreeing again, which
  /// is exactly the defect B-070's own comment describes.
  code: string | null
  dict: Dictionary
}) {
  const locale = await getLocale()
  const t = (key: MessageKey, vars?: Record<string, string | number>) =>
    translate(dict, key, vars)
  const available = unitType.availableCount
  const saving = Math.max(0, unitType.streetRateCents - unitType.webRateCents)
  return (
    // B-149 links here by unit-type id from checkout's unit-lost branch, so a
    // renter who lost a size lands on the alternative rather than on the page.
    <li id={`unit-${unitType.unitTypeId}`} className="rounded-lg border p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="text-lg font-medium">
          {/* U+00D7 is the multiplication sign and is read as "ten times
              twenty", with the unit missing entirely. Sighted readers get the
              compact form; everyone else gets the sentence. */}
          <span aria-hidden="true">
            {unitType.widthFt}×{unitType.lengthFt}
          </span>
          <span className="sr-only">
            {t('facility.footBy', { width: unitType.widthFt, length: unitType.lengthFt })}
          </span>
          <span className="text-muted-foreground font-normal"> · {unitType.name}</span>
        </h3>
        <p className="font-medium">
          {formatRate(unitType.webRateCents)}
          <span className="text-muted-foreground font-normal">
            {t('facility.perMonthOnline')}
          </span>
        </p>
      </div>

      {/* PRD 04 US-12 AC1: "Eligible unit cards and facility pages show promo
          badge + plain-language terms." Terms beside the badge, not behind a
          tooltip — a discount whose conditions are a hover is a discount
          somebody argues about at the counter. */}
      {promo && (
        <p className="border-input mt-2 rounded-md border p-2 text-sm">
          <span className="font-medium">{promo.terms}</span>
          <span className="text-muted-foreground block text-xs">
            {/* B-122: the reassurance splits once a code can unlock a promo.
                "Nothing to enter" was true of every promotion that could exist
                before this item and is a lie about a code-gated one — the
                renter typed the thing it says there is nothing to type. */}
            {promo.fromCode
              ? t('facility.promoFromCode')
              : /* B-226. This sentence was FALSE until this row: the total below
                   was computed without the discount. It is kept, rather than
                   softened, because the fix made it true — and a claim that a
                   figure includes something is exactly the kind a reader
                   should be able to check by opening the expander. */
                t('facility.promoAutomatic')}
          </span>
        </p>
      )}

      {/* US-301: the in-store rate is struck through ONLY when it differs. A
          struck-through price identical to the price charged is a fabricated
          discount, so the equal case renders one figure and no strike. The
          saving is also stated in words — a line through a number is a visual
          signal only, and 1.4.1 forbids carrying meaning that way alone. */}
      {saving > 0 && (
        <p className="text-muted-foreground mt-1 text-sm">
          <s>{t('facility.inStoreStruck', { price: formatRate(unitType.streetRateCents) })}</s>{' '}
          <span className="text-foreground">
            {t('facility.savingOnline', { amount: formatRate(saving) })}
          </span>
        </p>
      )}

      <p className="text-muted-foreground mt-1 text-sm">
        {t('facility.sqFt', { sqFt: unitType.sqFt })}
        {unitType.heightFt !== null ? t('facility.ceiling', { height: unitType.heightFt }) : ''}
      </p>
      <p className="mt-1 text-sm text-pretty">{t(sizeHint(unitType.sqFt))}</p>

      {features(unitType, dict).length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-2">
          {features(unitType, dict).map((feature) => (
            <li key={feature} className="bg-muted rounded-full px-3 py-1 text-xs">
              {feature}
            </li>
          ))}
        </ul>
      )}

      {unitType.description && <p className="mt-3 text-sm text-pretty">{unitType.description}</p>}

      {available > 0 && (
        <CostBreakdown unitType={unitType} pricing={pricing} promo={promo} dict={dict} />
      )}

      {available > 0 && (
        <div className="mt-4">
          {/* US-401's entry point. Rent now (B-020) joins it here later; §6.6's
              trust line sits beside the CTA, not buried in the lease. */}
          <div className="flex flex-wrap gap-3">
            {/* POST, not a link: starting a checkout takes a unit off the
                market, so it must not fire on a prefetch or a back-button
                visit (B-020). */}
            {/* B-262. The ACTION carries the locale, not just the links. The
                route handler reads `getLocale()` to decide where to send the
                renter next, and it reads it from the URL this posts to — so an
                unprefixed action put a Spanish renter into the English
                checkout at the moment the money moves. It renders correctly
                and redirects wrongly, which is why only a clicking test found
                it. */}
            <form method="POST" action={localePath(locale, `${facilityPath(facility)}/rent`)}>
              <input type="hidden" name="unitTypeId" value={unitType.unitTypeId} />
              {code && <input type="hidden" name="promo" value={code} />}
              <button
                type="submit"
                className="bg-primary text-primary-foreground inline-flex min-h-11 items-center rounded-md px-4 text-sm font-medium"
              >
                {t('facility.rentNow')}
              </button>
            </form>
            <LocaleLink
              href={`${facilityPath(facility)}/reserve?unitType=${unitType.unitTypeId}`}
              className="border-input hover:bg-accent inline-flex min-h-11 items-center rounded-md border px-4 text-sm font-medium"
            >
              {t('facility.reserveForFree')}
            </LocaleLink>
          </div>
          {/* §6.6: the trust line for each action, beside the action. */}
          <p className="text-muted-foreground mt-2 text-xs">
            {t('facility.trustLine')}
          </p>
        </div>
      )}

      {/* §6.6 / US-201: scarcity language only ever comes from the real count.
          There is no countdown and no "in demand" — the number is the claim. */}
      <p className="mt-3 text-sm">
        {available === 0 ? (
          <>
            <span className="text-muted-foreground">{t('facility.allRented')}</span>
            <CallLink phone={phone} className="underline underline-offset-4" />
            <span className="text-muted-foreground">{t('facility.allRentedAfter')}</span>
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
                {plural(dict, available, 'facility.onlyLeftOne', 'facility.onlyLeftOther')}
              </span>
            ) : (
              <>{plural(dict, available, 'facility.availableOne', 'facility.availableOther')}</>
            )}
          </>
        )}
      </p>

      {/* B-090 part 1. Until now a sold-out size dead-ended in a phone number:
          somebody who wants a 10×20 and cannot have one today leaves, and we
          never learn they came. The call link stays above — it is the faster
          route for anybody willing to use it — and this is for everybody who
          is not. */}
      {available === 0 && (
        <WaitlistForm
          facilityId={facility.id}
          unitTypeId={unitType.unitTypeId}
          sizeLabel={t('facility.footBy', {
            width: unitType.widthFt,
            length: unitType.lengthFt,
          })}
          action={joinWaitlistAction}
        />
      )}
    </li>
  )
}

function FilterForm({
  filters,
  resultCount,
  dict,
}: {
  filters: UnitFilters
  resultCount: number
  dict: Dictionary
}) {
  const t = (key: MessageKey, vars?: Record<string, string | number>) =>
    translate(dict, key, vars)
  return (
    <form method="GET" className="border-input rounded-lg border p-4">
      <h3 className="text-base font-medium">{t('facility.narrowThese')}</h3>

      <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:flex-wrap">
        <div className="flex flex-col gap-1 text-sm">
          <label htmlFor="size">{t('facility.size')}</label>
          <select
            id="size"
            name="size"
            defaultValue={filters.size ?? ''}
            className="border-input bg-background h-11 rounded-md border px-2"
          >
            <option value="">{t('facility.anySize')}</option>
            {Object.entries(SIZE_BANDS).map(([key, band]) => (
              <option key={key} value={key}>
                {t(band.labelKey)}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1 text-sm">
          <label htmlFor="sort">{t('facility.sortBy')}</label>
          <select
            id="sort"
            name="sort"
            defaultValue={filters.sort}
            className="border-input bg-background h-11 rounded-md border px-2"
          >
            {Object.entries(SORTS).map(([key, sort]) => (
              <option key={key} value={key}>
                {t(sort.labelKey)}
              </option>
            ))}
          </select>
        </div>

        <fieldset className="flex flex-col gap-1 text-sm">
          <legend className="mb-1">{t('facility.features')}</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {Object.entries(FEATURE_FILTERS).map(([key, feature]) => (
              <label key={key} className="inline-flex min-h-11 items-center gap-2">
                <input
                  type="checkbox"
                  name="features"
                  value={key}
                  defaultChecked={filters.features.includes(key as never)}
                />
                {t(feature.labelKey)}
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
          {t('facility.apply')}
        </button>
        {hasActiveFilters(filters) && (
          <a href="?" className="text-sm underline underline-offset-4">
            {t('facility.clearFilters')}
          </a>
        )}
      </div>

      {/* 4.1.3: the result of applying a filter is announced, not just
          re-rendered. The region is in the DOM on every load, so the count
          changing is a mutation rather than an insertion. */}
      <p role="status" className="text-muted-foreground mt-3 text-sm">
        {plural(dict, resultCount, 'facility.matchesOne', 'facility.matchesOther')}
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
  promos,
  code,
  dict,
}: {
  unitTypes: PublicUnitType[] | null
  phone: PhoneNumber
  pricing: PublicPricingContext
  filtered: boolean
  facility: PublicFacility
  code: string | null
  /// Keyed by unit type: eligibility is per size (FR-PROMO-1's unit-type
  /// targeting), so one badge for the whole page would be wrong the moment a
  /// promo applies to 10x10s only.
  promos: Map<string, { terms: string; firstPeriodCents: number; fromCode: boolean }>
  dict: Dictionary
}) {
  const t = (key: MessageKey, vars?: Record<string, string | number>) =>
    translate(dict, key, vars)
  if (unitTypes === null) {
    // US-103: an inventory read that fails shows a call-to-confirm notice, never
    // an error page. The rest of the page — address, hours, directions — is
    // still worth the renter's trip.
    return (
      <p className="rounded-lg border p-4 text-pretty">
        {t('facility.noLiveAvailability')}{' '}
        <CallLink phone={phone} className="font-medium underline underline-offset-4" />{' '}
        {t('facility.noLiveAvailabilityAfter')}
      </p>
    )
  }

  if (unitTypes.length === 0) {
    // Two different problems with two different fixes: widen your filters, or
    // there is genuinely nothing here (§6.7 — name the problem, then the next
    // action).
    return filtered ? (
      <p className="rounded-lg border p-4 text-pretty">
        {t('facility.noFilterMatch')}{' '}
        <a href="?" className="font-medium underline underline-offset-4">
          {t('facility.clearThem')}
        </a>{' '}
        {t('facility.clearThemAfter')}
      </p>
    ) : (
      <p className="rounded-lg border p-4 text-pretty">
        {t('facility.noSizesPublished')}{' '}
        <CallLink phone={phone} className="font-medium underline underline-offset-4" />{' '}
        {t('facility.noSizesPublishedAfter')}
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
          ? t('facility.everythingRented')
          : plural(
              dict,
              available.length,
              'facility.availableSmallestOne',
              'facility.availableSmallestOther',
            )}
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
              promo={promos.get(unitType.unitTypeId) ?? null}
              code={code}
              dict={dict}
            />
          ))}
        </ul>
      )}

      {full.length > 0 && (
        <>
          <h3 className="mt-8 text-base font-medium">{t('facility.alsoHereFull')}</h3>
          <ul className="mt-4 flex flex-col gap-4">
            {full.map((unitType) => (
              <UnitTypeCard
              key={unitType.unitTypeId}
              unitType={unitType}
              phone={phone}
              pricing={pricing}
              facility={facility}
              promo={promos.get(unitType.unitTypeId) ?? null}
              code={code}
              dict={dict}
            />
            ))}
          </ul>
        </>
      )}
    </>
  )
}

function ContactBlock({
  facility,
  phone,
  dict,
}: {
  facility: PublicFacility
  phone: PhoneNumber
  dict: Dictionary
}) {
  const t = (key: MessageKey, vars?: Record<string, string | number>) =>
    translate(dict, key, vars)
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
          {phone.isMain
            ? t('facility.callMainLine', { phone: phone.display })
            : t('facility.callPhone', { phone: phone.display })}
        </a>
        <a
          href={directionsUrl(facility)}
          className="border-input hover:bg-accent inline-flex min-h-11 items-center gap-2 rounded-md border px-4 text-sm font-medium"
        >
          <MapPin className="size-4" aria-hidden="true" />
          {t('facility.getDirections')}
          <span className="sr-only">{t('facility.getDirectionsSr', { name: facility.name })}</span>
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
    /// B-122. What the renter typed into the code box. Re-evaluated server-side
    /// on this render; nothing about the discount travels in the URL except the
    /// string they typed.
    promo?: string
  }>
}) {
  const { state, city, slug } = await params
  const query = await searchParams
  const filters = parseFilters(query)
  // B-262: the locale itself is kept, not just the dictionary — the generated
  // FAQs and the JSON-LD URLs below are built from it too.
  const locale = await getLocale()
  const dict = dictionaryFor(locale)
  const t = (key: MessageKey, vars?: Record<string, string | number>) =>
    translate(dict, key, vars)

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
  const phone = phoneFor(facility.phone)

  // B-118. Split once, used by the hero strip above the fold and the lazy
  // gallery further down — never the same photo twice on one page load.
  const heroPhotos = facility.photos.slice(0, 3)
  const restPhotos = facility.photos.slice(3)

  // The cheapest AVAILABLE size in the renter's own current filter — `visible`,
  // not the unfiltered `unitTypes` — so the sticky bar never quotes a price for
  // a size the renter has just filtered out. Null (no bar) when nothing here is
  // rentable right now; a fabricated price on an empty facility is worse than
  // no bar at all.
  const cheapestAvailable = (visible ?? [])
    .filter((unitType) => unitType.availableCount > 0)
    .reduce<PublicUnitType | null>(
      (min, unitType) => (min === null || unitType.webRateCents < min.webRateCents ? unitType : min),
      null,
    )

  // PRD 04 FR-AN-2. Server-side, so it survives an ad blocker and a declined
  // consent — this is the top of the funnel and the denominator of every
  // conversion rate below it. Not awaited: `track` never throws and never
  // matters more than the page, and holding the render for an insert would
  // trade a real LCP budget (FR-SEO-6) for a count.
  void trackPageView(facility.id)

  // FR-SEO-4. Built from the facility record and the live inventory, never
  // hand-authored — structured data that contradicts the visible page is the
  // thing that gets penalised, and the only way to guarantee it cannot is for
  // both to read the same source.
  // PRD 04 US-12 AC1. Evaluated per unit type, because FR-PROMO-1 lets a promo
  // target sizes — one badge for the page would be wrong the moment a promo
  // applies to 10x10s only. `isNewTenant: true` because an anonymous visitor
  // browsing prices is, as far as anything here knows, a new customer; checkout
  // re-evaluates against the real person before anything is redeemed.
  //
  // B-122: the typed code goes in here too, so a code-gated promo produces a
  // real badge and a real figure on the card it applies to — the same evaluator
  // and the same numbers the "Rent now" POST will re-derive a moment later.
  const typedCode = query.promo?.trim() || null
  const promos = new Map<string, { terms: string; firstPeriodCents: number; fromCode: boolean }>()
  const outcomes: CodeOutcome[] = []
  for (const unitType of unitTypes ?? []) {
    const lookup = await offerFor({
      facilityId: facility.id,
      unitTypeId: unitType.unitTypeId,
      monthlyRateCents: unitType.webRateCents,
      isNewTenant: true,
      code: typedCode,
    })
    if (lookup.codeOutcome) outcomes.push(lookup.codeOutcome)
    if (lookup.offer) {
      promos.set(unitType.unitTypeId, {
        terms: lookup.offer.terms,
        firstPeriodCents: lookup.offer.firstPeriodCents,
        fromCode: lookup.offer.promoCodeId !== null,
      })
    }
  }
  // One message beside the box, from many per-size answers.
  //
  // A code can legitimately be "not for this size" on the 5x5 and applied on
  // the 10x10 — FR-PROMO-1 lets a promo target sizes — so a per-card message
  // would say the code failed directly above a card showing the discount. The
  // page-level line reports the best thing that happened anywhere on it, and
  // each card keeps showing its own true figure regardless.
  const codeOutcome = bestOutcome(outcomes)

  // PRD 04 US-6 (B-071). `schemaAggregateRating` is almost always null — see
  // D-33: manually transcribed reviews never qualify for the JSON-LD markup,
  // whatever the on-page average says.
  const { average: reviewAverage, reviews, schemaAggregateRating } = await visibleReviewsForFacility(
    facility.id,
  )

  const canonicalUrl = absoluteUrl(siteOrigin(), canonical)
  // A facility's own FAQs replace the generated set outright rather than
  // appending to it: a marketer who has written four answers has decided what
  // this page says, and quietly padding it back to five with boilerplate would
  // put words in their mouth. US-1 AC2's "at least 5" is why the generated set
  // is still the fallback when they have written none.
  // B-262: the generated set follows the language. A marketer's OWN answers
  // (`facility.faqs`) are not translated — they are somebody's own words, the
  // same rule D-122 puts on facility copy and amenities — so a facility that
  // has written its own FAQ shows it in English on both URLs. That is a real
  // gap and it is named in PROGRESS.md rather than papered over by
  // machine-translating an operator's answer about their own site.
  const faqs = facility.faqs.length > 0 ? facility.faqs : defaultFacilityFaqs(facility, locale)
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
      aggregateRating: schemaAggregateRating ?? undefined,
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
          <LocaleLink href={backToSearch} className="underline underline-offset-4">
            {t('facility.backToSearch', { query: query.from ?? '' })}
          </LocaleLink>
        </p>
      )}

      {query.soldout && (
        <p role="status" className="border-input mb-4 rounded-md border p-3 text-sm text-pretty">
          {t('facility.soldOutNotice')}
        </p>
      )}

      {query.unavailable && (
        <p role="status" className="border-input mb-4 rounded-md border p-3 text-sm text-pretty">
          {t('facility.unavailableNotice')}
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

      {/* B-118 (UX review 2026-08-12, finding 7). §6.3 fixes photos first, and
          the gallery used to render ~700 lines down the page — after the hours
          table, every unit card and a paragraph of marketing copy. A renter
          comparing three sites on a phone judges "clean, lit, not a dump" from
          an image, and this page was giving it to them last.
          Up to three photos, pulled off the front of the gallery so nothing
          renders twice; `restPhotos` (below, at the original position) keeps
          `loading="lazy"`. A facility with none renders no placeholder and no
          empty frame — there is nothing honest to reserve the space for. */}
      {heroPhotos.length > 0 && (
        <ul className={`mt-4 grid gap-2 ${heroPhotos.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
          {heroPhotos.map((photo, index) => (
            <li key={photo.url} className={heroPhotos.length === 3 && index === 0 ? 'col-span-2' : undefined}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={photo.url}
                alt={photo.alt}
                // The LCP candidate. `fetchPriority` on the first image only —
                // it is the hint that this is THE largest content paint, and
                // putting it on more than one dilutes which image the browser
                // should race to fetch first.
                fetchPriority={index === 0 ? 'high' : undefined}
                loading="eager"
                decoding="async"
                // Real per-photo pixel dimensions are not stored (FacilityPhoto
                // has no width/height column) and the display box is always
                // 4:3 via `object-cover` regardless of the source image's own
                // ratio — so these attributes exist to give the browser the
                // ASPECT RATIO for its CLS reservation before either CSS or the
                // bytes arrive, matching the `aspect-4/3` class below rather
                // than claiming a specific rendered size. 800×600 is 4:3 at a
                // size no real facility photo is smaller than.
                width={800}
                height={600}
                className="aspect-4/3 w-full rounded-lg border object-cover"
              />
            </li>
          ))}
        </ul>
      )}

      <ContactBlock facility={facility} phone={phone} dict={dict} />

      {/* §6.6: the commitment terms belong next to the decision, not buried in
          the lease. */}
      <p className="text-muted-foreground mt-4 text-sm">
        {t('facility.monthToMonth')}
      </p>

      <section aria-labelledby="hours" className="mt-10">
        <h2 id="hours" className="text-xl font-medium">
          {t('facility.hoursHeading')}
        </h2>
        {/* §6.3: office hours and gate access hours must never be conflated.
            They are two separately captioned tables for exactly that reason —
            the gate is usually open long after the office closes, and a renter
            who confuses them shows up to a locked office or an unstaffed site. */}
        <p className="text-muted-foreground mt-1 text-sm text-pretty">
          {t('facility.hoursIntro')}
        </p>
        <div className="mt-4 grid gap-8 sm:grid-cols-2">
          <HoursTable
            caption={t('facility.officeHours')}
            schedule={facility.officeHours}
            phone={phone}
            dict={dict}
          />
          <HoursTable
            caption={t('facility.gateHours')}
            schedule={facility.gateHours}
            phone={phone}
            dict={dict}
          />
        </div>
      </section>

      <section aria-labelledby="units" className="mt-10">
        <h2 id="units" className="text-xl font-medium">
          {t('facility.availableUnits')}
        </h2>
        {unitTypes !== null && unitTypes.length > 0 && (
          <div className="mt-4">
            <FilterForm filters={filters} resultCount={visible?.length ?? 0} dict={dict} />
          </div>
        )}

        {/* PRD 04 US-11 AC3 (B-122). Below the filters and above the cards, so
            the badges and figures the code changes are the next thing read.
            The filters, sort and size ride along as hidden inputs — a GET form
            replaces the whole query string, so without them applying a code
            would silently clear the choices the renter had already made. */}
        {unitTypes !== null && unitTypes.length > 0 && (
          <div className="mt-4">
            <PromoCodeEntry
              outcome={codeOutcome}
              value={typedCode ?? ''}
              carry={carriedQuery(query)}
            />
          </div>
        )}

        <div className="mt-4">
          <UnitList
            unitTypes={visible}
            phone={phone}
            pricing={pricing}
            filtered={hasActiveFilters(filters)}
            facility={facility}
            promos={promos}
            code={typedCode}
            dict={dict}
          />
        </div>
      </section>

      {/* B-118 (UX review 2026-08-12, finding 14). §6.2's sticky "Rent now" bar
          — below `sm` only; a comparer who has scrolled past the units section
          to read amenities, the map or the FAQ no longer has Rent/Reserve on
          screen at all, and this repeats them without scrolling back up.

          Pure CSS, the same technique `price-summary.tsx` uses for the
          checkout stepper's own persistent total: `sticky bottom-0` on an
          element placed immediately after the units section keeps it in
          normal flow (so it never covers content) while the units section
          itself is still on screen — there is nothing to add, the cards above
          already carry their own buttons. Once the visitor scrolls past this
          point, the element's own position would scroll off the bottom of the
          viewport, and `sticky` pins it there instead; scrolling back up into
          the units section returns it to normal flow and it disappears again.
          No JavaScript, no IntersectionObserver, works with the bundle
          disabled like the rest of this page.

          Null, not a fabricated placeholder, when nothing here is rentable —
          `cheapestAvailable` already excludes a sold-out size. */}
      {cheapestAvailable && (
        <div className="border-input bg-background sticky bottom-0 z-10 -mx-4 mt-4 border-t p-4 sm:hidden">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium">
              {t('facility.from', { price: formatRate(cheapestAvailable.webRateCents) })}
              <span className="text-muted-foreground font-normal">{t('card.perMonth')}</span>
            </p>
            <div className="flex gap-2">
              <form
                method="POST"
                action={localePath(locale, `${facilityPath(facility)}/rent`)}
              >
                <input type="hidden" name="unitTypeId" value={cheapestAvailable.unitTypeId} />
                {/* B-122. The sticky bar starts the same checkout as a card, so
                    it has to carry the same code — a renter who applied one and
                    then used this button instead would silently lose it. */}
                {typedCode && <input type="hidden" name="promo" value={typedCode} />}
                <button
                  type="submit"
                  className="bg-primary text-primary-foreground inline-flex min-h-11 items-center rounded-md px-4 text-sm font-medium"
                >
                  {t('facility.rentNow')}
                </button>
              </form>
              <LocaleLink
                href={`${facilityPath(facility)}/reserve?unitType=${cheapestAvailable.unitTypeId}`}
                className="border-input hover:bg-accent inline-flex min-h-11 items-center rounded-md border px-4 text-sm font-medium"
              >
                {t('facility.reserveFree')}
              </LocaleLink>
            </div>
          </div>
        </div>
      )}

      {facility.amenities.length > 0 && (
        <section aria-labelledby="amenities" className="mt-10">
          <h2 id="amenities" className="text-xl font-medium">
            {t('facility.atThisFacility')}
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
            {t('facility.whereWeAre')}
          </h2>
          {/* The text equivalent comes FIRST. The embed is a third-party
              document we cannot remediate — its zoom controls are named "+" and
              "−" and its marker has no text alternative — so a screen-reader or
              keyboard user should reach the link that replaces it without
              traversing it. The address above is text and this link works with
              the frame blocked entirely. */}
          <p className="mt-2 text-sm">
            <a href={directionsUrl(facility)} className="underline underline-offset-4">
              {t('facility.openDirections')}
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
              {t('facility.showMap')}
            </summary>
            {/* `title` gives the frame an accessible name; without one a screen
                reader announces a nameless frame full of unlabelled tiles. */}
            <iframe
              title={t('facility.mapTitle', {
                name: facility.name,
                address: formatAddress(facility),
              })}
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
            {t('facility.aboutThisLocation')}
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

      {/* US-2 AC1's photo set, minus the 1–3 pulled above the fold as the hero
          (B-118) — `restPhotos`, never `facility.photos`, or the same image
          renders twice on the page. Alt text is a required column, so there is
          no decorative-image branch here — every one of these describes
          something a renter is trying to judge from a screen. Always
          `loading="lazy"`: the LCP candidate is the hero now, not this section. */}
      {restPhotos.length > 0 && (
        <section aria-labelledby="photos" className="mt-10">
          <h2 id="photos" className="text-xl font-medium">
            {t('facility.photos')}
          </h2>
          <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {restPhotos.map((photo) => (
              <li key={photo.url}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={photo.url}
                  alt={photo.alt}
                  loading="lazy"
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

      {/* PRD 04 US-8 (B-068). For the prospect who is not ready to reserve —
          which is most of them. Placed after the units and before the FAQ:
          somebody who has read the prices and not clicked Rent is exactly the
          person this catches. */}
      <section aria-labelledby="ask" className="mt-10">
        <h2 id="ask" className="text-xl font-medium">
          {t('facility.askUs')}
        </h2>
        <p className="text-muted-foreground mt-2 max-w-prose text-sm text-pretty">
          {t('facility.askUsBody')}
        </p>
        <div className="mt-4">
          <LeadForm
            facilityId={facility.id}
            unitTypes={(unitTypes ?? []).map((unitType) => ({
              id: unitType.unitTypeId,
              label: `${unitType.name} — ${unitType.sqFt} sq ft`,
            }))}
            action={submitLeadAction}
          />
        </div>
      </section>

      {/* PRD 04 US-6 AC1/AC2. Manual transcriptions today, attributed as such —
          never presented as though collected here (D-33 is the same reason
          the average is not marked up as `aggregateRating`). */}
      {reviews.length > 0 && reviewAverage && (
        <section aria-labelledby="reviews" className="mt-10">
          <h2 id="reviews" className="text-xl font-medium">
            {t('facility.whatRentersSay')}
          </h2>
          <p className="text-muted-foreground mt-1">
            {plural(dict, reviewAverage.reviewCount, 'facility.ratedOne', 'facility.ratedOther', {
              rating: reviewAverage.ratingValue.toFixed(1),
            })}
          </p>
          <ul className="mt-4 flex flex-col gap-4">
            {reviews.map((review) => (
              <li key={review.id} className="border-input rounded-lg border p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span
                    aria-label={t('facility.starsLabel', { rating: review.rating })}
                    className="font-medium"
                  >
                    {'★'.repeat(review.rating)}
                    {'☆'.repeat(5 - review.rating)}
                  </span>
                  <span className="text-muted-foreground text-sm">
                    {review.reviewerDisplayName} · {review.sourceLabel}
                  </span>
                </div>
                <p className="text-muted-foreground mt-2 text-sm text-pretty">{review.text}</p>
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
          {t('facility.questionsPeopleAsk')}
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
        {t('search.sizeGuideBefore')}{' '}
        <LocaleLink href="/storage/size-guide" className="underline underline-offset-4">
          {t('search.sizeGuideLink')}
        </LocaleLink>
        {t('facility.sizeGuideOr')}{' '}
        <LocaleLink href="/storage/search" className="underline underline-offset-4">
          {t('facility.otherLocations')}
        </LocaleLink>
        .
      </p>
    </div>
  )
}
