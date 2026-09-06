import Link from 'next/link'
import { Phone } from 'lucide-react'
import { SITE } from '@/lib/site-config'
import { LanguageToggle } from '@/components/site/language-toggle'
import { dictionaryFor, translate, type Locale } from '@/lib/i18n'
import { localePath } from '@/lib/i18n/routing'

// Persistent header per PRD 01 §6.1: logo, "Find storage" search, phone with
// click-to-call, and "Pay bill / My account".
//
// Tap targets are ≥44×44px (§6.2) — that is what the `min-h-11` / `py-2.5`
// sizing is for, not visual padding. Nothing here depends on hover (§6.2), so
// it works on touch and via keyboard alike.
// B-262: `path` is the current URL with its locale prefix already stripped.
// Every internal link below is built through `localePath`, so a Spanish visitor
// clicking "Buscar almacenamiento" stays on `/es/...` — a raw `href="/storage/
// search"` would silently drop them back into English mid-session, which is the
// one failure mode a URL-carried locale introduces that a cookie did not have.
export function SiteHeader({ locale, path }: { locale: Locale; path: string }) {
  const dict = dictionaryFor(locale)
  const t = (key: Parameters<typeof translate>[1]) => translate(dict, key)
  const href = (to: string) => localePath(locale, to)

  return (
    <header className="border-b">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
        <Link
          href={href('/')}
          className="mr-auto inline-flex min-h-11 items-center text-base font-semibold tracking-tight"
        >
          {SITE.name}
        </Link>

        {/* B-090 part 6: `flex-wrap` on the NAV, not only on the header around
            it. The header has wrapped since B-082 and the comment below says
            so — but the nav is a single flex ITEM of that header, and its own
            children could not wrap. Four controls fitted 320px; the language
            toggle's two did not, and every one of the 26 reflow specs failed
            with a horizontally scrolling page (SC 1.4.10). Wrapping here is
            what the header's own rule always intended. */}
        <nav
          aria-label={t('chrome.mainNav')}
          className="flex flex-wrap items-center gap-x-1 gap-y-1"
        >
          <Link
            href={href('/storage/search')}
            className="hover:bg-accent inline-flex min-h-11 items-center rounded-md px-3 text-sm font-medium"
          >
            {t('chrome.findStorage')}
          </Link>

          {/* B-082 part 3. The content hub, one click from every page. In the
              header rather than the footer because the guides are a reason to
              arrive, not a utility you go looking for — and a hub reachable
              only from a footer is one a crawler reads as boilerplate.
              Not hidden at narrow widths: the header is already `flex-wrap`
              with `gap-y-2` for exactly this, so a fourth item wraps to a
              second row. A `sm:`-only nav link is content that disappears on
              reflow, which is the thing 1.4.10 is about. */}
          <Link
            href={href('/guides')}
            className="hover:bg-accent inline-flex min-h-11 items-center rounded-md px-3 text-sm font-medium"
          >
            {t('chrome.guides')}
          </Link>

          {/* tel: on every phone number (§6.2). The icon is decorative — the
              number itself is the accessible name. */}
          <a
            href={`tel:${SITE.phone.href}`}
            className="hover:bg-accent inline-flex min-h-11 items-center gap-2 rounded-md px-3 text-sm font-medium"
          >
            <Phone className="size-4" aria-hidden="true" />
            <span className="sr-only">{t('chrome.callUsAt')}</span>
            {SITE.phone.display}
          </a>

          <Link
            href="/login"
            className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex min-h-11 items-center rounded-md px-4 text-sm font-medium"
          >
            {t('chrome.payBill')}
            <span className="sr-only">{t('chrome.payBillSr')}</span>
          </Link>

          {/* B-090 part 6. Last in the header rather than first: it is a
              preference, not a destination, and a renter looking for it looks
              at the end of the nav. In the header on every public page and not
              only the homepage, because the visitor who needs it usually
              arrives on a facility page from search, never on `/`. */}
          <LanguageToggle locale={locale} path={path} />
        </nav>
      </div>
    </header>
  )
}
