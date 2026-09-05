import Link from 'next/link'
import { LEGAL_PAGES, SITE } from '@/lib/site-config'
import { dictionaryFor, translate, type Locale, type MessageKey } from '@/lib/i18n'
import { hasSpanishTwin, localePath } from '@/lib/i18n/routing'

// B-090 part 6. The legal-page labels live in `site-config.ts` in English
// because the sitemap and the a11y sweep read that list too, and neither of
// them wants a translation. Mapping href → message key here keeps one list of
// pages while giving the footer a translated label; a page added to
// `LEGAL_PAGES` with no key here fails typecheck rather than rendering blank.
const NAV_KEYS: Record<(typeof LEGAL_PAGES)[number]['href'], MessageKey> = {
  '/faq': 'nav.faq',
  '/about': 'nav.about',
  '/contact': 'nav.contact',
  '/terms': 'nav.terms',
  '/privacy': 'nav.privacy',
  '/accessibility': 'nav.accessibility',
  '/messaging-policy': 'nav.messagingPolicy',
}

export function SiteFooter({ locale }: { locale: Locale }) {
  const dict = dictionaryFor(locale)
  const t = (key: MessageKey, vars?: Record<string, string | number>) =>
    translate(dict, key, vars)

  return (
    <footer className="mt-auto border-t">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-8">
        <nav aria-label={t('chrome.footerNav')}>
          <ul className="flex flex-wrap gap-x-2 gap-y-1">
            {LEGAL_PAGES.map((page) => (
              <li key={page.href}>
                <Link
                  // B-262: a legal page has no Spanish twin, so its link stays
                  // unprefixed in both languages rather than pointing at a URL
                  // the proxy would redirect straight back.
                  href={hasSpanishTwin(page.href) ? localePath(locale, page.href) : page.href}
                  className="hover:bg-accent inline-flex min-h-11 items-center rounded-md px-2 text-sm underline underline-offset-4"
                >
                  {t(NAV_KEYS[page.href])}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <p className="text-muted-foreground text-sm">
          {t('chrome.questionsCall')}{' '}
          <a href={`tel:${SITE.phone.href}`} className="underline underline-offset-4">
            {SITE.phone.display}
          </a>{' '}
          {t('chrome.orEmail')}{' '}
          <a href={`mailto:${SITE.supportEmail}`} className="underline underline-offset-4">
            {SITE.supportEmail}
          </a>
          .
        </p>

        {/* The legal pages themselves are still English-only (D-122), and this
            sentence is where a Spanish reader is told so — it already says the
            pages are unreviewed drafts, so it is the honest place for it
            rather than a second banner. */}
        <p className="text-muted-foreground text-xs">
          {t('chrome.disclaimer', { name: SITE.name })}
        </p>
      </div>
    </footer>
  )
}
