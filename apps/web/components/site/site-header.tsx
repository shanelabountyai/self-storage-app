import Link from 'next/link'
import { Phone } from 'lucide-react'
import { SITE } from '@/lib/site-config'

// Persistent header per PRD 01 §6.1: logo, "Find storage" search, phone with
// click-to-call, and "Pay bill / My account".
//
// Tap targets are ≥44×44px (§6.2) — that is what the `min-h-11` / `py-2.5`
// sizing is for, not visual padding. Nothing here depends on hover (§6.2), so
// it works on touch and via keyboard alike.
export function SiteHeader() {
  return (
    <header className="border-b">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
        <Link
          href="/"
          className="mr-auto inline-flex min-h-11 items-center text-base font-semibold tracking-tight"
        >
          {SITE.name}
        </Link>

        <nav aria-label="Main" className="flex items-center gap-1">
          <Link
            href="/storage/search"
            className="hover:bg-accent inline-flex min-h-11 items-center rounded-md px-3 text-sm font-medium"
          >
            Find storage
          </Link>

          {/* tel: on every phone number (§6.2). The icon is decorative — the
              number itself is the accessible name. */}
          <a
            href={`tel:${SITE.phone.href}`}
            className="hover:bg-accent inline-flex min-h-11 items-center gap-2 rounded-md px-3 text-sm font-medium"
          >
            <Phone className="size-4" aria-hidden="true" />
            <span className="sr-only">Call us at </span>
            {SITE.phone.display}
          </a>

          <Link
            href="/login"
            className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex min-h-11 items-center rounded-md px-4 text-sm font-medium"
          >
            Pay bill
            <span className="sr-only"> or sign in to my account</span>
          </Link>
        </nav>
      </div>
    </header>
  )
}
