import { ProsePage, Section, metadataFor } from '@/components/site/prose-page'
import { SITE } from '@/lib/site-config'
import { dictionaryFor, translate, type MessageKey } from '@/lib/i18n'
import { getLocale } from '@/lib/i18n/server'
import { formatTimeOfDay } from '@/lib/facility/public-facility'
import { cachedHomeFacts, officeToday, sharedOfficeHours } from '@/lib/marketing/home-facts'

// B-291. `<title>` follows the reader; the description stays English — see the
// note on `/about`.
export async function generateMetadata() {
  return metadataFor(translate(dictionaryFor(await getLocale()), 'contact.title'), 'How to reach us.')
}

export default async function ContactPage() {
  const dict = dictionaryFor(await getLocale())
  const t = (key: MessageKey, vars?: Record<string, string | number>) => translate(dict, key, vars)
  // B-408: beside the phone number, not a claim about every facility — only
  // shown when every active one keeps the same hours (`sharedOfficeHours`).
  const shared = sharedOfficeHours((await cachedHomeFacts()).facilities)
  const hoursToday = shared && officeToday(shared.schedule, shared.timezone, new Date())

  return (
    <ProsePage title={t('contact.title')} intro={t('contact.intro')}>
      <Section heading={t('contact.phone')}>
        <p>
          <a href={`tel:${SITE.phone.href}`} className="text-lg underline underline-offset-4">
            {SITE.phone.display}
          </a>
          {hoursToday && (
            <span className="text-muted-foreground text-sm">
              {' · '}
              {hoursToday.hours.closed
                ? t('card.closedToday')
                : t('card.hoursToday', {
                    open: formatTimeOfDay(hoursToday.hours.open),
                    close: formatTimeOfDay(hoursToday.hours.close),
                  })}
            </span>
          )}
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
