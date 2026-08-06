import { getAdminActor } from '@/lib/admin/context'
import { leaseLedger } from '@/lib/admin/ledger'
import { csvCents, toCsv } from '@/lib/admin/csv'

// US-24's export. Generated from the identical call the screen makes, so the
// two cannot diverge — the structural guarantee B-042 established for the
// occupancy exports rather than a second query shaped close enough.
//
// `force-dynamic` because this is per-tenant money; a cached copy served to the
// next request would be someone else's ledger.
export const dynamic = 'force-dynamic'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ tenantId: string; leaseId: string }> },
) {
  const { tenantId, leaseId } = await params
  const actor = await getAdminActor()
  const ledger = await leaseLedger(actor, leaseId)
  if (!ledger || ledger.tenantId !== tenantId) {
    return new Response('Not found', { status: 404 })
  }

  const csv = toCsv(
    ['Date', 'Type', 'Description', 'Invoice', 'Amount', 'Balance'],
    ledger.lines.map((line) => [
      line.occurredAt.toISOString().slice(0, 10),
      line.kind,
      line.description,
      line.invoiceNumber ?? '',
      csvCents(line.amountCents),
      csvCents(line.balanceCents),
    ]),
  )

  return new Response(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="ledger-${ledger.unitNumber}-${leaseId}.csv"`,
      // Money keyed to one tenant has no business in a shared cache.
      'cache-control': 'private, no-store',
    },
  })
}
