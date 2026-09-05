import { LocaleLink } from '@/components/site/locale-link'
import { SITE } from '@/lib/site-config'
import { dimensionSpoken, parseDimension, sizeFacts, UNIT_SIZE_ORDER } from '@storage/core/marketing'
import { getLocale } from '@/lib/i18n/server'
import { dictionaryFor, translate, type Locale, type MessageKey } from '@/lib/i18n'
import { localeAlternates } from '@/lib/marketing/alternates'

// B-262: `generateMetadata` rather than a static `metadata`, so the page can
// declare its own canonical and name its Spanish twin. The words are still
// English here — the size table itself is translated in the same item, but the
// tab title follows it rather than leading.
export async function generateMetadata() {
  const locale = await getLocale()
  const dict = dictionaryFor(locale)
  return {
    title: translate(dict, 'sizeGuide.title'),
    description: translate(dict, 'sizeGuide.meta'),
    alternates: localeAlternates(locale, '/storage/size-guide'),
  }
}

// PRD 01 US-202. The size guide, as its own crawlable page.
//
// The "size estimator quiz" the story also mentioned is dropped (D-15 round /
// §9): renters do not finish quizzes, they look at a size and picture their
// sofa in it. A good comparison table converts better and costs a tenth as
// much, so this carries the whole job.
//
// No photographs yet. Nothing in the product stores an image and B-067 owns
// photo management *with required alt text*, so illustrations here would either
// ship without alt text or duplicate that item. The written comparisons are the
// part that actually answers the question, and they are what a screen-reader
// user would get from a good alt attribute anyway.

// B-089 moved this catalogue to `@storage/core/marketing`. It did not move for
// tidiness: the per-city/size landing pages need the same comparison and
// "typical" sentences, and those sentences are precisely what makes a
// "10×10 storage units in Austin" page different from the 10×15 page beside it.
// Two copies would drift, and the copy that drifted would be the one nobody
// opens.
//
// D-60 still holds. That decision is about not RE-PUBLISHING the guide, and a
// landing page takes two sentences about its own size and links here for the
// rest — it does not reproduce this page's seven entries.
//
// B-262: built per request rather than at module scope, because the comparison
// sentences are now per language. The ORDER and the measurements are still
// derived from the catalogue, so a size cannot be in the guide and absent from
// the landing pages, or the reverse.
function sizesFor(locale: Locale) {
  return UNIT_SIZE_ORDER.map((key) => {
    const { widthFt, lengthFt } = parseDimension(key)!
    return {
      ...sizeFacts(widthFt, lengthFt, locale)!,
      spoken: dimensionSpoken(widthFt, lengthFt),
    }
  })
}

export default async function SizeGuidePage() {
  const locale = await getLocale()
  const dict = dictionaryFor(locale)
  const t = (key: MessageKey) => translate(dict, key)
  const SIZES = sizesFor(locale)

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-12">
      <h1 className="text-3xl font-semibold tracking-tight text-balance">{t('sizeGuide.title')}</h1>
      <p className="text-muted-foreground mt-4 text-lg text-pretty">{t('sizeGuide.intro')}</p>

      <div className="mt-8 flex flex-col gap-6">
        {SIZES.map((size) => (
          <section
            key={size.label}
            aria-labelledby={`size-${size.sqFt}`}
            className="rounded-lg border p-4"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h2 id={`size-${size.sqFt}`} className="text-xl font-medium">
                {/* The × is a multiplication sign and screen readers announce
                    it as "times", with the unit missing entirely. Sighted
                    readers get the compact form; everyone else gets the
                    sentence. Same treatment as the facility page. */}
                <span aria-hidden="true">{size.label}</span>
                <span className="sr-only">{size.spoken}</span>
              </h2>
              <p className="text-muted-foreground text-sm">
                {size.sqFt} {t('sizeGuide.sqFt')}
              </p>
            </div>

            <p className="mt-2 font-medium text-pretty">{size.comparison}</p>

            <h3 className="mt-3 text-sm font-medium">{t('sizeGuide.usuallyHolds')}</h3>
            <ul className="mt-1 list-disc pl-5 text-sm">
              {size.fits.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>

            <p className="text-muted-foreground mt-3 text-sm text-pretty">{size.typical}</p>
          </section>
        ))}
      </div>

      <section aria-labelledby="between" className="mt-10">
        <h2 id="between" className="text-xl font-medium">
          {t('sizeGuide.betweenHeading')}
        </h2>
        <p className="mt-2 text-pretty">{t('sizeGuide.betweenBody')}</p>
        <p className="mt-4">
          {t('sizeGuide.stillUnsure')}{' '}
          <a href={`tel:${SITE.phone.href}`} className="font-medium underline underline-offset-4">
            {t('sizeGuide.callPrefix')} {SITE.phone.display}
          </a>{' '}
          <span className="text-muted-foreground">{t('sizeGuide.describeWhat')}</span>
        </p>
        <p className="mt-4">
          <LocaleLink href="/storage/search" className="underline underline-offset-4">
            {t('sizeGuide.findStorage')}
          </LocaleLink>
        </p>
        {/* B-082 part 3. This page is the fifth guide in the hub's launch set
            and it stays at this URL — it has been indexable since B-016 and is
            linked from the facility, search and city pages, so re-publishing
            its text under /guides to make the set look uniform would create the
            duplicate content this row's part 6 exists to warn about (D-60). The
            hub links here; here links back. */}
        <p className="mt-4">
          <LocaleLink href="/guides" className="underline underline-offset-4">
            Read the other storage guides
          </LocaleLink>
        </p>
      </section>
    </div>
  )
}
