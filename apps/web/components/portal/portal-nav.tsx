'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

// B-239. Lifted out of `app/portal/layout.tsx` so the nav can read
// `usePathname()`. Three changes came with the move, and only the first is a
// layout change:
//
// 1. **Pay is the first item whenever anything is owed, and Move out is not a
//    top-level item any more.** The one irreversible destination in the product
//    held permanent space beside Overview while the one thing collections
//    depends on was reachable only from a card on the dashboard. The comment
//    B-117 left at the old Move out link argued it was separated BECAUSE it is
//    irreversible — which is an argument for putting it inside Manage next to
//    "Move to another unit", not beside Overview. Pay REPLACES it rather than
//    joining it, so the row does not grow: B-117 cut this to four links because
//    nine wrapped to four lines at 360px.
//
// 2. **`aria-current="page"`, on every link.** No link here carried it at all —
//    not the top-level ones, not Payment plan, not the six inside Manage — so a
//    tenant on `/portal/refer`, reachable only from inside the collapsed menu,
//    had no programmatic indication of where they were, on the one navigation
//    the customer uses. SC 2.4.8 Location is AAA and this is deliberately
//    beyond AA: it is a one-attribute fix on a customer surface whose pattern is
//    already written in `components/admin/side-nav.tsx`.
//
// 3. **Manage opens when the active route is one of its seven**, mirroring the
//    same file, so landing on Contact details from an email does not read as
//    "lost the nav".
//
// B-247's `min-h-11` stays on every link including the ones Manage reveals —
// PRD 01 §6.2's tap target, which is a shipping-gate rule rather than a WCAG
// 2.1 AA one.

type NavLink = { href: string; label: string }

const MANAGE: NavLink[] = [
  { href: '/portal/transfer', label: 'Move to another unit' },
  { href: '/portal/access', label: 'Who can get in' },
  { href: '/portal/protection', label: 'Protection' },
  { href: '/portal/contact', label: 'Contact details' },
  { href: '/portal/notifications', label: 'Notifications' },
  { href: '/portal/refer', label: 'Refer a friend' },
  { href: '/portal/move-out', label: 'Move out' },
]

const LINK_CLASS = 'inline-flex min-h-11 items-center underline underline-offset-2'

/// `/portal` is exact — every route below it starts with it, so a prefix test
/// would mark Overview current on all eleven. Everything else is a prefix, and
/// the query string never participates: the Pay link carries `?lease=…`.
function isActive(pathname: string, href: string): boolean {
  const path = href.split('?')[0]
  return path === '/portal' ? pathname === '/portal' : pathname.startsWith(path)
}

function NavItem({ href, label, pathname }: NavLink & { pathname: string }) {
  return (
    <Link href={href} aria-current={isActive(pathname, href) ? 'page' : undefined} className={LINK_CLASS}>
      {label}
    </Link>
  )
}

export function PortalNav({
  pay,
  showPaymentPlan,
}: {
  /// B-239. Null when nothing is owed. `href` is the single owing lease's
  /// payment page, or the dashboard when several units owe — Overview already
  /// renders one "Pay $X now" per lease, so it IS the chooser and a second
  /// screen for that would be a new one.
  pay: { href: string; label: string } | null
  showPaymentPlan: boolean
}) {
  const pathname = usePathname()
  const manageIsActive = MANAGE.some((link) => isActive(pathname, link.href))

  return (
    <nav aria-label="Your account" className="flex flex-wrap items-center gap-4 text-sm">
      {pay && (
        <Link
          href={pay.href}
          // Only when it names its own page. With several owing leases the Pay
          // link points at Overview — which is the chooser — and marking BOTH
          // it and Overview `current` would put two current items in one nav.
          aria-current={pay.href.startsWith('/portal/pay') && isActive(pathname, pay.href) ? 'page' : undefined}
          className="bg-primary text-primary-foreground inline-flex min-h-11 items-center rounded-md px-3 font-medium"
        >
          {pay.label}
        </Link>
      )}
      <NavItem href="/portal" label="Overview" pathname={pathname} />
      <NavItem href="/portal/methods" label="Payment methods" pathname={pathname} />
      <NavItem href="/portal/statements" label="Statements" pathname={pathname} />
      <NavItem href="/portal/documents" label="Documents" pathname={pathname} />
      {showPaymentPlan && <NavItem href="/portal/payment-plan" label="Payment plan" pathname={pathname} />}
      <details open={manageIsActive} className="text-sm">
        <summary className={`${LINK_CLASS} cursor-pointer`}>Manage</summary>
        <div className="flex flex-col gap-2 pt-2">
          {MANAGE.map((link) => (
            <NavItem key={link.href} {...link} pathname={pathname} />
          ))}
        </div>
      </details>
    </nav>
  )
}
