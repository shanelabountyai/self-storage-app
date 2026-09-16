import { headers } from 'next/headers'
import { LocaleProvider } from '@/components/i18n/locale-provider'
import { LanguageToggle } from '@/components/site/language-toggle'
import { dictionaryFor, RESET_TOKEN_HEADER, translate } from '@/lib/i18n'
import { getLocale } from '@/lib/i18n/server'
import { resetLinkLocale } from '@/lib/auth/flows'

// B-311. The sign-in door: `/login`, `/forgot-password`, `/reset-password`,
// `/mfa`, `/reauth`, `/confirm-email`. All six sat directly under `app/`,
// outside `(public)` and outside `/portal`, so none of them inherited a
// `LocaleProvider`, a skip link, or the toggle — a Spanish-cookied visitor met
// `<html lang="es">` over entirely English content on the exact pages that sit
// in front of every money screen this app has (SC 3.1.1).
//
// A route group rather than six copies of the same shell, for the same reason
// `(public)` is one — these six share no ancestor route otherwise, and a
// second copy of this file is how one of the six drifts.
export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  // B-311. `/reset-password?token=` speaks the tenant's language, not the
  // cookie's — `proxy.ts` copies the token into this header for the same
  // reason it does for `/pay/<token>` (PAY_TOKEN_HEADER's own comment). The
  // other five routes never carry this header, so they fall straight through
  // to the ordinary cookie read.
  const resetToken = (await headers()).get(RESET_TOKEN_HEADER)
  const locale = resetToken ? await resetLinkLocale(resetToken) : await getLocale()
  const dict = dictionaryFor(locale)

  return (
    <LocaleProvider locale={locale} dict={dict}>
      <a
        href="#main"
        className="bg-background focus:ring-ring sr-only rounded-md px-4 py-2 text-sm font-medium focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:ring-2"
      >
        {translate(dict, 'chrome.skipToMain')}
      </a>
      <div className="flex justify-end p-4">
        <LanguageToggle locale={locale} />
      </div>
      <main id="main" tabIndex={-1} className="flex-1">
        {children}
      </main>
    </LocaleProvider>
  )
}
