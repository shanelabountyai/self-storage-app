import { cookies, headers } from 'next/headers'
import {
  acceptLanguageLocale,
  DEFAULT_LOCALE,
  dictionaryFor,
  isLocale,
  LOCALE_COOKIE,
  translate,
  type Dictionary,
  type Locale,
} from './index'
import type { Translator } from '@/lib/admin/form-state'

// B-090 part 6. The one part of the i18n module that needs a request.
//
// Split out of `index.ts` rather than living beside the dictionaries, and the
// build is what forced it: `index.ts` imports `translate`, which the client
// components need, so importing `next/headers` there dragged a server-only
// module into the browser bundle and `next build` refused it — after
// `npm run typecheck` and 4,148 unit tests had all passed. Keeping the
// dictionaries and `translate` pure means one module both runtimes can hold,
// and this file for the half only the server can run.

/// The locale for this request. Anything unrecognised — a stale cookie, a
/// hand-edited one — falls back to English rather than throwing: a bad cookie
/// must not be able to 500 a public page.
///
/// The `catch` is not defensive padding, and it is not about a malformed
/// cookie. `cookies()` THROWS outright when there is no request scope to read
/// one from, and several things call into this on purpose from outside one:
/// the unit suite invokes the checkout server actions directly, and so would a
/// script or a cron. Without this, adding a translated message to an action
/// broke six consent tests with "`cookies` was called outside a request
/// scope" — a failure about the language mechanism, in tests about TCPA
/// consent records, which is the worst possible place to send somebody
/// looking. No request means no cookie, and no cookie already means English,
/// so the fallback is the same answer by a different route rather than a
/// swallowed error.
export async function getLocale(): Promise<Locale> {
  try {
    const value = (await cookies()).get(LOCALE_COOKIE)?.value
    return isLocale(value) ? value : DEFAULT_LOCALE
  } catch {
    return DEFAULT_LOCALE
  }
}

/// B-290 (D-133). Whether this request gets the offer of Spanish: nobody has
/// chosen a language yet, and the browser would rather read Spanish than
/// English.
///
/// ANY `st_locale` cookie ends it, a stale one included. The offer sets the
/// cookie whichever way it is answered, so a cookie means the visitor was asked
/// or chose. Outside a request there is no offer, for the reason `getLocale`
/// gives.
export async function shouldOfferSpanish(): Promise<boolean> {
  try {
    if ((await cookies()).has(LOCALE_COOKIE)) return false
    return acceptLanguageLocale((await headers()).get('accept-language')) === 'es'
  } catch {
    return false
  }
}

/// The dictionary for THIS request, plus a `t` bound to it.
///
/// Resolved per call rather than once at module scope: a server action runs
/// inside a request, and a module-level dictionary would be whichever language
/// the first request after a cold start happened to use — served to everybody
/// afterwards.
///
/// Lived in the checkout action until B-264 gave it a second caller.
export async function messages(): Promise<{ dict: Dictionary; t: Translator }> {
  const dict = dictionaryFor(await getLocale())
  return { dict, t: (key, vars) => translate(dict, key, vars) }
}

/// B-265 (D-130). The language we WRITE to somebody in, for the sends that
/// compose their own words instead of resolving a template.
///
/// One rule, in one place, because the answer differs per recipient and the
/// wrong answer is a notice somebody cannot read:
///
///   1. what the tenant told us (`Tenant.preferredLocale`, or the language
///      stored on a waitlist entry) — durable, and the only source that
///      survives a send made from a cron;
///   2. failing that, the language of the request that caused the send — the
///      renter mid-checkout has no stored preference and is reading Spanish
///      right now, which is a better answer than English;
///   3. failing that, English.
///
/// `stated` is passed as the raw column value rather than a `Locale` so this
/// module needs no database import: the caller reads the row it already had,
/// and a value written before `LOCALES` gained an entry (or removed from it
/// since) falls to step 2 instead of becoming an undefined dictionary lookup.
///
/// Step 2 collapses into step 3 by itself when there is no request — `getLocale`
/// already answers English outside one — which is what makes the waitlist
/// sweep correct without a special case.
export async function writingLocale(stated: string | null | undefined): Promise<Locale> {
  return isLocale(stated) ? stated : getLocale()
}
