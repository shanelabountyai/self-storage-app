import { SiteHeader } from '@/components/site/site-header'
import { SiteFooter } from '@/components/site/site-footer'
import { ConsentBanner } from '@/components/marketing/consent-banner'
import { LocaleProvider } from '@/components/i18n/locale-provider'
import {
  dictionaryFor,
  translate,
} from '@/lib/i18n'
import { getLocale } from '@/lib/i18n/server'

// Public-site shell (PRD 01 §6.1). A route group rather than a path segment,
// so these pages keep clean URLs (/faq, not /public/faq) while /admin, /login,
// and /api stay outside and never inherit this chrome.
//
// B-090 part 6: the locale is resolved once here and handed down two ways —
// as props to the server-rendered chrome, and through `LocaleProvider` for the
// client components below (the checkout steps, the search form). One read per
// request, so the header and the page it wraps cannot end up in different
// languages.
export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale()
  const dict = dictionaryFor(locale)

  return (
    <LocaleProvider locale={locale} dict={dict}>
      {/* First focusable element on every page: keyboard and switch users get
          past the header without tabbing the whole nav (WCAG 2.4.1). Visible
          only when focused, but never display:none — it has to be reachable. */}
      <a
        href="#main"
        className="bg-background focus:ring-ring sr-only rounded-md px-4 py-2 text-sm font-medium focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:ring-2"
      >
        {translate(dict, 'chrome.skipToMain')}
      </a>

      <SiteHeader locale={locale} />
      <main id="main" tabIndex={-1} className="flex-1">
        {children}
      </main>
      <SiteFooter locale={locale} />
      {/* Last in the document, in normal flow. §6.8.1 requires the banner not
          obscure content at 320px or 200% zoom, and a viewport-fixed bar is
          exactly what covers the bottom third of a small screen once its text
          wraps. Placed after the footer so tab order reaches it last rather
          than interrupting the page. */}
      <ConsentBanner />
    </LocaleProvider>
  )
}
