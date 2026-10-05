import { DocumentTitle } from '@/components/site/error-panel'
import { FacilitySearchForm } from '@/components/site/facility-search-form'
import { dictionaryFor, translate } from '@/lib/i18n'
import { requestLinkLocale } from '@/lib/i18n/link-locale'
import { SITE } from '@/lib/site-config'

// B-435 (PRD 01 §6.7). A dead link ends at the two things that still work:
// the search and the phone. `app/not-found.tsx` renders this for a URL that
// matches no route at all.
export default async function PublicNotFound() {
  const dict = dictionaryFor(await requestLinkLocale())
  const title = translate(dict, 'errorPage.notFoundTitle')

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-12">
      <DocumentTitle title={title} />
      <h1 className="text-3xl font-semibold tracking-tight text-balance">{title}</h1>
      <p className="mt-3 mb-6 text-lg text-pretty">{translate(dict, 'errorPage.notFoundBody')}</p>
      <FacilitySearchForm />
      <p className="mt-6">
        {translate(dict, 'chrome.callUsAt')}
        <a
          href={`tel:${SITE.phone.href}`}
          className="inline-flex min-h-11 items-center underline underline-offset-4"
        >
          {SITE.phone.display}
        </a>
      </p>
    </div>
  )
}
