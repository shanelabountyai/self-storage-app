'use client'

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
///
/// B-094 removed the `onChange` auto-submit (WCAG 3.2.2 On Input). Changing a
/// <select> value used to run a server action and navigate. On Windows/Firefox
/// arrow-keying through the option list fires `change` on every option passed,
/// so a keyboard user with four assigned facilities navigated to three wrong
/// facilities on the way to the fourth — each one a full page load that reset
/// their focus. On macOS/VoiceOver the page was replaced mid-interaction with
/// no warning and nothing announcing the new context.
///
/// The fix is a visible submit button. The component stays a client component
/// only to read the current route for `returnTo`; there is no client-side
/// behaviour left, and the form posts to a server action, so it works with
/// JavaScript disabled either way.
export function FacilitySwitcher({ facilities, cookieValue, canSeeAll }: Props) {
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
    <form action={setFacility} className="inline-flex items-center gap-2">
      <input type="hidden" name="returnTo" value={pathname} />
      <label htmlFor="facility-switcher" className="sr-only">
        Switch facility
      </label>
      <select
        id="facility-switcher"
        name="facilityId"
        defaultValue={currentValue}
        className="border-input bg-background h-9 rounded-md border px-2 text-sm"
      >
        {allowAllOption && <option value={ALL_FACILITIES}>All facilities</option>}
        {facilities.map((facility) => (
          <option key={facility.id} value={facility.id}>
            {facility.name}
          </option>
        ))}
      </select>
      <button
        type="submit"
        className="border-input hover:bg-accent h-9 rounded-md border px-3 text-sm font-medium"
      >
        Switch
      </button>
    </form>
  )
}
