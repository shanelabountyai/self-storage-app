import Link from 'next/link'
import { LEGAL_PAGES, SITE } from '@/lib/site-config'

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-8">
        <nav aria-label="Footer">
          <ul className="flex flex-wrap gap-x-2 gap-y-1">
            {LEGAL_PAGES.map((page) => (
              <li key={page.href}>
                <Link
                  href={page.href}
                  className="hover:bg-accent inline-flex min-h-11 items-center rounded-md px-2 text-sm underline underline-offset-4"
                >
                  {page.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <p className="text-muted-foreground text-sm">
          Questions? Call{' '}
          <a href={`tel:${SITE.phone.href}`} className="underline underline-offset-4">
            {SITE.phone.display}
          </a>{' '}
          or email{' '}
          <a href={`mailto:${SITE.supportEmail}`} className="underline underline-offset-4">
            {SITE.supportEmail}
          </a>
          .
        </p>

        <p className="text-muted-foreground text-xs">
          {SITE.name} is a learning project. Nothing on this site is a real offer of
          storage, and the legal pages are unreviewed drafts.
        </p>
      </div>
    </footer>
  )
}
