import Link from 'next/link'
import { ArrowRight, Check, CreditCard, KeyRound, Phone, ShieldCheck } from 'lucide-react'
import { FacilitySearchForm } from '@/components/site/facility-search-form'
import { FacilityCard } from '@/components/site/facility-card'
import { SITE } from '@/lib/site-config'
import { formatRate } from '@/lib/format'
import { publicFootprint } from '@/lib/facility/public-facility'
import { cachedHomeFacts } from '@/lib/marketing/home-facts'
import { sizeBandFor } from '@/lib/inventory/unit-filters'
import { dictionaryFor, plural, translate, type MessageKey } from '@/lib/i18n'
import { getLocale } from '@/lib/i18n/server'

// Homepage (PRD 01 §6.1), laid out as the design kit's `HomeScreen` (B-365,
// D-146). The search is still the one primary action above the fold, and it
// still submits by GET so the query lands in a shareable URL (US-101).
//
// D-147: the kit's voice, the registry's facts. Every count, price and window
// below is read by `cachedHomeFacts`; the kit's photos, segmented product
// picker (no vehicle or container product exists), "First month $1", manager
// names and "gate from your phone" have nothing behind them and are dropped.
// A section whose data is empty is left out rather than rendered hollow.

const WHY = [
  { icon: Phone, title: 'home.whyCallTitle', body: 'home.whyCallBody' },
  { icon: CreditCard, title: 'home.whyPayTitle', body: 'home.whyPayBody' },
  { icon: KeyRound, title: 'home.whyGateTitle', body: 'home.whyGateBody' },
] as const satisfies readonly { title: MessageKey; body: MessageKey; icon: unknown }[]

