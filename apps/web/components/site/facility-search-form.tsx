import { prisma } from '@storage/db'
import { UseMyLocation } from './use-my-location'

// US-101's search input, shared by the homepage and the results page so the two
// cannot drift in behaviour or accessibility.

/// Typeahead suggestions come from the places we actually operate, not a
/// national gazetteer. Suggesting "Springfield, IL" when the nearest unit is
/// 800 miles away would be a confident route to a zero-results page; every
/// suggestion here resolves to a real facility.
async function suggestions(): Promise<string[]> {
  const facilities = await prisma.facility.findMany({
    where: { status: 'active' },
    select: { city: true, state: true, postalCode: true },
    orderBy: [{ state: 'asc' }, { city: 'asc' }],
  })

  const values = new Set<string>()
  for (const facility of facilities) {
    values.add(`${facility.city}, ${facility.state}`)
    values.add(facility.postalCode)
  }
  return [...values]
}

export async function FacilitySearchForm({
  defaultValue,
  label = 'Where do you need storage?',
  autoFocus = false,
}: {
  defaultValue?: string
  label?: string
  autoFocus?: boolean
}) {
  const options = await suggestions()

  return (
    <div className="max-w-xl">
      {/* GET so the result is a bookmarkable URL rather than a POST that can't
          be shared or refreshed (US-101). Works without JavaScript. */}
      <form action="/storage/search" method="GET" className="flex flex-col gap-3 sm:flex-row">
        <div className="flex-1">
          <label htmlFor="q" className="block text-sm font-medium">
            {label}
          </label>
          <input
            id="q"
            name="q"
            type="search"
            required
            defaultValue={defaultValue}
            autoFocus={autoFocus}
            // A native datalist rather than a hand-rolled combobox: the browser
            // supplies the keyboard model, the screen-reader semantics, and the
            // filtering, none of which a bespoke ARIA widget gets right for
            // free. The suggestion set is small enough to ship inline, so there
            // is no fetch-on-keystroke and it works with JavaScript disabled.
            list="facility-suggestions"
            // No `inputMode`. Zip is the common case, but this field also
            // accepts "Austin, TX" — and `inputMode="numeric"` gives iOS Safari
            // a digits-only keypad with no way to reach letters, which made the
            // hint below ("or Austin, TX") impossible to follow on an iPhone.
            // A mixed field takes the full keyboard; §6.2's numeric-keyboard
            // rule is for genuinely numeric fields.
            autoComplete="postal-code"
            placeholder="Zip code or city"
            aria-describedby="q-hint"
            className="border-input bg-background mt-1 h-12 w-full rounded-md border px-3 text-base"
          />
          <datalist id="facility-suggestions">
            {options.map((option) => (
              <option key={option} value={option} />
            ))}
          </datalist>
          <p id="q-hint" className="text-muted-foreground mt-1 text-sm">
            For example: 78704, or Austin, TX
          </p>
        </div>
        {/* Full-width on mobile, in the thumb zone (§6.1). */}
        <button
          type="submit"
          className="bg-primary text-primary-foreground hover:bg-primary/90 mt-1 h-12 rounded-md px-6 text-base font-medium sm:mt-7"
        >
          Find storage
        </button>
      </form>

      <UseMyLocation />
    </div>
  )
}
