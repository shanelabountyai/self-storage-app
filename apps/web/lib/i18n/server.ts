import { cookies } from 'next/headers'
import { DEFAULT_LOCALE, isLocale, LOCALE_COOKIE, type Locale } from './index'

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
