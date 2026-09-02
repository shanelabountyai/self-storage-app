import { AR_BUCKETS, type ArAging, type ArAgingSplit } from '@storage/core/metrics'
import { formatCents } from '@/lib/format'
import { ScrollRegion } from '@/components/ui/scroll-region'

// B-195 built the chased/halted split; B-207 made it reach every screen that
// shows aging rather than only the tenant-level drill-down. One table, used by
// both, is what stops the roll-up and the detail disagreeing again — the same
// reason `delinquencyReport` is the tile's only source of the figure (D-25).
//
// Every facility reads three rows — chased, halted, total — and so does the
// portfolio. On the SAME footing, deliberately: a facility that showed only
// its two halves beside a portfolio that also showed a total invited the
// reader to add the halves themselves at one level and not the other.

export const AR_BUCKET_LABELS: Record<(typeof AR_BUCKETS)[number], string> = {
  d0to10: '0–10',
  d11to30: '11–30',
  d31to60: '31–60',
  d61to90: '61–90',
  over90: 'Over 90',
}

export type ArAgingSplitRow = {
  facilityId: string
  facilityName: string
  split: ArAgingSplit
}

/// One line of buckets, labelled by what is happening to the money.
///
/// The label is a `<th scope="row">` rather than a plain cell, so every figure
/// carries which half of the split it belongs to.
///
/// B-216. `group` — the facility, or "All facilities" in the footer — is
/// carried in that SAME row header rather than in a `scope="rowgroup"` cell one
/// column to the left. `rowgroup` is in the HTML spec and is implemented by
/// none of NVDA, JAWS or VoiceOver, so the facility was associated with these
/// figures only in principle. Visually hidden because the name is already on
/// screen once, in the spanning cell this header sits beside; what it adds is
/// the association, which now lives in a header the row actually has instead
/// of in a scope value nothing reads.
function SplitCells({ group, label, aging }: { group: string; label: string; aging: ArAging }) {
  return (
    <>
      <th scope="row" className="py-2 pr-4 text-left font-normal">
        <span className="sr-only">{group}, </span>
        {label}
      </th>
      {AR_BUCKETS.map((bucket) => (
        <td key={bucket} className="py-2 pr-4 text-right tabular-nums">
          {formatCents(aging[bucket])}
        </td>
      ))}
      <td className="py-2 pr-4 text-right tabular-nums">{formatCents(aging.totalCents)}</td>
    </>
  )
}

export function ArAgingSplitTable({
  rows,
  total,
  caption,
  describedBy,
}: {
  rows: readonly ArAgingSplitRow[]
  total: ArAgingSplit
  caption: string
  describedBy?: string
}) {
  return (
    <ScrollRegion aria-label={caption}>
      <table className="w-full min-w-3xl border-collapse text-sm" aria-describedby={describedBy}>
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-input border-b text-left">
            <th scope="col" className="py-2 pr-4">
              Facility
            </th>
            <th scope="col" className="py-2 pr-4">
              Collections
            </th>
            {AR_BUCKETS.map((bucket) => (
              <th key={bucket} scope="col" className="py-2 pr-4 text-right">
                {AR_BUCKET_LABELS[bucket]} days
              </th>
            ))}
            <th scope="col" className="py-2 pr-4 text-right">
              Total
            </th>
          </tr>
        </thead>
        {/* One <tbody> per facility. The name spans the group's three rows as a
            plain <td>: it is there to be seen, and the association it used to
            claim through `scope="rowgroup"` now lives in each row's own
            `<th scope="row">` instead (see `SplitCells`).

            What is claimed here is structural and no more: every figure in this
            table has a row header, in the row it belongs to, naming both the
            facility and which half of the split it is. No announcement is
            asserted and none was observed — this repo does not assert
            screen-reader behaviour nobody has watched, which is what the
            sentence this replaces did. */}
        {rows.map((row) => (
          <tbody key={row.facilityId}>
            <tr className="border-input border-b">
              <td rowSpan={3} className="py-2 pr-4 text-left align-top font-medium">
                {row.facilityName}
              </td>
              <SplitCells group={row.facilityName} label="Being chased" aging={row.split.chased} />
            </tr>
            <tr className="border-input border-b">
              <SplitCells group={row.facilityName} label="Halted" aging={row.split.halted} />
            </tr>
            <tr className="border-input border-b">
              <SplitCells group={row.facilityName} label="Total" aging={row.split.total} />
            </tr>
          </tbody>
        ))}
        {rows.length > 0 && (
          <tfoot>
            <tr className="border-input border-b font-semibold">
              <td rowSpan={3} className="py-2 pr-4 text-left align-top">
                All facilities
              </td>
              <SplitCells group="All facilities" label="Being chased" aging={total.chased} />
            </tr>
            <tr className="border-input border-b font-semibold">
              <SplitCells group="All facilities" label="Halted" aging={total.halted} />
            </tr>
            <tr className="border-input border-b font-semibold">
              <SplitCells group="All facilities" label="Total" aging={total.total} />
            </tr>
          </tfoot>
        )}
      </table>
    </ScrollRegion>
  )
}
