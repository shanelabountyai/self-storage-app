import { FacilitySearchForm } from '@/components/site/facility-search-form'
import { FacilityCard } from '@/components/site/facility-card'
import { SITE } from '@/lib/site-config'
import { cachedHomeFacts, sortByDistance } from '@/lib/marketing/home-facts'
import { parseGeoPoint } from '@/lib/geo/geocode'
import { absoluteUrl, breadcrumbJsonLd, renderJsonLd } from '@storage/core/marketing'
import { siteOrigin } from '@/lib/marketing/origin'
import { dictionaryFor, translate, type MessageKey } from '@/lib/i18n'
import { getLocale } from '@/lib/i18n/server'

// B-366 (D-146, D-147). The kit's `LocationsScreen` — every active facility in
// one flat, searchable directory, rather than the home page's own (unsorted)
// sample or the per-city listing scoped to one city. Reachable from the home
// page's facilities section ("All locations") and from here back to search.
//
// Dropped rather than adopted, per D-147's "add no route the data cannot
// fill": the kit's per-site manager name (no such column), franchise CTA (no
// franchise program), and regional map graphic (a placeholder standing in for
// nothing real). What is real — name, address, phone, starting price — is the
// same read the home page already uses.

export async function generateMetadata() {
  const dict = dictionaryFor(await getLocale())
  const title = translate(dict, 'locations.title')
  const description = translate(dict, 'locations.metaDescription')
  const canonical = '/storage/locations'
  const url = absoluteUrl(siteOrigin(), canonical)
  return {
    title,
    description,
    alternates: { canonical },
    openGraph: { type: 'website', title, description, url, siteName: SITE.brand, locale: 'en_US' },
    twitter: { card: 'summary_large_image', title, description },
  }
}

export default async function LocationsPage({
  searchParams,
}: {
  searchParams: Promise<{ lat?: string; lng?: string }>
}) {
  const { lat, lng } = await searchParams
  const dict = dictionaryFor(await getLocale())
  const t = (key: MessageKey) => translate(dict, key)

  const point = parseGeoPoint({ lat, lng })
  const facts = await cachedHomeFacts()
  const withDistance = sortByDistance(facts.facilities, point)

  const canonicalUrl = absoluteUrl(siteOrigin(), '/storage/locations')
  const schema = [
    breadcrumbJsonLd([
      { name: 'Storage', url: absoluteUrl(siteOrigin(), '/storage/search') },
      { name: t('locations.title'), url: canonicalUrl },
    ]),
  ].filter((node): node is NonNullable<typeof node> => node !== null)

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-12">
      {schema.map((node, index) => (
        <script
          key={index}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: renderJsonLd(node) }}
        />
      ))}

      <h1 className="text-3xl font-semibold tracking-tight text-balance">
        {t('locations.heading')}
      </h1>
      <p className="text-muted-foreground mt-3 max-w-2xl text-lg text-pretty">
        {t('locations.intro')}
      </p>
      {/* Always mounted and empty until there is a point: a live region inserted
          with its text already inside is unreliably announced (B-374). */}
      <p role="status" className="text-muted-foreground text-sm empty:mt-0 mt-2">
        {point && t('locations.nearestFirst')}
      </p>

      <div className="mt-6">
        <FacilitySearchForm labelKey="search.labelZipOrCity" locationTarget="/storage/locations" />
      </div>

      {facts.facilities.length === 0 ? (
        <div className="mt-10">
          <h2 className="text-xl font-medium">{t('search.noneListedHeading')}</h2>
          <p className="text-muted-foreground mt-2 text-pretty">{t('search.noneListedBody')}</p>
        </div>
      ) : (
        <ul className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {withDistance.map(({ facility, distanceMiles: miles }) => (
            <FacilityCard key={facility.slug} facility={facility} dict={dict} distanceMiles={miles} />
          ))}
        </ul>
      )}
    </div>
  )
}
