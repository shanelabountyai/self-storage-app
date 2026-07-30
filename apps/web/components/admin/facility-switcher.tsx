'use client'

import { useRef } from 'react'
import { usePathname } from 'next/navigation'
import { setFacility } from '@/app/admin/actions'
import {
  ALL_FACILITIES,
  resolveSelectedFacility,
  type SwitcherFacility,
} from '@/lib/admin/facility-selection-logic'

type Props = {
  facilities: readonly SwitcherFacility[]
  cookieValue: string | undefined
  /// Whether this actor has all-facilities access at all (PRD 02 US-1 AC2).
  /// The option is additionally hidden outside roll-up screens — see below.
  canSeeAll: boolean
}

/// A native <select> rather than a custom combobox: it's keyboard- and
/// screen-reader-accessible for free, and its built-in type-ahead already
/// satisfies the "search/filter for >5 facilities" acceptance criterion —
/// no Combobox dependency needed for what a native element already does.
export function FacilitySwitcher({ facilities, cookieValue, canSeeAll }: Props) {
  const formRef = useRef<HTMLFormElement>(null)
  const pathname = usePathname()

  // "All facilities" is offered only on roll-up screens (PRD 02 US-1 AC2).
  // The dashboard is the only one that exists before B-042's portfolio report.
  const allowAllOption = canSeeAll && pathname === '/admin'
  const selected = resolveSelectedFacility(cookieValue, facilities, allowAllOption)

  const currentValue =
    selected.mode === 'all' ? ALL_FACILITIES : selected.mode === 'single' ? selected.facility.id : ''

  if (facilities.length === 0 && !allowAllOption) {
    return <p className="text-muted-foreground text-sm">No facilities assigned</p>
  }

  return (
    <form ref={formRef} action={setFacility} className="inline-flex items-center gap-2">
      <input type="hidden" name="returnTo" value={pathname} />
      <label htmlFor="facility-switcher" className="sr-only">
        Switch facility
      </label>
      <select
        id="facility-switcher"
        name="facilityId"
        defaultValue={currentValue}
        onChange={() => formRef.current?.requestSubmit()}
        className="border-input bg-background h-9 rounded-md border px-2 text-sm"
      >
        {allowAllOption && <option value={ALL_FACILITIES}>All facilities</option>}
        {facilities.map((facility) => (
          <option key={facility.id} value={facility.id}>
            {facility.name}
          </option>
        ))}
      </select>
    </form>
  )
}
