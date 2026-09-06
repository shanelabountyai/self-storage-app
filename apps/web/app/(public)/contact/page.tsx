import { ProsePage, Section, metadataFor } from '@/components/site/prose-page'
import { SITE } from '@/lib/site-config'
import { dictionaryFor, translate, type MessageKey } from '@/lib/i18n'
import { getLocale } from '@/lib/i18n/server'

// B-262. Metadata stays English — see the note on `/about`.
export const metadata = metadataFor('Contact', 'How to reach us.')

export default async function ContactPage() {
  const dict = dictionaryFor(await getLocale())
  const t = (key: MessageKey) => translate(dict, key)

  return (
    <ProsePage title={t('contact.title')} intro={t('contact.intro')}>
      <Section heading={t('contact.phone')}>
        <p>
          <a href={`tel:${SITE.phone.href}`} className="text-lg underline underline-offset-4">
            {SITE.phone.display}
          </a>
        </p>
      </Section>

      <Section heading={t('contact.email')}>
        <p>
          <a href={`mailto:${SITE.supportEmail}`} className="underline underline-offset-4">
            {SITE.supportEmail}
          </a>
        </p>
      </Section>

      <Section heading={t('contact.facility.heading')}>
        <p>{t('contact.facility.body')}</p>
      </Section>
    </ProsePage>
  )
}
