'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { VisibleNavGroup } from '@/lib/admin/nav'

function isActive(pathname: string, href: string): boolean {
  return href === '/admin' ? pathname === '/admin' : pathname.startsWith(href)
}

export function SideNav({ groups }: { groups: readonly VisibleNavGroup[] }) {
  const pathname = usePathname()

  // A fixed 192px column beside the content left ~200px for a max-w-3xl
  // two-column form at phone width, so the admin shell scrolled sideways —
  // 1.4.10 Reflow, which PRD 02 FR-16 applies to admin as much as to the
  // customer site.
  //
  // B-117 (UX review 2026-08-12, findings 11/16). Twenty destinations in one
  // undifferentiated column read as an org chart of the codebase, not a day
  // at a facility, and below `sm` it became a horizontal scroll strip with no
  // sign there was more to the right — Walkthrough and Tasks, the two screens
  // meant to be used phone-in-hand on the property, sat at positions 9 and
  // 14. Two markups, not one CSS trick: above `sm` every group renders as its
  // own labelled section, stacked; below `sm` only Today is the strip, and a
  // "More" disclosure — the same native `<details>` pattern the checkout
  // locality override already uses — holds the rest, open by default when the
  // active page lives inside it so landing on Settings via a bookmark does
  // not read as "lost the nav."
  const today = groups.find((g) => g.key === 'today')
  const rest = groups.filter((g) => g.key !== 'today')
  const activeInRest = rest.some((g) => g.items.some((item) => isActive(pathname, item.href)))

  return (
    <nav
      aria-label="Admin"
      data-surface="inverse"
      // B-368. The kit's SidebarNav: a dark surface-inverse column. `data-surface`
      // re-points the focus ring to the light pine the dark band needs (B-364).
      className="bg-inverse text-inverse-foreground print:hidden w-full shrink-0 p-2 sm:w-48 lg:w-60 lg:p-4"
    >
      {/* Desktop: every group, stacked, each with its own heading. */}
      <div className="hidden flex-col gap-4 sm:flex">
        {groups.map((group) => (
          <div key={group.key}>
            <h2 className="text-inverse-muted px-3 pb-1 text-xs font-semibold tracking-wide uppercase">
              {group.label}
            </h2>
            <ul className="flex flex-col gap-1">
              {group.items.map((item) => (
                <NavLink key={item.key} href={item.href} label={item.label} active={isActive(pathname, item.href)} />
              ))}
            </ul>
          </div>
        ))}
      </div>

      {/* Mobile: Today as the horizontal strip, everything else behind More. */}
      <div className="sm:hidden">
        {today && (
          <ul className="flex flex-row gap-1 overflow-x-auto">
            {today.items.map((item) => (
              <NavLink key={item.key} href={item.href} label={item.label} active={isActive(pathname, item.href)} />
            ))}
          </ul>
        )}
        {rest.length > 0 && (
          <details open={activeInRest} className="mt-1">
            <summary className="text-inverse-muted inline-flex min-h-11 cursor-pointer items-center px-3 text-sm underline underline-offset-4">
              More
            </summary>
            <div className="flex flex-col gap-3 pt-1">
              {rest.map((group) => (
                <div key={group.key}>
                  <h2 className="text-inverse-muted px-3 pb-1 text-xs font-semibold tracking-wide uppercase">
                    {group.label}
                  </h2>
                  <ul className="flex flex-col gap-1">
                    {group.items.map((item) => (
                      <NavLink
                        key={item.key}
                        href={item.href}
                        label={item.label}
                        active={isActive(pathname, item.href)}
                      />
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </details>
        )}
      </div>
    </nav>
  )
}

function NavLink({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <li>
      <Link
        href={href}
        aria-current={active ? 'page' : undefined}
        // B-251. The old active item was a fill of 1.09:1 and nothing else.
        className={`relative block rounded-sm px-3 py-2 text-sm font-semibold whitespace-nowrap ${
          active
            ? 'bg-white/12 text-inverse-foreground'
            : 'text-inverse-muted hover:bg-white/8 hover:text-inverse-foreground'
        }`}
      >
        {/* The kit's 3px accent bar. B-251's rule still holds: the active item
            is told apart by more than a fill, and this bar is that mark. */}
        {active && (
          <span aria-hidden="true" className="absolute top-2 bottom-2 left-0 w-[3px] rounded-full bg-(--inverse-ring)" />
        )}
        {label}
      </Link>
    </li>
  )
}
