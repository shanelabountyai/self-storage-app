import Link from 'next/link'
import { LEGAL_PAGES, SITE } from '@/lib/site-config'
import { publicFootprint } from '@/lib/facility/public-facility'
import { dictionaryFor, translate, type Locale, type MessageKey } from '@/lib/i18n'

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

// B-364 (D-146, D-147). The kit's four-column dark footer. Its "Storage"
// column listed products (RV parking, portable containers, business storage)
// and its "Company" column careers, managers and franchising — none of which
// exists here, so the columns hold the routes that do: the cities the
// registry has facilities in, and `LEGAL_PAGES` split in two. Every legal page
// still renders from that one list.
const COMPANY: ReadonlySet<string> = new Set(['/about', '/contact', '/faq'])

const linkClass =
  'inline-flex min-h-11 items-center rounded-md text-sm underline-offset-4 hover:underline'

export async function SiteFooter({ locale }: { locale: Locale }) {
  const dict = dictionaryFor(locale)
  const t = (key: MessageKey, vars?: Record<string, string | number>) =>
    translate(dict, key, vars)
  const { cities } = await publicFootprint()

  const columns: { heading: MessageKey; links: { href: string; label: string }[] }[] = [
    {
      heading: 'chrome.footerStorage',
      links: [
        { href: '/storage/search', label: t('chrome.findStorage') },
        ...cities.map((c) => ({ href: c.href, label: c.city })),
        { href: '/storage/locations', label: t('home.allLocations') },
        { href: '/guides', label: t('chrome.guides') },
      ],
    },
    {
      heading: 'chrome.footerCompany',
      links: LEGAL_PAGES.filter((p) => COMPANY.has(p.href)).map((p) => ({
        href: p.href,
        label: t(NAV_KEYS[p.href]),
      })),
    },
    {
      heading: 'chrome.footerHelp',
      links: [
        { href: '/login', label: t('chrome.payBill') },
        { href: '/storage/size-guide', label: t('chrome.sizeGuide') },
        ...LEGAL_PAGES.filter((p) => !COMPANY.has(p.href)).map((p) => ({
          href: p.href,
          label: t(NAV_KEYS[p.href]),
        })),
      ],
    },
  ]

  return (
    <footer data-surface="inverse" className="bg-inverse text-inverse-foreground mt-16">
      <div className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-12 lg:grid-cols-[1.4fr_3fr]">
        <div className="flex flex-col gap-4">
          <span className="font-heading inline-flex items-center gap-2.5 text-lg font-bold tracking-tight">
            <span className="bg-primary size-6 rounded-md" aria-hidden="true" />
            {SITE.brand}
          </span>
          <p className="text-inverse-muted max-w-72 text-sm">
            {t('chrome.questionsCall')}{' '}
            <a href={`tel:${SITE.phone.href}`} className="text-inverse-foreground underline underline-offset-4">
              {SITE.phone.display}
            </a>{' '}
            {t('chrome.orEmail')}{' '}
            <a href={`mailto:${SITE.supportEmail}`} className="text-inverse-foreground underline underline-offset-4">
              {SITE.supportEmail}
            </a>
            .
          </p>
        </div>

        {/* One nav, three labelled lists: the columns are a visual grouping of
            one set of footer links, not three landmarks to tab between. Its
            own grid, not `display: contents` — Safari has dropped the landmark
            role of a `contents` element. */}
        <nav
          aria-label={t('chrome.footerNav')}
          className="grid gap-8 sm:grid-cols-3"
        >
          {columns.map((col) => {
            const id = `footer-${col.heading}`
            return (
              <div key={col.heading} className="flex flex-col gap-1">
                <h2
                  id={id}
                  className="text-inverse-muted font-sans text-xs font-semibold tracking-[0.13em] uppercase"
                >
                  {t(col.heading)}
                </h2>
                <ul aria-labelledby={id}>
                  {col.links.map((link) => (
                    <li key={link.href}>
                      <Link href={link.href} className={linkClass}>
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
        </nav>
      </div>

      {/* `/terms`, `/privacy`, the lease and every notice are still
          English-only (D-122), and this sentence is where a Spanish reader is
          told so — it already says the pages are unreviewed drafts, so it is
          the honest place for it rather than a second banner. B-259 made it
          NAME them. It names the operator (`SITE.name`), not the brand: it is
          a statement about who is speaking. */}
      <div className="border-t border-white/15">
        <div className="text-inverse-muted mx-auto flex w-full max-w-6xl flex-col gap-2 px-4 py-5 text-xs">
          <p>{t('chrome.disclaimer', { name: SITE.name })}</p>
          <p>
            © {new Date().getFullYear()} {SITE.name}
          </p>
        </div>
      </div>
    </footer>
  )
}
