import type { Metadata } from 'next'
import Link from 'next/link'
import {
  PUBLISHED_HELP_KEYWORDS,
  PUBLISHED_START_KEYWORDS,
  PUBLISHED_STOP_KEYWORDS,
  SMS_CONFIRM_KEYWORD,
  SMS_OPT_IN_KEYWORD,
} from '@storage/core/comms'
import { SITE } from '@/lib/site-config'
import { dictionaryFor, translate, type Locale, type MessageKey } from '@/lib/i18n'
import { getLocale } from '@/lib/i18n/server'

// D-122 keeps `metadata` an English literal on every translated page: it is
// what a crawler reads, and the crawler carries no locale cookie. The <h1>
// below is the translated title.
export const metadata: Metadata = {
  title: 'Text message policy',
  description:
    'How we use text messages: what we send, how you agree to receive them, how to stop them, and what they cost.',
}

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
//   - consent is a `Consent` row with a timestamp, a source, a disclosure
//     version and (B-259) the language that disclosure was shown in, all of it
//     shown back to the tenant at /portal/notifications
//
// A page that promises something the system does not do is worse than no page:
// it is the document a regulator reads when somebody complains.
//
// ── B-259 (D-124, D-125): Spanish ────────────────────────────────────────────
//
// B-262 called this page ordinary prose and moved it here instead of
// translating it, because it EXPLAINS the consent that checkout records under
// a version constant — and translating the explanation while the disclosure it
// describes was still English-only would have described a page that did not
// exist. The disclosures are translated now (`lib/consent/disclosures.ts`), so
// this page can be, and the paragraph about what we record says the language
// is part of the record because it now is.
//
// TWO THINGS STAY ENGLISH IN BOTH LANGUAGES, for different reasons:
//
//   * The KEYWORDS. STOP, HELP, START and the rest are not words, they are the
//     literal strings `classifySmsKeyword` matches and a carrier's own opt-out
//     handling matches. A translated keyword is an instruction that does
//     nothing. They are rendered from the sets themselves rather than retyped,
//     so the published list cannot drift from the code — which it could have
//     before this item, since it was prose.
//   * `/terms` and `/privacy`, linked at the bottom. D-122 keeps anything a
//     lawyer wrote in one language, and the Spanish footer says so.

/// Month precision, deliberately: this is a legal review date and the review
/// was a month, not a day. Stored as an ISO prefix and formatted by `Intl` per
/// locale rather than written as English prose ('August 2026'), which cannot be
/// rendered in a second language at all — the defect B-262 found on
/// `/accessibility`. The `T00:00:00Z` plus `timeZone: 'UTC'` keeps it off
/// B-228's UTC-midnight-shifts-a-day class by construction.
///
/// NOT bumped by this item. Translating the page and correcting what it says
/// about the consent record is a claim re-checked against the build; it is not
/// the legal re-read that this date names.
const LAST_REVIEWED_MONTH = '2026-08'

