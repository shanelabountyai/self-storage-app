import { Fragment } from 'react'
import Link from 'next/link'
import {
  SMS_CONFIRM_KEYWORD,
  SMS_HELP_KEYWORD,
  SMS_OPT_IN_KEYWORD,
  SMS_START_KEYWORDS,
  SMS_STOP_KEYWORDS,
} from '@storage/core/comms'
import { SITE } from '@/lib/site-config'
import { dictionaryFor, translate, type MessageKey } from '@/lib/i18n'
import { getLocale } from '@/lib/i18n/server'

// PRD 05 CN-14 / §6.4. The public disclosure page a carrier and an A2P 10DLC
// campaign review expect to find, and the page the portal's consent control
// points at.
//
// EVERY CLAIM HERE IS TRUE OF THE BUILD, and that is the whole point of writing
// it from the code rather than from a template:
//
//   - the keyword sets are `packages/core/comms/sms-keywords.ts`
//   - the quiet-hours window is `Facility.smsQuietHoursStartHour/EndHour`
//     (8/21 by default) and applies to EVERY message, not only marketing
//   - consent is a `Consent` row with a timestamp, a source and a disclosure
//     version, shown back to the tenant at /portal/notifications
//
// A page that promises something the system does not do is worse than no page:
// it is the document a regulator reads when somebody complains.
//
// B-262 translated it, and made the first of those three claims true. The stop
// and resume keywords were RETYPED here as literal JSX under that comment, so
// adding one to `sms-keywords.ts` would have left this page naming five of six
// while still claiming to come from the code. They are imported now.
//
// The keywords themselves are never translated: a carrier matches STOP, not
// PARE. They are substituted into the sentences as variables and stay English
// in both dictionaries.

/// Month and year, formatted in the reader's language.
///
/// A `'August 2026'` string constant would have rendered English inside the
/// Spanish page, and a `${month} ${year}` template is wrong in Spanish however
/// the month is spelled — Spanish puts "de" between them. Same reasoning, and
/// the same `Intl` call, as `statementLabel` (B-260). Built at UTC midnight
/// and formatted in UTC so no timezone can walk it back a day into July.
const LAST_REVIEWED = { year: 2026, month: 8 }

function reviewedOn(locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: 'UTC',
    month: 'long',
    year: 'numeric',
  }).format(new Date(Date.UTC(LAST_REVIEWED.year, LAST_REVIEWED.month - 1, 1)))
}

/// The keyword list, each word emphasised, joined the way the reader's own
/// language joins a list. Bold per keyword rather than around the whole run:
/// this page is scanned for "what do I text", and the conjunction is not one
/// of the things to text.
function KeywordList({ words, conjunction }: { words: readonly string[]; conjunction: string }) {
  return (
    <>
      {words.map((word, i) => (
        <Fragment key={word}>
          {i > 0 && (i === words.length - 1 ? ` ${conjunction} ` : ', ')}
          <strong>{word}</strong>
        </Fragment>
      ))}
    </>
  )
}

export async function generateMetadata() {
  const dict = dictionaryFor(await getLocale())
  return {
    title: translate(dict, 'msg.title'),
    description: translate(dict, 'msg.metaDescription'),
  }
}

