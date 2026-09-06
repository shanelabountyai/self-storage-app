import { ProsePage, Section } from '@/components/site/prose-page'
import { dictionaryFor, translate, type MessageKey } from '@/lib/i18n'
import { getLocale } from '@/lib/i18n/server'
import { localeAlternates } from '@/lib/marketing/alternates'

// B-262: `generateMetadata` rather than a static `metadata`, so the tab title
// follows the language the page is in and the page declares its own canonical
// alongside its Spanish twin.
export async function generateMetadata() {
  const locale = await getLocale()
  const dict = dictionaryFor(locale)
  return {
    title: translate(dict, 'about.title'),
    description: translate(dict, 'about.meta'),
    alternates: localeAlternates(locale, '/about'),
  }
}

export default async function AboutPage() {
  const dict = dictionaryFor(await getLocale())
  const t = (key: MessageKey) => translate(dict, key)

  return (
    <ProsePage title={t('about.title')} intro={t('about.intro')}>
      <Section heading={t('about.whatHeading')}>
        <p>{t('about.whatBody')}</p>
      </Section>

      <Section heading={t('about.siteHeading')}>
        <p>{t('about.siteBody')}</p>
      </Section>
    </ProsePage>
  )
}
