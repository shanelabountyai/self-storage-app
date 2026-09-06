import { ProsePage, Section } from '@/components/site/prose-page'
import { SITE } from '@/lib/site-config'
import { dictionaryFor, translate, type MessageKey } from '@/lib/i18n'
import { getLocale } from '@/lib/i18n/server'
import { localeAlternates } from '@/lib/marketing/alternates'

export async function generateMetadata() {
  const locale = await getLocale()
  const dict = dictionaryFor(locale)
  return {
    title: translate(dict, 'contact.title'),
    description: translate(dict, 'contact.meta'),
    alternates: localeAlternates(locale, '/contact'),
  }
}

export default async function ContactPage() {
  const dict = dictionaryFor(await getLocale())
  const t = (key: MessageKey) => translate(dict, key)

  return (
    <ProsePage title={t('contact.title')} intro={t('contact.intro')}>
      <Section heading={t('contact.phoneHeading')}>
        <p>
          <a href={`tel:${SITE.phone.href}`} className="text-lg underline underline-offset-4">
            {SITE.phone.display}
          </a>
        </p>
      </Section>

      <Section heading={t('contact.emailHeading')}>
        <p>
          <a href={`mailto:${SITE.supportEmail}`} className="underline underline-offset-4">
            {SITE.supportEmail}
          </a>
        </p>
      </Section>

      <Section heading={t('contact.facilityHeading')}>
        <p>{t('contact.facilityBody')}</p>
      </Section>
    </ProsePage>
  )
}
