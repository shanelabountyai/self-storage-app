'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

// B-387. Header link with `aria-current="page"` on its own route (and below it,
// so /storage/locations stays current on nested pages). Exact match for `/`.
export function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const pathname = usePathname()
  const current = pathname === href || pathname.startsWith(`${href}/`)
  return (
    <Link
      href={href}
      aria-current={current ? 'page' : undefined}
      className="hover:bg-accent aria-[current=page]:bg-accent inline-flex min-h-11 items-center rounded-md px-3 text-sm font-medium aria-[current=page]:underline aria-[current=page]:underline-offset-4"
    >
      {children}
    </Link>
  )
}
