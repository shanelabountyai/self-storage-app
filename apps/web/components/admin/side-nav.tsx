'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { NavItem } from '@/lib/admin/nav'

export function SideNav({ items }: { items: readonly NavItem[] }) {
  const pathname = usePathname()

  // A fixed 192px column beside the content left ~200px for a max-w-3xl
  // two-column form at phone width, so the admin shell scrolled sideways —
  // 1.4.10 Reflow, which PRD 02 FR-16 applies to admin as much as to the
  // customer site. Below `sm` the nav becomes a horizontally scrollable strip
  // above the content instead.
  return (
    <nav
      aria-label="Admin"
      className="w-full shrink-0 border-b p-2 sm:w-48 sm:border-r sm:border-b-0"
    >
      <ul className="flex flex-row gap-1 overflow-x-auto sm:flex-col">
        {items.map((item) => {
          const active = item.href === '/admin' ? pathname === '/admin' : pathname.startsWith(item.href)
          return (
            <li key={item.key}>
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={`block rounded-md px-3 py-2 text-sm whitespace-nowrap ${
                  active
                    ? 'bg-accent text-accent-foreground font-medium'
                    : 'text-foreground/80 hover:bg-accent/50'
                }`}
              >
                {item.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
