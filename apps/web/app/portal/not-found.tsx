import Link from 'next/link'
import { DocumentTitle } from '@/components/site/error-panel'
import { dictionaryFor, translate } from '@/lib/i18n'
import { getLocale } from '@/lib/i18n/server'

// B-435 (PRD 01 §6.7).
export default async function PortalNotFound() {
  const dict = dictionaryFor(await getLocale())
  const title = translate(dict, 'errorPage.notFoundTitle')

  return (
    <div className="flex flex-col items-start gap-4">
      <DocumentTitle title={title} />
      <h1 className="text-xl font-semibold">{title}</h1>
      <Link href="/portal" className="inline-flex min-h-11 items-center underline underline-offset-4">
        {translate(dict, 'errorPage.backToAccount')}
      </Link>
    </div>
  )
}
