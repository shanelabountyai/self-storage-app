import { ProsePage, Section, metadataFor } from '@/components/site/prose-page'
import { dictionaryFor, translate, type MessageKey } from '@/lib/i18n'
import { getLocale } from '@/lib/i18n/server'

// B-291 (D-134). `<title>` follows the locale cookie, because it is also the
// page name a screen reader announces first. It reuses the `<h1>` key, whose
// English is the title this page always had. The description stays an English
// literal: it is what a crawler reads, and D-122 keeps the crawler on English.
export async function generateMetadata() {
  return metadataFor(translate(dictionaryFor(await getLocale()), 'about.title'), 'What this project is.')
}

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
