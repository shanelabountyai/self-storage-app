import { ProsePage, Section } from '@/components/site/prose-page'
import { SITE } from '@/lib/site-config'
import { dictionaryFor, translate, type MessageKey } from '@/lib/i18n'
import { getLocale } from '@/lib/i18n/server'

export async function generateMetadata() {
  const dict = dictionaryFor(await getLocale())
  return {
    title: translate(dict, 'faq.title'),
    description: translate(dict, 'faq.metaDescription'),
  }
}

/// The three size bands, as message keys. The copy is in the dictionaries;
/// what stays here is that there are three of them and the order they run in.
const SIZES = [
  { label: 'faq.size5Label', body: 'faq.size5Body' },
  { label: 'faq.size10Label', body: 'faq.size10Body' },
  { label: 'faq.size20Label', body: 'faq.size20Body' },
] as const satisfies readonly { label: MessageKey; body: MessageKey }[]

export default async function FaqPage() {
  const dict = dictionaryFor(await getLocale())
  const t = (key: MessageKey) => translate(dict, key)

  return (
    <ProsePage title={t('faq.title')} intro={t('faq.intro')}>
      <Section heading={t('faq.reserveQ')}>
        <p>{t('faq.reserveA')}</p>
      </Section>

      <Section heading={t('faq.onlineQ')}>
        <p>{t('faq.onlineA')}</p>
      </Section>

      <Section heading={t('faq.contractQ')}>
        <p>{t('faq.contractA')}</p>
      </Section>

      <Section heading={t('faq.priceQ')}>
        <p>{t('faq.priceA')}</p>
      </Section>

      {/* The question the size-help links on the search and facility pages point
          at. Until B-017 ships the real size guide with diagrams, this is the
          answer they land on — pointing someone at a page that ignored their
          question was worse than not linking. */}
      <Section heading={t('faq.sizeQ')}>
        <p>{t('faq.sizeIntro')}</p>
        <ul className="list-disc space-y-1 pl-5">
          {SIZES.map((size) => (
            <li key={size.label}>
              <strong>{t(size.label)}</strong> — {t(size.body)}
            </li>
          ))}
        </ul>
        <p>{t('faq.sizeBetween')}</p>
      </Section>

      <Section heading={t('faq.accessQ')}>
        <p>{t('faq.accessA')}</p>
      </Section>

      <Section heading={t('faq.elseQ')}>
        <p>
          {t('faq.elseCall')}{' '}
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
