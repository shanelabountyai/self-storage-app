'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { CreditCard, House, Phone, Unlock, type LucideIcon } from 'lucide-react'
import { useT } from '@/components/i18n/locale-provider'
import type { MessageKey } from '@/lib/i18n'

// B-370 (D-146). The mobile kit's `MobileTabBar`, as the portal's phone-width
// layout: no native app exists, so the kit's four destinations become a bottom
// bar under `sm`. It is a SHORTCUT row, not the IA — the full eleven-link nav
// stays in the header, so nothing is reachable only from here. It replaces
// B-239's lone sticky Pay bar: Pay is one of the four, and carries the amount
// when something is owed. LAST in the DOM (SC 2.4.3), as that bar was.
//
// Kit's "Help" is a phone call to the site manager; there is no manager field
// (D-147), so it opens Contact details instead.
type Tab = { href: string; labelKey: MessageKey; icon: LucideIcon }

const TABS: Tab[] = [
  { href: '/portal', labelKey: 'portal.tabHome', icon: House },
  { href: '/portal/pay', labelKey: 'portal.tabPay', icon: CreditCard },
  { href: '/portal/access', labelKey: 'portal.tabAccess', icon: Unlock },
  { href: '/portal/contact', labelKey: 'portal.tabHelp', icon: Phone },
]

export function PortalTabBar({ pay }: { pay: { href: string; label: string } | null }) {
  const t = useT()
  const pathname = usePathname()
  return (
    <nav
      aria-label={t('portal.tabNav')}
      className="bg-background/95 fixed inset-x-0 bottom-0 z-40 flex border-t backdrop-blur sm:hidden"
    >
      {TABS.map(({ href: baseHref, labelKey, icon: Icon }) => {
        const isPay = baseHref === '/portal/pay'
        const href = isPay && pay ? pay.href : baseHref
        const active = baseHref === '/portal' ? pathname === '/portal' : pathname.startsWith(baseHref)
        return (
          <Link
            key={baseHref}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={`flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 px-1 py-1.5 text-center text-xs ${
              isPay && pay
                ? 'text-primary font-semibold'
                : 'text-muted-foreground aria-[current=page]:text-primary aria-[current=page]:font-semibold'
            }`}
          >
            <Icon className="size-5" aria-hidden="true" />
            {isPay && pay ? pay.label : t(labelKey)}
          </Link>
        )
      })}
    </nav>
  )
}
