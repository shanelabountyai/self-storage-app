import Link from 'next/link'
import { FacilitySearchForm } from '@/components/site/facility-search-form'
import { SITE } from '@/lib/site-config'
import {
  dictionaryFor,
  translate,
  type MessageKey,
} from '@/lib/i18n'
import { getLocale } from '@/lib/i18n/server'

// Homepage (PRD 01 §6.1). One primary CTA — the search — and nothing competing
// with it. The form submits by GET so the query lands in a shareable URL
// (`/storage/search?q=78704`, US-101).

/// The search form's typeahead lists the places we operate, which means this
/// page now reads the facility registry. Revalidating hourly keeps the DATA
/// read cheap; since B-090 part 6 the rendered HTML is no longer cached at
/// all, because the root layout reads the language cookie — see
/// `lib/i18n/index.ts` for why that trade was taken and what reverses it.
export const revalidate = 3600

/// The three steps, as message keys. The copy is in the dictionaries; what
/// stays here is the order and the fact that there are three of them.
const STEPS = [
  { title: 'home.step1.title', body: 'home.step1.body' },
  { title: 'home.step2.title', body: 'home.step2.body' },
  { title: 'home.step3.title', body: 'home.step3.body' },
] as const satisfies readonly { title: MessageKey; body: MessageKey }[]

export default async function HomePage() {
  const dict = dictionaryFor(await getLocale())
  const t = (key: MessageKey) => translate(dict, key)

  return (
    <>
      <section className="mx-auto w-full max-w-6xl px-4 py-12 sm:py-20">
        <h1 className="max-w-3xl text-3xl font-semibold tracking-tight text-balance sm:text-5xl">
          {t('home.h1')}
        </h1>
        <p className="text-muted-foreground mt-4 max-w-2xl text-lg text-pretty">
          {t('site.tagline')}
        </p>

        <div className="mt-8">
          <FacilitySearchForm />
        </div>
      </section>

      <section aria-labelledby="how-heading" className="border-t">
        <div className="mx-auto w-full max-w-6xl px-4 py-12">
          <h2 id="how-heading" className="text-2xl font-semibold tracking-tight">
            {t('home.howHeading')}
          </h2>
          <ol className="mt-6 grid gap-6 sm:grid-cols-3">
            {STEPS.map((step, i) => (
              <li key={step.title}>
                <p className="text-muted-foreground text-sm font-medium">
                  {t('home.step')} {i + 1}
                </p>
                <h3 className="mt-1 text-lg font-medium">{t(step.title)}</h3>
                <p className="text-muted-foreground mt-1 text-pretty">{t(step.body)}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section aria-labelledby="help-heading" className="border-t">
        <div className="mx-auto w-full max-w-6xl px-4 py-12">
          <h2 id="help-heading" className="text-2xl font-semibold tracking-tight">
            {t('home.helpHeading')}
          </h2>
          <p className="text-muted-foreground mt-2 max-w-2xl text-pretty">
            {t('home.helpBodyBefore')}{' '}
            <a href={`tel:${SITE.phone.href}`} className="underline underline-offset-4">
              {SITE.phone.display}
            </a>{' '}
            {t('home.helpBodyMiddle')}{' '}
            {/* The size guide, not the FAQ: this paragraph is about choosing a
                size, and the page that answers that question is the one that
                lists them with what fits in each. Sending a size question to a
                general FAQ makes the reader do the routing. */}
            <Link href="/storage/size-guide" className="underline underline-offset-4">
              {t('home.helpSizeGuideLink')}
            </Link>
            .
          </p>
        </div>
      </section>
    </>
  )
}
