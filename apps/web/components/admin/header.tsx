import { Bell } from 'lucide-react'
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
  return (
    <header className="flex h-14 items-center justify-between gap-4 border-b px-4">
      <FacilitySwitcher facilities={facilities} cookieValue={cookieValue} canSeeAll={canSeeAll} />

      {/* Universal search — deliberately a stub per the B-007 backlog line;
          no destination exists to wire it to yet. */}
      <label htmlFor="admin-search" className="sr-only">
        Search tenants, units, invoices
      </label>
      <input
        id="admin-search"
        type="search"
        placeholder="Search tenants, units, invoices…"
        disabled
        className="border-input bg-background h-9 flex-1 rounded-md border px-3 text-sm disabled:opacity-60"
      />

      <div className="flex items-center gap-3">
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
