import { ProsePage, Section, metadataFor } from '@/components/site/prose-page'
import { dictionaryFor, translate, type MessageKey } from '@/lib/i18n'
import { getLocale } from '@/lib/i18n/server'

// B-262. The metadata stays an English literal: it is what a crawler reads,
// and D-122 keeps the crawler on English. Only the rendered page follows the
// locale cookie.
export const metadata = metadataFor('About', 'What this project is.')

export default async function AboutPage() {
  const dict = dictionaryFor(await getLocale())
  const t = (key: MessageKey) => translate(dict, key)

  return (
    <ProsePage title={t('about.title')} intro={t('about.intro')}>
      <Section heading={t('about.what.heading')}>
        <p>{t('about.what.body')}</p>
      </Section>

      <Section heading={t('about.site.heading')}>
        <p>{t('about.site.body')}</p>
      </Section>
    </ProsePage>
  )
}
