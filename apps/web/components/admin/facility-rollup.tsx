import Link from 'next/link'

// PRD 02 §4.1 US-2 / §5.5 FR-23. What "All facilities" shows.
//
// D-12 makes owner + all-facilities assignment the ordinary unrestricted
// account, so "All facilities" is the OWNER'S OWN DEFAULT CONTEXT — not an
// exotic state. Every screen that met it answered with a variation on "pick a
// single facility above", in five different phrasings, which meant the person
// who holds the whole portfolio was told to go away by their own home screen.
//
// The shape is the one `/admin/tasks` arrived at in B-095 and this is now the
// single implementation of it: a labelled section, one row per facility, the
// name linking into that facility's own list. The link carries `?facility=`
// rather than switching the persistent context, so a regional manager checking
// one site does not have to remember to switch back.

export type RollupRow = {
  facilityId: string
  facilityName: string
  /// Where this facility's own list lives. Carries `?facility=` by convention.
  href: string
  /// The figure, already formatted. Rendering is the caller's business — an
  /// occupancy percentage, a dollar balance and an open-task count have nothing
  /// in common except that they sit at the end of the row.
  summary: string
}

export function FacilityRollup({
  heading,
  rows,
  id = 'rollup-heading',
}: {
  heading: string
  rows: readonly RollupRow[]
  id?: string
}) {
  if (rows.length === 0) return null

  return (
    <section aria-labelledby={id} className="border-input rounded-lg border p-4">
      <h2 id={id} className="text-sm font-medium">
        {heading}
      </h2>
      <ul className="mt-2 flex flex-col gap-1 text-sm">
        {rows.map((row) => (
          <li key={row.facilityId} className="flex flex-wrap justify-between gap-x-4">
            {/* B-235. The link's accessible name carries the figure beside it,
                not just the site's name (2.4.4/2.4.6): read out of context — a
                screen reader's link list, or one row at a time — "Cedar Park"
                does not say what is waiting there, which is the whole reason a
                person is on this screen. The visible text is contained in the
                accessible name, so 2.5.3 holds. */}
            <Link
              href={row.href}
              aria-label={`${row.facilityName} — ${row.summary}`}
              className="underline underline-offset-2"
            >
              {row.facilityName}
            </Link>
            <span className="text-muted-foreground tabular-nums">{row.summary}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
