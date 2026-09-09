import { ProsePage, Section, metadataFor } from '@/components/site/prose-page'
import { SITE } from '@/lib/site-config'
import { dictionaryFor, translate, type MessageKey } from '@/lib/i18n'
import { getLocale } from '@/lib/i18n/server'

// B-262. Metadata stays English — see the note on `/about`.
export const metadata = metadataFor(
  'Frequently asked questions',
  'How reservations, move-ins, gate access, and billing work.',
)

/// The rough size guide, as message keys. What stays here is the order and the
/// fact that there are three of them; the copy is in the dictionaries. The
/// dimensions are in the TERM rather than in the markup because Spanish says
/// "5 por 5 pies", not "5 by 5 feet".
const SIZES = [
  { term: 'faq.size.5x5.term', body: 'faq.size.5x5.body' },
  { term: 'faq.size.10x10.term', body: 'faq.size.10x10.body' },
  { term: 'faq.size.10x20.term', body: 'faq.size.10x20.body' },
] as const satisfies readonly { term: MessageKey; body: MessageKey }[]

export default async function FaqPage() {
  const locale = await getLocale()
  const dict = dictionaryFor(locale)
  const t = (key: MessageKey) => translate(dict, key)

  return (
    <ProsePage lang={locale} title={t('faq.title')} intro={t('faq.intro')}>
      <Section heading={t('faq.reserve.q')}>
        <p>{t('faq.reserve.a')}</p>
      </Section>

      <Section heading={t('faq.online.q')}>
        <p>{t('faq.online.a')}</p>
      </Section>

      <Section heading={t('faq.term.q')}>
        <p>{t('faq.term.a')}</p>
      </Section>

      <Section heading={t('faq.price.q')}>
        <p>{t('faq.price.a')}</p>
      </Section>

      {/* The question the size-help links on the search and facility pages point
          at. Until B-017 ships the real size guide with diagrams, this is the
          answer they land on — pointing someone at a page that ignored their
          question was worse than not linking. */}
      <Section heading={t('faq.size.q')}>
        <p>{t('faq.size.intro')}</p>
        <ul className="list-disc space-y-1 pl-5">
          {SIZES.map((size) => (
            <li key={size.term}>
              <strong>{t(size.term)}</strong> — {t(size.body)}
            </li>
          ))}
        </ul>
        <p>{t('faq.size.tail')}</p>
      </Section>

      <Section heading={t('faq.hours.q')}>
        <p>{t('faq.hours.a')}</p>
      </Section>

      <Section heading={t('faq.else.q')}>
        <p>
          {t('faq.else.call')}{' '}
          <a href={`tel:${SITE.phone.href}`} className="underline underline-offset-4">
            {SITE.phone.display}
          </a>{' '}
          {t('chrome.orEmail')}{' '}
          <a href={`mailto:${SITE.supportEmail}`} className="underline underline-offset-4">
            {SITE.supportEmail}
          </a>
          .
        </p>
      </Section>
    </ProsePage>
  )
}
