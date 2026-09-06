import { ProsePage, Section } from '@/components/site/prose-page'
import { SITE } from '@/lib/site-config'
import { dictionaryFor, translate, type MessageKey } from '@/lib/i18n'
import { getLocale } from '@/lib/i18n/server'
import { localeAlternates } from '@/lib/marketing/alternates'

export async function generateMetadata() {
  const locale = await getLocale()
  const dict = dictionaryFor(locale)
  return {
    title: translate(dict, 'faq.title'),
    description: translate(dict, 'faq.meta'),
    alternates: localeAlternates(locale, '/faq'),
  }
}

/// The three sizes the answer below names, as keys.
///
/// B-262: the list lives here and the words live in the dictionaries, the same
/// split the homepage's three steps use. What stays in the page is the fact
/// that there are three of them and the order they are in — smallest first,
/// which is what makes the closing "take the larger one" advice legible.
const SIZES = [
  { label: 'faq.size5x5Label', body: 'faq.size5x5Body' },
  { label: 'faq.size10x10Label', body: 'faq.size10x10Body' },
  { label: 'faq.size10x20Label', body: 'faq.size10x20Body' },
] as const satisfies readonly { label: MessageKey; body: MessageKey }[]

export default async function FaqPage() {
  const dict = dictionaryFor(await getLocale())
  const t = (key: MessageKey) => translate(dict, key)

  return (
    <ProsePage title={t('faq.title')} intro={t('faq.intro')}>
      <Section heading={t('faq.reserveHeading')}>
        <p>{t('faq.reserveBody')}</p>
      </Section>

      <Section heading={t('faq.onlineHeading')}>
        <p>{t('faq.onlineBody')}</p>
      </Section>

      <Section heading={t('faq.termHeading')}>
        <p>{t('faq.termBody')}</p>
      </Section>

      <Section heading={t('faq.priceHeading')}>
        <p>{t('faq.priceBody')}</p>
      </Section>

      {/* The question the size-help links on the search and facility pages point
          at. Until B-017 ships the real size guide with diagrams, this is the
          answer they land on — pointing someone at a page that ignored their
          question was worse than not linking. */}
      <Section heading={t('faq.sizeHeading')}>
        <p>{t('faq.sizeIntro')}</p>
        <ul className="list-disc space-y-1 pl-5">
          {SIZES.map((size) => (
            <li key={size.label}>
              <strong>{t(size.label)}</strong> — {t(size.body)}
            </li>
          ))}
        </ul>
        <p>{t('faq.sizeAdvice')}</p>
      </Section>

      <Section heading={t('faq.hoursHeading')}>
        <p>{t('faq.hoursBody')}</p>
      </Section>

      <Section heading={t('faq.elseHeading')}>
        <p>
          {t('faq.elseCall')}{' '}
          <a href={`tel:${SITE.phone.href}`} className="underline underline-offset-4">
            {SITE.phone.display}
          </a>{' '}
          {t('faq.elseEmail')}{' '}
          <a href={`mailto:${SITE.supportEmail}`} className="underline underline-offset-4">
            {SITE.supportEmail}
          </a>
          .
        </p>
      </Section>
    </ProsePage>
  )
}
