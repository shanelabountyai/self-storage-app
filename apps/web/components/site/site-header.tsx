import Link from 'next/link'
import { Phone } from 'lucide-react'
import { SITE } from '@/lib/site-config'
import { publicFootprint } from '@/lib/facility/public-facility'
import { LanguageToggle } from '@/components/site/language-toggle'
import { dictionaryFor, translate, type Locale } from '@/lib/i18n'

// Persistent header per PRD 01 §6.1: logo, "Find storage" search, phone with
// click-to-call, and "Pay bill / My account".
//
// B-364 (D-146, D-147): laid out as the design kit's `Shell` — a dark utility
// strip over a light nav bar. The kit's strip claimed gate hours and "7 sites
// across the Cedar Valley"; only the second has data behind it at org level
// (gate hours are per facility), so the strip says the registry's count and
// cities, and hours stay on each facility page.
//
// Tap targets are ≥44×44px (§6.2) — that is what the `min-h-11` / `py-2.5`
// sizing is for, not visual padding. Nothing here depends on hover (§6.2), so
// it works on touch and via keyboard alike.
export async function SiteHeader({ locale }: { locale: Locale }) {
  const dict = dictionaryFor(locale)
  const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>) =>
    translate(dict, key, vars)
  const { siteCount, cities } = await publicFootprint()
  const cityList = new Intl.ListFormat(locale, { type: 'conjunction' }).format(
    cities.map((c) => c.city),
  )

  return (
    <header>
      <div data-surface="inverse" className="bg-inverse text-inverse-foreground">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-6 px-4 text-sm">
          {/* tel: on every phone number (§6.2). The icon is decorative — the
              number itself is the accessible name. */}
          <a
            href={`tel:${SITE.phone.href}`}
            className="inline-flex min-h-11 items-center gap-2 rounded-md underline-offset-4 hover:underline"
          >
            <Phone className="size-4" aria-hidden="true" />
            <span className="sr-only">{t('chrome.callUsAt')}</span>
            {SITE.phone.display}
          </a>
          {siteCount > 0 && (
            <span className="text-inverse-muted py-2 sm:ml-auto">
              {t(siteCount === 1 ? 'chrome.footprintOne' : 'chrome.footprintOther', {
                count: siteCount,
                cities: cityList,
              })}
            </span>
          )}
        </div>
      </div>

      <div className="bg-background border-b">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
          <Link
            href="/"
            className="font-heading mr-auto inline-flex min-h-11 items-center gap-2.5 text-lg font-bold tracking-tight"
          >
            {/* The kit's mark is a placeholder clay square ("brand mark not
                yet supplied"), so it is decoration and the name is the link. */}
            <span className="bg-primary size-6 rounded-md" aria-hidden="true" />
            {SITE.brand}
          </Link>

          {/* B-090 part 6: `flex-wrap` on the NAV, not only on the header
              around it — the nav's own children have to wrap at 320px or every
              reflow spec fails with a horizontally scrolling page (1.4.10). */}
          <nav
            aria-label={t('chrome.mainNav')}
            className="flex flex-wrap items-center gap-x-1 gap-y-1"
          >
            {/* B-082 part 3. The content hub, one click from every page, and
                never `sm:`-only: content that disappears on reflow is what
                1.4.10 is about. */}
            <Link
              href="/guides"
              className="hover:bg-accent inline-flex min-h-11 items-center rounded-md px-3 text-sm font-medium"
            >
              {t('chrome.guides')}
            </Link>

            <Link
              href="/login"
              className="hover:bg-accent inline-flex min-h-11 items-center rounded-md px-3 text-sm font-medium"
            >
              {t('chrome.payBill')}
              <span className="sr-only">{t('chrome.payBillSr')}</span>
            </Link>

            {/* The kit's one clay primary per view. */}
            <Link
              href="/storage/search"
              className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex min-h-11 items-center rounded-md px-4 text-sm font-medium"
            >
              {t('chrome.findStorage')}
            </Link>

            {/* B-090 part 6. Last: a preference, not a destination, and in the
                header on every public page because the visitor who needs it
                usually arrives on a facility page from search. */}
            <LanguageToggle locale={locale} />
          </nav>
        </div>
      </div>
    </header>
  )
}
