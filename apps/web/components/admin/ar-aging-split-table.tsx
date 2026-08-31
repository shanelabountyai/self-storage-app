import { AR_BUCKETS, type ArAging, type ArAgingSplit } from '@storage/core/metrics'
import { formatCents } from '@/lib/format'

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
/// The label is a `<th scope="row">` rather than a plain cell, so a screen
/// reader announcing a figure says which half of the split it belongs to.
function SplitCells({ label, aging }: { label: string; aging: ArAging }) {
  return (
    <>
      <th scope="row" className="py-2 pr-4 text-left font-normal">
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
    <div tabIndex={0} className="overflow-x-auto">
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
        {/* One <tbody> per facility, with the name as a `scope="rowgroup"`
            header spanning its three rows. That is what makes the halted row
            announce as "Cedar Park, Halted, 61–90 days" rather than as a row of
            figures with no owner — a rowSpan cell with `scope="row"` would
            claim only the first of the three. */}
        {rows.map((row) => (
          <tbody key={row.facilityId}>
            <tr className="border-input border-b">
              <th
                scope="rowgroup"
                rowSpan={3}
                className="py-2 pr-4 text-left align-top font-medium"
              >
                {row.facilityName}
              </th>
              <SplitCells label="Being chased" aging={row.split.chased} />
            </tr>
            <tr className="border-input border-b">
              <SplitCells label="Halted" aging={row.split.halted} />
            </tr>
            <tr className="border-input border-b">
              <SplitCells label="Total" aging={row.split.total} />
            </tr>
          </tbody>
        ))}
        {rows.length > 0 && (
          <tfoot>
            <tr className="border-input border-b font-semibold">
              <th
                scope="rowgroup"
                rowSpan={3}
                className="py-2 pr-4 text-left align-top"
              >
                All facilities
              </th>
              <SplitCells label="Being chased" aging={total.chased} />
            </tr>
            <tr className="border-input border-b font-semibold">
              <SplitCells label="Halted" aging={total.halted} />
            </tr>
            <tr className="border-input border-b font-semibold">
              <SplitCells label="Total" aging={total.total} />
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  )
}
