'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { CreditCard, House, Phone, Unlock, type LucideIcon } from 'lucide-react'
import { useT } from '@/components/i18n/locale-provider'
import { isPortalPathActive } from '@/lib/portal/nav-match'

// B-370 (D-146), corrected by B-372. The mobile kit's `MobileTabBar`, as the
// portal's phone-width layout: no native app exists, so the kit's four
// destinations become a bottom bar under `sm`. It is a SHORTCUT row, not the IA
// — the full eleven-link nav stays in the header, so nothing is reachable only
// from here. It replaces B-239's lone sticky Pay bar: Pay is one of the four,
// and carries the amount when something is owed. LAST in the DOM (SC 2.4.3).
//
// B-372 (SC 3.2.4): one name per destination, shared with the header. Overview
// and Gate code use the header's and the card's own keys. Help is a `tel:` link
// to the facility when the tenant's units share one phone; otherwise it goes to
// the per-unit call lines on `/portal`. Gate code lands on the first lease
// card's heading, not on the authorized-people list. Fragment and `tel:` tabs
// are never "current" (SC 1.4.1: the current mark is a top bar plus weight, not
// colour; an owed Pay tab is FILLED, which is a different cue).
type Tab = { key: string; href: string; label: string; icon: LucideIcon; current: boolean }

export function PortalTabBar({
  pay,
  helpPhone,
  hasLease,
}: {
  pay: { href: string; label: string } | null
  helpPhone: string | null
  hasLease: boolean
}) {
  const t = useT()
  const pathname = usePathname()
  const tabs: (Tab & { name?: string })[] = [
    { key: 'home', href: '/portal', label: t('portal.overview'), icon: House, current: isPortalPathActive(pathname, '/portal') },
    {
      key: 'pay',
      href: pay?.href ?? '/portal/pay',
      label: pay?.label ?? t('portal.tabPay'),
      icon: CreditCard,
      current: isPortalPathActive(pathname, '/portal/pay'),
    },
    { key: 'gate', href: hasLease ? '/portal#gate-code' : '/portal', label: t('dash.gateCode'), icon: Unlock, current: false },
    {
      key: 'help',
      href: helpPhone ? `tel:${helpPhone.replace(/[^0-9+]/g, '')}` : '/portal#facility-phone',
      label: t('portal.tabHelp'),
      name: helpPhone ? t('portal.tabHelpCall', { phone: helpPhone }) : undefined,
      icon: Phone,
      current: false,
    },
  ]
  return (
    <nav
      id="portal-tab-bar"
      aria-label={t('portal.tabNav')}
      className="bg-background/95 fixed inset-x-0 bottom-0 z-40 flex border-t backdrop-blur sm:hidden"
    >
      {tabs.map(({ key, href, label, name, icon: Icon, current }) => {
        const owed = key === 'pay' && pay !== null
        return (
          <Link
            key={key}
            href={href}
            aria-label={name}
            aria-current={current ? 'page' : undefined}
            className={`flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 border-t-2 border-transparent px-1 py-1.5 text-center text-xs ${
              owed
                ? 'bg-primary text-primary-foreground font-semibold aria-[current=page]:border-primary-foreground'
                : 'text-muted-foreground aria-[current=page]:border-primary aria-[current=page]:text-primary aria-[current=page]:font-semibold'
            }`}
          >
            <Icon className="size-5" aria-hidden="true" />
            {label}
          </Link>
        )
      })}
    </nav>
  )
}
