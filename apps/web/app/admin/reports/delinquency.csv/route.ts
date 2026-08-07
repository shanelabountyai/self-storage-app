import { requireStaffActor } from '@/lib/rbac/session'
import { delinquencyDetail } from '@/lib/admin/delinquency-detail'
import { csvCents, toCsv } from '@/lib/admin/csv'

// PRD 02 US-39: "CSV export matching on-screen data exactly."
//
// One row per lease, in the same order the screen shows them — oldest debt
// first. Same function, same sort, same rounding helper.
//
// This is the file that gets handed to a collections agency or attached to a
// lien filing, which is the other reason ended leases stay in it (US-14): a
// former tenant's balance is the one most likely to end up in that envelope.

export async function GET(): Promise<Response> {
  const actor = await requireStaffActor()
  const report = await delinquencyDetail(actor)

  const rows = report.rows.map((row) => [
    row.tenantName,
    row.facilityName,
    row.unitNumber,
    row.leaseStatus,
    row.daysPastDue,
    row.bucket,
    row.dunningStep === 0 ? '' : row.dunningStep,
    row.nextStepDay ?? '',
    csvCents(row.outstandingCents),
  ])

  const csv = toCsv(
    [
      'Tenant',
      'Facility',
      'Unit',
      'Lease status',
      'Days past due',
      'Aging bucket',
      'Dunning step',
      'Next step at (days)',
      'Outstanding',
    ],
    rows,
  )

  const today = new Date().toISOString().slice(0, 10)
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="delinquency-aging-${today}.csv"`,
    },
  })
}
