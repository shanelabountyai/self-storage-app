import { headers } from 'next/headers'
import { DEFAULT_LOCALE, type Locale } from './index'
import { localeFromHeader, LOCALE_HEADER, LOCALE_PATH_HEADER } from './routing'

// B-090 part 6, rewritten by B-262 (D-123). The one part of the i18n module
// that needs a request.
//
// Split out of `index.ts` rather than living beside the dictionaries, and the
// build is what forced it: `index.ts` imports `translate`, which the client
// components need, so importing a server-only module there dragged it into the
// browser bundle and `next build` refused it — after `npm run typecheck` and
// 4,148 unit tests had all passed. Keeping the dictionaries and `translate`
// pure means one module both runtimes can hold, and this file for the half only
// the server can run.
//
// B-262 changed WHERE the locale comes from, not how it is read. It used to be
// the `st_locale` cookie; it is now the `/es` prefix on the URL, resolved once
// in `proxy.ts` and handed down as a request header. The cookie is gone rather
// than kept as a fallback, and that is the point: a cookie that disagreed with
// the path would put a Spanish page at an English URL, which is the divergence
// the whole decision exists to end.

/// The locale for this request. Anything unrecognised — a hand-set header, a
/// path the proxy did not stamp — falls back to English rather than throwing.
///
/// The `catch` is not defensive padding. `headers()` THROWS outright when there
/// is no request scope to read from, and several things call into this on
/// purpose from outside one: the unit suite invokes the checkout server actions
/// directly, and so would a script or a cron. Without this, adding a translated
/// message to an action broke six consent tests with "`headers` was called
/// outside a request scope" — a failure about the language mechanism, in tests
/// about TCPA consent records, which is the worst possible place to send
/// somebody looking. No request means no header, and no header already means
/// English, so the fallback is the same answer by a different route rather than
/// a swallowed error.
export async function getLocale(): Promise<Locale> {
  try {
    return localeFromHeader((await headers()).get(LOCALE_HEADER))
  } catch {
    return DEFAULT_LOCALE
  }
}

/// The current path with its locale prefix already removed.
///
/// What the language toggle needs to build the other locale's URL, and the
/// layout that renders it has no other way to learn the path it is on. Falls
/// back to `/` for the same reason as above: a toggle pointing at the homepage
/// is wrong, a toggle that throws takes the page down with it.
export async function getLocalePath(): Promise<string> {
  try {
    return (await headers()).get(LOCALE_PATH_HEADER) || '/'
  } catch {
    return '/'
  }
}
