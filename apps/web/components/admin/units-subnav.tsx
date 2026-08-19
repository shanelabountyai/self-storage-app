'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const TABS = [
  { href: '/admin/units', label: 'Inventory' },
  { href: '/admin/units/types', label: 'Types' },
  // B-088 part 1. Beside Types rather than under Reports: the rate a new
  // tenant is quoted is inventory configuration, and the one-click apply lands
  // on the same `UnitTypeRate` history the Types tab shows.
  { href: '/admin/units/rates', label: 'Rates' },
  // B-116: "Add a unit" and "Import layout" moved here from the daily
  // inventory screen — two once-per-facility setup jobs, not something that
  // belongs below the bulk-edit section of the page worked from every day.
  { href: '/admin/units/setup', label: 'Setup' },
] as const

export function UnitsSubnav() {
  const pathname = usePathname()

  return (
    <nav aria-label="Units sections" className="border-b">
      <ul className="flex gap-4">
        {TABS.map((tab) => {
          const active = pathname === tab.href
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={active ? 'page' : undefined}
                className={`-mb-px inline-block border-b-2 px-1 pb-2 text-sm ${
                  active
                    ? 'border-foreground font-medium'
                    : 'text-muted-foreground border-transparent hover:border-muted-foreground/40'
                }`}
              >
                {tab.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
