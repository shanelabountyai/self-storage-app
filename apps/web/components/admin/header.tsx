import { Bell, PhoneCall } from 'lucide-react'
import Link from 'next/link'
import { signOut } from '@/auth'
import { FacilitySwitcher } from './facility-switcher'
import type { SwitcherFacility } from '@/lib/admin/facility-selection'

type Props = {
  userName: string
  facilities: readonly SwitcherFacility[]
  cookieValue: string | undefined
  canSeeAll: boolean
}

export function Header({ userName, facilities, cookieValue, canSeeAll }: Props) {
  // Wraps rather than forcing one row. At 320px the switcher, the search stub
  // and the user group could not fit, and the header was what pushed the whole
  // admin shell into horizontal scrolling (1.4.10, PRD 02 FR-16).
  return (
    <header className="print:hidden flex min-h-14 flex-wrap items-center justify-between gap-x-4 gap-y-2 bg-card border-b px-6 py-2">
      <FacilitySwitcher facilities={facilities} cookieValue={cookieValue} canSeeAll={canSeeAll} />

      {/* B-386. Submits to the tenants screen, whose `?q=` already searches
          name, phone, email and unit number. Hidden below `sm` for width; the
          Tenants nav link is the phone route to the same search. */}
      <form action="/admin/tenants" method="get" role="search" className="hidden flex-1 sm:block">
        <label htmlFor="admin-search" className="sr-only">
          Search tenants
        </label>
        <input
          id="admin-search"
          name="q"
          type="search"
          placeholder="Search tenants by name, phone, email or unit…"
          className="border-input bg-background h-11 w-full rounded-md border px-3 text-sm"
        />
      </form>

      <div className="flex items-center gap-3">
        {/* PRD 02 US-43: "a 'new inquiry' action reachable in one click from
            any admin screen". In the header rather than on the leads page,
            because the phone rings while somebody is halfway through a move-out
            — if capturing the call costs a navigation first, it goes on a
            sticky note instead, which is the whole failure this item exists to
            fix. Visible at every width for the same reason. */}
        <Link
          href="/admin/leads"
          className="border-input hover:bg-accent inline-flex min-h-11 items-center gap-1 rounded-md border px-3 text-sm font-medium"
        >
          <PhoneCall className="size-4" aria-hidden="true" />
          New inquiry
        </Link>

        {/* Notification bell — static per B-007's scope; real counts (queued
            approvals, failed runs, overdue delinquency steps) come from the
            features that produce them (B-046, B-052, B-057...). */}
        <button
          type="button"
          disabled
          aria-label="Notifications"
          className="text-muted-foreground rounded-md p-2 disabled:opacity-60"
        >
          <Bell className="size-4" aria-hidden="true" />
        </button>

        <span className="text-sm">{userName}</span>

        <form
          action={async () => {
            'use server'
            await signOut({ redirectTo: '/login' })
          }}
        >
          <button type="submit" className="text-sm underline underline-offset-2">
            Sign out
          </button>
        </form>
      </div>
    </header>
  )
}