function reviewedOn(locale: Locale): string {
  return new Intl.DateTimeFormat(locale === 'es' ? 'es' : 'en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${LAST_REVIEWED_MONTH}-01T00:00:00Z`))
}

/// "STOPALL, UNSUBSCRIBE, CANCEL, END and QUIT" in English, and the same list
/// with "y" in Spanish. `Intl.ListFormat` is the platform's own answer and
/// knows the Spanish "e" before an i- sound; a hand-rolled join does not.
///
/// The two lists want different conjunctions and it is not decoration: the
/// stop keywords are things we ACCEPT (all of them, "and"), while the resume
/// keywords are alternatives (either one works, "or"). Getting that backwards
/// would tell somebody to send two messages to switch their texts back on.
function listOf(
  locale: Locale,
  items: readonly string[],
  type: 'conjunction' | 'disjunction',
): string {
  return new Intl.ListFormat(locale, { style: 'long', type }).format(items)
}

export default async function MessagingPolicyPage() {
  const locale = await getLocale()
  const dict = dictionaryFor(locale)
  const t = (key: MessageKey, vars?: Record<string, string | number>) =>
    translate(dict, key, vars)

  const stop = PUBLISHED_STOP_KEYWORDS[0]
  const otherStopKeywords = listOf(locale, PUBLISHED_STOP_KEYWORDS.slice(1), 'conjunction')
  const startKeywords = listOf(locale, [...PUBLISHED_START_KEYWORDS], 'disjunction')
  const help = PUBLISHED_HELP_KEYWORDS[0]

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-12">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">{t('msgpol.title')}</h1>
        <p className="text-muted-foreground text-sm">
          {t('msgpol.reviewed', { name: SITE.name, date: reviewedOn(locale) })}
        </p>
      </header>

      <p className="text-pretty">{t('msgpol.intro', { name: SITE.name })}</p>

      <section aria-labelledby="consent" className="flex flex-col gap-3">
        <h2 id="consent" className="text-lg font-medium">
          {t('msgpol.consent.heading')}
        </h2>
        <p className="text-pretty">{t('msgpol.consent.never')}</p>
        <p className="text-pretty">
          <strong>
            {t('msgpol.consent.optInLead', {
              join: SMS_OPT_IN_KEYWORD,
              number: SITE.smsNumber.display,
              yes: SMS_CONFIRM_KEYWORD,
            })}
          </strong>{' '}
          {t('msgpol.consent.optInBody', { yes: SMS_CONFIRM_KEYWORD })}
        </p>
        <p className="text-pretty">{t('msgpol.consent.unknownNumber')}</p>
        <p className="text-pretty">{t('msgpol.consent.selfServe')}</p>
        {/* B-259: "the exact version of the wording you agreed to" was true and
            incomplete the moment a second language existed. The row carries the
            language too, and this page is where we say so. */}
        <p className="text-pretty">{t('msgpol.consent.record')}</p>
        <p className="text-pretty">
          <strong>{t('msgpol.consent.notConditionLead')}</strong>{' '}
          {t('msgpol.consent.notConditionBody')}
        </p>
      </section>

      <section aria-labelledby="what" className="flex flex-col gap-3">
        <h2 id="what" className="text-lg font-medium">
          {t('msgpol.what.heading')}
        </h2>
        <ul className="flex list-disc flex-col gap-2 pl-5">
          <li>
            <strong>{t('msgpol.what.accountTerm')}</strong> — {t('msgpol.what.accountBody')}
          </li>
          <li>
            <strong>{t('msgpol.what.offersTerm')}</strong> — {t('msgpol.what.offersBody')}
          </li>
        </ul>
        <p className="text-pretty">
          <strong>{t('msgpol.what.frequencyLead')}</strong> {t('msgpol.what.frequencyBody')}
        </p>
      </section>

      <section aria-labelledby="stop" className="flex flex-col gap-3">
        <h2 id="stop" className="text-lg font-medium">
          {t('msgpol.stop.heading')}
        </h2>
        <p className="text-pretty">
          {t('msgpol.stop.reply', { stop, others: otherStopKeywords })}
        </p>
        <p className="text-pretty">{t('msgpol.stop.stopsAll')}</p>
        {/* B-123 / D-51. The marketing-only switch now exists, so the page has
            to say so: telling somebody their only option is STOP, when STOP
            also costs them their gate code, pushes them into giving up more
            than they meant to. */}
        <p className="text-pretty">
          <strong>{t('msgpol.stop.offersOnlyLead')}</strong>{' '}
          {t('msgpol.stop.offersOnlyBody', { stop })}
        </p>
        <p className="text-pretty">
          {t('msgpol.stop.restart', { start: startKeywords, help })}
        </p>
        <p className="text-pretty">{t('msgpol.stop.portal', { stop })}</p>
      </section>

      <section aria-labelledby="hours" className="flex flex-col gap-3">
        <h2 id="hours" className="text-lg font-medium">
          {t('msgpol.hours.heading')}
        </h2>
        <p className="text-pretty">{t('msgpol.hours.body')}</p>
      </section>

      <section aria-labelledby="cost" className="flex flex-col gap-3">
        <h2 id="cost" className="text-lg font-medium">
          {t('msgpol.cost.heading')}
        </h2>
        <p className="text-pretty">
          <strong>{t('msgpol.cost.lead')}</strong> {t('msgpol.cost.body')}
        </p>
      </section>

      <section aria-labelledby="privacy" className="flex flex-col gap-3">
        <h2 id="privacy" className="text-lg font-medium">
          {t('msgpol.privacy.heading')}
        </h2>
        <p className="text-pretty">{t('msgpol.privacy.body')}</p>
        {/* One link per sentence, each at the front. The English original ran
            both links through the middle of one sentence, which cannot be
            translated without splitting it at a word order Spanish does not
            use. */}
        <p className="text-pretty">
          <Link href="/privacy" className="underline underline-offset-4">
            {t('msgpol.privacy.privacyLink')}
          </Link>{' '}
          {t('msgpol.privacy.privacyTail')}
        </p>
        <p className="text-pretty">
          <Link href="/terms" className="underline underline-offset-4">
            {t('msgpol.privacy.termsLink')}
          </Link>{' '}
          {t('msgpol.privacy.termsTail')}
        </p>
      </section>
    </main>
  )
}
