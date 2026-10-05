import { dictionaryFor, translate } from '@/lib/i18n'
import { requestLinkLocale } from '@/lib/i18n/link-locale'
import PublicLayout from './(public)/layout'
import PublicNotFound from './(public)/not-found'

// B-435. A URL that matches no route renders here, under the root layout
// alone, so the public shell is put back around the public page.
// Only the root not-found file's metadata is read; under a segment the title
// belongs to the page that called `notFound()`, and `DocumentTitle` sets it.
export async function generateMetadata() {
  return { title: translate(dictionaryFor(await requestLinkLocale()), 'errorPage.notFoundTitle') }
}

export default function NotFound() {
  return (
    <PublicLayout>
      <PublicNotFound />
    </PublicLayout>
  )
}
