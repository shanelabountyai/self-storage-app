import Link from 'next/link'
import { ProsePage, Section, metadataFor } from '@/components/site/prose-page'
import { SITE } from '@/lib/site-config'
import { dictionaryFor, plural, translate, type MessageKey } from '@/lib/i18n'
import { getLocale } from '@/lib/i18n/server'
import { formatTimeOfDay } from '@/lib/facility/public-facility'
import {
  cachedHomeFacts,
  officeToday,
  sharedAccessSuspendDays,
  sharedMoveOutNoticeDays,
  sharedOfficeHours,
  sharedPaymentRetryDays,
} from '@/lib/marketing/home-facts'

// B-291. `<title>` follows the reader; the description stays English — see the
// note on `/about`.
export async function generateMetadata() {
  return metadataFor(
    translate(dictionaryFor(await getLocale()), 'faq.title'),
    'How reservations, move-ins, gate access, and billing work.',
  )
}

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
  const t = (key: MessageKey, vars?: Record<string, string | number>) => translate(dict, key, vars)
  const facts = await cachedHomeFacts()
  // B-408: beside the phone number, not a claim about every facility — only
  // shown when every active one keeps the same hours (`sharedOfficeHours`).
  const shared = sharedOfficeHours(facts.facilities)
  const hoursToday = shared && officeToday(shared.schedule, shared.timezone, new Date())

  // B-409: same "true of every active facility, or say nothing specific"
  // rule as the office-hours line — the FAQ has no one facility to read.
  const retryDays = sharedPaymentRetryDays(facts.facilities)
  const suspendDays = sharedAccessSuspendDays(facts.facilities)
  const retryDaysList =
    retryDays && retryDays.length > 0
      ? new Intl.ListFormat(locale, { type: 'conjunction' }).format(retryDays.map(String))
      : null
  const moveOutDays = sharedMoveOutNoticeDays(facts.facilities)

  return (
    <ProsePage title={t('faq.title')} intro={t('faq.intro')}>
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

      {/* B-409 (first-time-renter finding 7). Six more of the ~15 questions a
          first-timer actually has, each sourced from a fact the product
          already states rather than invented for the FAQ. Protection
          coverage and rate-change notice are owner questions, not built. */}
      <Section heading={t('faq.forbidden.q')}>
        <p>{t('faq.forbidden.a')}</p>
        <p className="text-muted-foreground text-sm">
          <strong>{t('faq.forbidden.caveat')}</strong>
        </p>
      </Section>

      <Section heading={t('faq.lock.q')}>
        <p>{t('faq.lock.a')}</p>
      </Section>

      <Section heading={t('faq.lostcode.q')}>
        <p>{t('faq.lostcode.a')}</p>
        <p>
          <Link href="/portal/access" className="underline underline-offset-4">
            {t('faq.lostcode.link')}
          </Link>{' '}
          {t('faq.lostcode.tail')}
        </p>
      </Section>

      <Section heading={t('faq.cardfail.q')}>
        {retryDaysList && suspendDays !== null ? (
          <>
            <p>{t('faq.cardfail.aRetry', { days: retryDaysList })}</p>
            <p>{plural(dict, suspendDays, 'faq.cardfail.suspendOne', 'faq.cardfail.suspendOther', { days: suspendDays })}</p>
          </>
        ) : (
          <p>{t('faq.cardfail.aGeneric')}</p>
        )}
        <p>
          <Link href="/portal/methods" className="underline underline-offset-4">
            {t('faq.cardfail.link')}
          </Link>{' '}
          {t('faq.cardfail.tail')}
        </p>
      </Section>

      <Section heading={t('faq.moveout.q')}>
        {moveOutDays === 0 ? (
          <p>{t('faq.moveout.aZero')}</p>
        ) : moveOutDays !== null ? (
          <p>{plural(dict, moveOutDays, 'faq.moveout.noticeOne', 'faq.moveout.noticeOther', { days: moveOutDays })}</p>
        ) : (
          <p>{t('faq.moveout.aGeneric')}</p>
        )}
        <p>
          <Link href="/portal/move-out" className="underline underline-offset-4">
            {t('faq.moveout.link')}
          </Link>{' '}
          {t('faq.moveout.tail')}
        </p>
      </Section>

      <Section heading={t('faq.transfer.q')}>
        <p>{t('faq.transfer.a')}</p>
        <p>
          <Link href="/portal/transfer" className="underline underline-offset-4">
            {t('faq.transfer.link')}
          </Link>{' '}
          {t('faq.transfer.tail')}
        </p>
      </Section>

      <Section heading={t('faq.else.q')}>
        <p>
          {t('faq.else.call')}{' '}
          <a href={`tel:${SITE.phone.href}`} className="underline underline-offset-4">
            {SITE.phone.display}
          </a>{' '}
          {hoursToday && (
            <>
              {' · '}
              {hoursToday.hours.closed
                ? t('card.closedToday')
                : t('card.hoursToday', {
                    open: formatTimeOfDay(hoursToday.hours.open),
                    close: formatTimeOfDay(hoursToday.hours.close),
                  })}{' '}
            </>
          )}
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
