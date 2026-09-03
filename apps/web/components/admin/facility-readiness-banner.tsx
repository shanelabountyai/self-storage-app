import Link from 'next/link'
import { facilityReadiness } from '@/lib/admin/facility-readiness'

// B-237. "This facility is not ready to operate", listing what is still
// missing, until nothing is.
//
// Text and links, not a colour badge (1.4.1): every gap names what is missing,
// what silently does not happen while it is, and where to go and fix it. A red
// dot would carry none of the three.
//
// Renders NOTHING once the list is empty, deliberately. A permanent "all good"
// banner on a screen somebody opens every day is the thing that teaches them to
// stop reading the region this one lives in.
export async function FacilityReadinessBanner({ facilityId }: { facilityId: string }) {
  const gaps = await facilityReadiness(facilityId)
  if (gaps.length === 0) return null

  return (
    <section
      aria-labelledby="readiness-heading"
      className="flex flex-col gap-2 rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-950"
    >
      <h2 id="readiness-heading" className="text-base font-medium">
        This facility is not ready to operate
      </h2>
      <p className="max-w-prose text-sm text-pretty">
        {gaps.length === 1 ? 'One thing is' : `${gaps.length} things are`} still unset. Rent invoices
        anyway, so nothing here will show up as an error.
      </p>
      <ul className="flex list-disc flex-col gap-2 pl-5 text-sm">
        {gaps.map((gap) => (
          <li key={gap.kind}>
            <Link href={gap.href} className="font-medium underline underline-offset-2">
              {gap.what}
            </Link>{' '}
            — {gap.consequence}
          </li>
        ))}
      </ul>
    </section>
  )
}