export default async function MessagingPolicyPage() {
  const locale = await getLocale()
  const dict = dictionaryFor(locale)
  const t = (key: MessageKey, vars?: Record<string, string | number>) =>
    translate(dict, key, vars)

  // The portal's own nav label, so the section this page sends people to is
  // named here exactly as it is named there — "Notifications" in English,
  // "Avisos" in Spanish — and renaming it there renames it here.
  const section = t('portal.notifications')
  const stop = SMS_STOP_KEYWORDS[0]

  return (
    // B-262. A `<div>`, not a `<main>`. This page rendered its own `<main>`
    // INSIDE the public layout's `<main id="main">` — two main landmarks in
    // one document, which is one more than a screen-reader user can navigate
    // to meaningfully, and it is the only page in the public tree that did it.
    // The axe sweep never saw it: `landmark-no-duplicate-main` is an
    // axe-core BEST-PRACTICE rule, and `assertNoAxeViolations` runs
    // `wcag2a/wcag2aa/wcag21a/wcag21aa` only. A Playwright strict-mode
    // violation on `locator('main')` is what actually found it, while asserting
    // something else entirely.
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-12">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">{t('msg.title')}</h1>
        <p className="text-muted-foreground text-sm">
          {t('msg.reviewedLine', { name: SITE.name, date: reviewedOn(locale) })}
        </p>
      </header>

      <p className="text-pretty">{t('msg.intro', { name: SITE.name })}</p>

      <section aria-labelledby="consent" className="flex flex-col gap-3">
        <h2 id="consent" className="text-lg font-medium">
          {t('msg.consentHeading')}
        </h2>
        <p className="text-pretty">{t('msg.consentNever')}</p>
        <p className="text-pretty">
          <strong>
            {t('msg.consentKeyword', {
              optIn: SMS_OPT_IN_KEYWORD,
              number: SITE.smsNumber.display,
              confirm: SMS_CONFIRM_KEYWORD,
            })}
          </strong>{' '}
          {t('msg.consentKeywordBody', { confirm: SMS_CONFIRM_KEYWORD })}
        </p>
        <p className="text-pretty">{t('msg.consentUnknown')}</p>
        <p className="text-pretty">
          {t('msg.consentSelfServeBefore')} <strong>{section}</strong>{' '}
          {t('msg.consentSelfServeAfter')}
        </p>
        <p className="text-pretty">{t('msg.consentRecord', { section })}</p>
        <p className="text-pretty">
          <strong>{t('msg.consentNotCondition')}</strong> {t('msg.consentNotConditionBody')}
        </p>
      </section>

      <section aria-labelledby="what" className="flex flex-col gap-3">
        <h2 id="what" className="text-lg font-medium">
          {t('msg.whatHeading')}
        </h2>
        <ul className="flex list-disc flex-col gap-2 pl-5">
          <li>
            <strong>{t('msg.whatAccountLabel')}</strong> — {t('msg.whatAccountBody')}
          </li>
          <li>
            <strong>{t('msg.whatOffersLabel')}</strong>, {t('msg.whatOffersBody')}
          </li>
        </ul>
        <p className="text-pretty">
          <strong>{t('msg.frequencyLead')}</strong> {t('msg.frequencyBody')}
        </p>
      </section>

      <section aria-labelledby="stop" className="flex flex-col gap-3">
        <h2 id="stop" className="text-lg font-medium">
          {t('msg.stopHeading')}
        </h2>
        <p className="text-pretty">
          {t('msg.stopReplyBefore')} <strong>{stop}</strong> {t('msg.stopReplyAfter')}{' '}
          <KeywordList words={SMS_STOP_KEYWORDS.slice(1)} conjunction={t('common.and')} />.{' '}
          {t('msg.stopConfirm')}
        </p>
        <p className="text-pretty">
          {t('msg.stopAllBefore')} <em>{t('msg.stopAllEm')}</em> {t('msg.stopAllAfter')}
        </p>
        {/* B-123 / D-51. The marketing-only switch now exists, so the page has
            to say so: telling somebody their only option is STOP, when STOP
            also costs them their gate code, pushes them into giving up more
            than they meant to. */}
        <p className="text-pretty">
          <strong>{t('msg.marketingOnlyLead')}</strong>
          {t('msg.marketingOnlyBefore', { stop })} <strong>{section}</strong>{' '}
          {t('msg.marketingOnlyAfter')}
        </p>
        <p className="text-pretty">
          {t('msg.restartBefore')}{' '}
          <KeywordList words={SMS_START_KEYWORDS} conjunction={t('common.or')} />
          {t('msg.restartAfter', { section })} <strong>{SMS_HELP_KEYWORD}</strong>{' '}
          {t('msg.restartHelpAfter')}
        </p>
        <p className="text-pretty">
          {t('msg.stopSelfServeBefore')} <strong>{section}</strong>{' '}
          {t('msg.stopSelfServeAfter', { stop })}
        </p>
      </section>

      <section aria-labelledby="hours" className="flex flex-col gap-3">
        <h2 id="hours" className="text-lg font-medium">
          {t('msg.hoursHeading')}
        </h2>
        <p className="text-pretty">
          {t('msg.hoursBefore')} <strong>{t('msg.hoursWindow')}</strong> {t('msg.hoursAfter')}
        </p>
      </section>

      <section aria-labelledby="cost" className="flex flex-col gap-3">
        <h2 id="cost" className="text-lg font-medium">
          {t('msg.costHeading')}
        </h2>
        <p className="text-pretty">
          <strong>{t('msg.costLead')}</strong> {t('msg.costBody')}
        </p>
      </section>

      <section aria-labelledby="privacy" className="flex flex-col gap-3">
        <h2 id="privacy" className="text-lg font-medium">
          {t('msg.privacyHeading')}
        </h2>
        <p className="text-pretty">
          {t('msg.privacyBefore')}{' '}
          <Link href="/privacy" className="underline underline-offset-4">
            {t('msg.privacyLink')}
          </Link>{' '}
          {t('msg.privacyMiddle')}{' '}
          <Link href="/terms" className="underline underline-offset-4">
            {t('msg.termsLink')}
          </Link>{' '}
          {t('msg.privacyAfter')}
        </p>
      </section>
    </div>
  )
}