export default async function HomePage() {
  const locale = await getLocale()
  const dict = dictionaryFor(locale)
  const t = (key: MessageKey, vars?: Record<string, string | number>) =>
    translate(dict, key, vars)
  const [{ siteCount, cities }, facts] = await Promise.all([publicFootprint(), cachedHomeFacts()])
  const cityList = new Intl.ListFormat(locale, { type: 'conjunction' }).format(
    cities.map((c) => c.city),
  )

  return (
    <>
      <section className="mx-auto w-full max-w-6xl px-4 py-6 sm:py-16">
        <div className="flex max-w-2xl flex-col gap-5">
          {siteCount > 0 && (
            <p className="bg-accent text-accent-foreground hidden self-start rounded-full sm:block px-3 py-1 text-sm font-medium">
              {plural(dict, siteCount, 'chrome.footprintOne', 'chrome.footprintOther', {
                cities: cityList,
              })}
            </p>
          )}
          <h1 className="font-heading text-3xl font-bold tracking-tight text-balance sm:text-5xl">
            {t('home.h1')}
          </h1>
          <p className="text-lg text-pretty">
            {t('home.leadBefore')}{' '}
            <a href={`tel:${SITE.phone.href}`} className="underline underline-offset-4">
              {SITE.phone.display}
            </a>
            .
          </p>

          <div className="bg-card rounded-xl border p-4 shadow-sm">
            <FacilitySearchForm />
            <p className="text-muted-foreground mt-2 text-sm">{t('home.noCard')}</p>
          </div>

          <ul className="text-muted-foreground flex flex-wrap gap-x-6 gap-y-2 text-sm">
            {(['facility.monthToMonth', 'home.checkOnline'] as const).map((key) => (
              <li key={key} className="inline-flex items-center gap-2">
                <Check className="text-primary size-4" aria-hidden="true" />
                {t(key)}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {facts.sizes.length > 0 && (
        <section aria-labelledby="sizes-heading" className="bg-muted/50 border-y">
          <div className="mx-auto w-full max-w-6xl px-4 py-12">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-muted-foreground text-sm font-semibold tracking-wider uppercase">
                  {t('home.sizesEyebrow')}
                </p>
                <h2 id="sizes-heading" className="font-heading mt-2 text-2xl font-bold tracking-tight">
                  {t('home.sizesHeading')}
                </h2>
              </div>
              <Link
                href="/storage/size-guide"
                className="inline-flex min-h-11 items-center gap-1.5 font-medium underline-offset-4 hover:underline"
              >
                {t('home.sizeGuideLink')}
                <ArrowRight className="size-4" aria-hidden="true" />
              </Link>
            </div>
            <ul className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {facts.sizes.map((size) => (
                <li
                  key={`${size.widthFt}x${size.lengthFt}`}
                  className="bg-card flex flex-col gap-2 rounded-xl border p-5"
                >
                  {/* U+00D7 announces as "times", so the compact form is for
                      sight and the sentence is for the screen reader (B-242). */}
                  <h3 className="font-heading text-xl font-bold">
                    <span aria-hidden="true">
                      {size.widthFt} × {size.lengthFt}
                    </span>
                    <span className="sr-only">
                      {t('home.sizeSr', { width: size.widthFt, length: size.lengthFt })}
                    </span>
                  </h3>
                  <p className="text-muted-foreground text-sm">
                    {t('home.sqFt', { sqFt: size.widthFt * size.lengthFt })}
                  </p>
                  <p className="text-lg font-semibold">
                    {t('card.from')} {formatRate(size.webRateCents)}
                    <span className="text-muted-foreground font-normal">{t('card.perMonth')}</span>
                  </p>
                  {/* US-201: the only scarcity figure is the real count. */}
                  <p className="text-muted-foreground text-sm">
                    {plural(dict, size.availableUnits, 'home.openOne', 'home.openOther')}
                  </p>
                  <Link
                    href={`/storage/search?size=${sizeBandFor(size.widthFt * size.lengthFt)}`}
                    className="mt-auto inline-flex min-h-11 items-center gap-1.5 font-medium underline underline-offset-4"
                  >
                    {t('home.seeFacilities')}
                    <span className="sr-only">
                      {' '}
                      {t('home.seeFacilitiesSr', { width: size.widthFt, length: size.lengthFt })}
                    </span>
                    <ArrowRight className="size-4" aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      <section aria-labelledby="why-heading" className="mx-auto w-full max-w-6xl px-4 py-12">
        <h2 id="why-heading" className="font-heading max-w-2xl text-2xl font-bold tracking-tight">
          {t('home.whyHeading')}
        </h2>
        <p className="mt-3 max-w-2xl text-pretty">{t('home.whyBody')}</p>
        <ul className="mt-6 grid gap-6 sm:grid-cols-2">
          {facts.protectionFromCents !== null && (
            <WhyItem
              icon={ShieldCheck}
              title={t('home.whyProtectTitle', { price: formatRate(facts.protectionFromCents) })}
              body={t('home.whyProtectBody')}
            />
          )}
          {WHY.map((item) => (
            <WhyItem key={item.title} icon={item.icon} title={t(item.title)} body={t(item.body)} />
          ))}
        </ul>
      </section>

      {facts.facilities.length > 0 && (
        <section aria-labelledby="facilities-heading" className="mx-auto w-full max-w-6xl px-4 py-12">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h2 id="facilities-heading" className="font-heading text-2xl font-bold tracking-tight">
              {t('home.facilitiesHeading')}
            </h2>
            {/* B-366. Every active facility, in state/city order — fine at
                demo scale, and the locations page is where a nearest-first cut
                (and a longer list) belongs instead of duplicating it here. */}
            <Link href="/storage/locations" className="text-sm underline underline-offset-4">
              {t('home.allLocations')}
            </Link>
          </div>
          <ul className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {facts.facilities.map((facility) => (
              <FacilityCard key={facility.slug} facility={facility} dict={dict} />
            ))}
          </ul>
        </section>
      )}

      <section className="mx-auto w-full max-w-6xl px-4 py-12">
        <div
          data-surface="inverse"
          className="bg-inverse text-inverse-foreground flex flex-col gap-6 rounded-xl p-8 md:flex-row md:items-center md:justify-between"
        >
          <div className="flex max-w-xl flex-col gap-3">
            <h2 className="font-heading text-2xl font-bold tracking-tight">{t('home.ctaHeading')}</h2>
            <p className="text-inverse-muted">
              {t('home.ctaBody')}
              {facts.holdDays !== null && <> {t('reserve.holdDays', { days: facts.holdDays })}.</>}
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link
              href="/storage/search"
              className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex min-h-11 items-center rounded-md px-5 font-medium"
            >
              {t('home.ctaFind')}
            </Link>
            <a
              href={`tel:${SITE.phone.href}`}
              className="border-inverse-muted inline-flex min-h-11 items-center gap-2 rounded-md border px-5 font-medium"
            >
              <Phone className="size-4" aria-hidden="true" />
              <span className="sr-only">{t('chrome.callUsAt')}</span>
              {SITE.phone.display}
            </a>
          </div>
        </div>
      </section>
    </>
  )
}

function WhyItem({
  icon: Icon,
  title,
  body,
}: {
  icon: typeof Phone
  title: string
  body: string
}) {
  return (
    <li className="flex gap-3">
      <Icon className="text-primary mt-0.5 size-5 shrink-0" aria-hidden="true" />
      <div>
        <h3 className="font-semibold">{title}</h3>
        <p className="text-muted-foreground text-sm">{body}</p>
      </div>
    </li>
  )
}

