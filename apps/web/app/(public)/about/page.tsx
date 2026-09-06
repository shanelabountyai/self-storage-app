import { ProsePage, Section } from '@/components/site/prose-page'
import { dictionaryFor, translate, type MessageKey } from '@/lib/i18n'
import { getLocale } from '@/lib/i18n/server'

// B-262. `generateMetadata` rather than a static `metadata` object, so the tab
// title follows the language the page is actually in — the same shape B-090
// part 6 used on search and checkout. The URL does not move: one page in two
// languages, which is the whole point of the cookie strategy (D-122).
export async function generateMetadata() {
  const dict = dictionaryFor(await getLocale())
  return {
    title: translate(dict, 'about.title'),
    description: translate(dict, 'about.metaDescription'),
  }
}

export default async function AboutPage() {
  const dict = dictionaryFor(await getLocale())
  const t = (key: MessageKey) => translate(dict, key)

  return (
    <ProsePage title={t('about.title')} intro={t('about.intro')}>
      <Section heading={t('about.whatWeAre')}>
        <p>{t('about.whatWeAreBody')}</p>
      </Section>

      <Section heading={t('about.aboutSite')}>
        <p>{t('about.aboutSiteBody')}</p>
      </Section>
    </ProsePage>
  )
}
