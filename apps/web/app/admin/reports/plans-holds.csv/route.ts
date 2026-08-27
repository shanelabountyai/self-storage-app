import { requireStaffActor } from '@/lib/rbac/session'
import { plansAndHoldsReport } from '@/lib/admin/plans-holds-report'
import { csvCents, toCsv } from '@/lib/admin/csv'

// PRD 02 §8: "every report exportable to CSV", and US-39: "CSV export matching
// on-screen data exactly." Same function, same facility grouping, same
// longest-halted-first order the screen renders.
//
// The halted LIST only — not the plan-effectiveness figures, which are a
// per-facility summary for a chosen month and would be a second table with
// different columns inside one file. The period is why: this export answers
// for now, like the list it mirrors (D-65), and a file carrying both would be
// a file where half the rows answer for a month and half do not.

export async function GET(): Promise<Response> {
  const actor = await requireStaffActor()
  // The period only governs the effectiveness figures, which this file does
  // not carry — so any month does, and "this month" is the honest one to pass.
  const now = new Date()
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
  const report = await plansAndHoldsReport(actor, monthStart, monthEnd, now)

  const rows = report.facilities.flatMap((facility) =>
    facility.rows.map((row) => [
      row.tenantName,
      facility.facilityName,
      row.unitNumber,
      row.leaseStatus,
      row.holdLabels.join('; '),
      row.otherHoldLabels.join('; '),
      row.haltedSince.toISOString().slice(0, 10),
      row.daysHalted,
      row.plan ? row.plan.status : 'none',
      row.plan ? csvCents(row.plan.totalCents) : '',
      row.plan ? csvCents(row.plan.collectedCents) : '',
      row.plan?.nextInstallment ? row.plan.nextInstallment.dueDate.toISOString().slice(0, 10) : '',
      row.plan?.nextInstallment ? csvCents(row.plan.nextInstallment.amountCents) : '',
      row.plan ? row.plan.missedCount : '',
      csvCents(row.deferredCents),
    ]),
  )

  const csv = toCsv(
    [
      'Tenant',
      'Facility',
      'Unit',
      'Lease status',
      'Halted by',
      'Other holds',
      'Halted since',
      'Days halted',
      'Plan status',
      'Plan total',
      'Collected under plan',
      'Next installment due',
      'Next installment amount',
      'Installments missed',
      'Deferred',
    ],
    rows,
  )

  const today = new Date().toISOString().slice(0, 10)
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="plans-and-holds-${today}.csv"`,
    },
  })
}
