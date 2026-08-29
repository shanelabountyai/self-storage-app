import Link from 'next/link'
import { getSwitcherData } from '@/lib/admin/context'
import { resolveSelectedFacility } from '@/lib/admin/facility-selection-logic'
import { hasPermissionAnywhere } from '@/lib/rbac/authorize'
import { auctionCasesFor, auctionLotSheet, outstandingSurpluses } from '@/lib/auctions/service'
import { formatCents } from '@/lib/format'

export const metadata = { title: 'Auctions' }

// PRD 02 §4.6 US-28 (B-062). "An Auction Pipeline screen lists auction-eligible
// leases with full step history, pending approvals, scheduled sale date, and
// advertising record fields."
//
// The surplus list at the bottom is the other half of the AC that has no home
// otherwise: "surplus quietly retained is how a routine auction becomes a
// class-action-shaped problem." It stays on this screen until somebody records
// where the money went.

function formatDate(date: Date | null): string {
  if (!date) return '—'
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' }).format(date)
}

export default async function AuctionsPage() {
  const { actor, facilities, cookieValue, canSeeAll } = await getSwitcherData()

  if (!hasPermissionAnywhere(actor, ['auctions:approve'])) {
    return <p className="text-muted-foreground text-sm">You don&apos;t have access to auctions.</p>
  }

  const selected = resolveSelectedFacility(cookieValue, facilities, canSeeAll)
  if (selected.mode !== 'single') {
    return (
      <p className="text-muted-foreground text-sm">
        Pick a single facility above — a lien sale is governed by the state its facility is in.
      </p>
    )
  }

  const facilityId = selected.facility.id
  const [cases, surpluses, sheet] = await Promise.all([
    auctionCasesFor(actor, facilityId),
    outstandingSurpluses(actor, facilityId),
    auctionLotSheet(actor, facilityId),
  ])

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-lg font-semibold">Auctions — {selected.facility.name}</h1>
        <p className="text-muted-foreground mt-1 max-w-prose text-sm text-pretty">
          Leases the delinquency timeline has flagged. Nothing here can be scheduled until every
          required step has its proof.
        </p>
      </div>

      {surpluses.length > 0 && (
        <section aria-labelledby="surplus-heading" className="flex flex-col gap-3">
          <h2 id="surplus-heading" className="text-sm font-medium">
            Surpluses still held ({surpluses.length})
          </h2>
          <p className="text-muted-foreground max-w-prose text-xs text-pretty">
            A surplus is money owed to the former tenant, not revenue. It has to be paid to them or
            remitted to the state.
          </p>
          <ul className="flex flex-col gap-2">
            {surpluses.map((surplus) => (
              <li
                key={surplus.caseId}
                className={
                  surplus.overdue
                    ? 'rounded-lg border-2 border-red-500 p-3 text-sm'
                    : 'border-input rounded-lg border p-3 text-sm'
                }
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Link href={`/admin/auctions/${surplus.caseId}`} className="font-medium underline underline-offset-2">
                    Unit {surplus.unitNumber} · {surplus.surplusLabel}
                  </Link>
                  {/* 1.4.1: the state is text, not a colour. */}
                  {surplus.overdue ? (
                    <span className="rounded-md border border-red-300 bg-red-50 px-2 py-1 text-xs font-medium text-red-900">
                      Holding period expired
                    </span>
                  ) : (
                    <span className="text-muted-foreground text-xs">
                      Held until {formatDate(surplus.holdUntil)}
                    </span>
                  )}
                </div>
                <ul className="text-muted-foreground mt-1 list-inside list-disc text-xs">
                  {surplus.outstandingActions.map((action) => (
                    <li key={action}>{action}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* PRD 02 §4.6 US-30 (B-129). The advertising half of US-30 that does not
          depend on an unanswered question. There is deliberately no marketplace
          integration here: master PRD §11 OQ-9 (live on-site versus online) has
          never been answered and D-63 refuses to answer it by building for it.
          What this is, is the sheet an operator uploads, hands to an auctioneer
          or reads to a newspaper — useful whichever way OQ-9 goes.

          The refusal list is the load-bearing part, not the download. A lot
          goes up days before the sale, and in between the tenant may pay, an
          SCRA or bankruptcy hold may land, or somebody may record a titled
          vehicle — each of which leaves `status` at `scheduled` and makes the
          advertisement wrong. Those cases are off the sheet, and this says so
          by name rather than leaving a short file to be noticed. */}
      {sheet && (
        <section aria-labelledby="lots-heading" className="flex flex-col gap-3">
          <h2 id="lots-heading" className="text-sm font-medium">
            Advertising the sale
          </h2>

          {sheet.lots.length === 0 ? (
            <p className="text-muted-foreground text-sm text-pretty">
              No sale here is ready to advertise. A lot is only on the sheet once it is scheduled,
              carries a sale date, and still clears every check the case screen refuses on.
            </p>
          ) : (
            <p className="text-sm text-pretty">
              <a
                href={`/admin/auctions/lots.csv?facility=${facilityId}`}
                className="underline underline-offset-2"
              >
                Download the lot sheet ({sheet.lots.length} lot
                {sheet.lots.length === 1 ? '' : 's'})
              </a>{' '}
              <span className="text-muted-foreground">
                — lot, address, size, sale date and terms, as a CSV you upload or hand over.
                Downloading it is not a record that an advertisement ran; add that on the case once
                it has.
              </span>
            </p>
          )}

          {sheet.facility.saleTerms === null && (
            <p role="note" className="border-input rounded-lg border p-3 text-sm text-pretty">
              <strong className="font-medium">No terms of sale are set for this facility</strong>,
              so the Terms column is blank. Set them in{' '}
              <Link
                href="/admin/settings/delinquency"
                className="underline underline-offset-2"
              >
                delinquency settings
              </Link>
              .
            </p>
          )}

          {sheet.refused.length > 0 && (
            <div className="border-input rounded-lg border p-3">
              <h3 className="text-sm font-medium">
                Not on the sheet ({sheet.refused.length})
              </h3>
              <ul className="mt-2 flex flex-col gap-2 text-sm">
                {sheet.refused.map((refusal) => (
                  <li key={refusal.caseId}>
                    <Link
                      href={`/admin/auctions/${refusal.caseId}`}
                      className="font-medium underline underline-offset-2"
                    >
                      Unit {refusal.unitNumber}
                    </Link>{' '}
                    <span className="text-muted-foreground text-pretty">{refusal.reason}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      <section aria-labelledby="cases-heading" className="flex flex-col gap-3">
        <h2 id="cases-heading" className="text-sm font-medium">
          Open cases ({cases.length})
        </h2>

        {cases.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No leases are flagged for auction at this facility.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {cases.map((one) => (
              <li key={one.id} className="border-input rounded-lg border p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <Link href={`/admin/auctions/${one.id}`} className="font-medium underline underline-offset-2">
                      Unit {one.unitNumber} · {one.tenantName}
                    </Link>
                    <p className="text-muted-foreground text-sm">
                      Owes {formatCents(one.outstandingCents)}
                      {one.scheduledSaleDate && ` · sale ${formatDate(one.scheduledSaleDate)}`}
                    </p>
                  </div>
                  {one.containsVehicle ? (
                    <span className="rounded-md border border-red-300 bg-red-50 px-2 py-1 text-xs font-medium text-red-900">
                      Blocked — vehicle
                    </span>
                  ) : one.readiness.ready ? (
                    <span className="rounded-md border border-green-300 bg-green-50 px-2 py-1 text-xs font-medium text-green-900">
                      Ready to schedule
                    </span>
                  ) : (
                    <span className="rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-900">
                      {one.readiness.blockers.length} blocker
                      {one.readiness.blockers.length === 1 ? '' : 's'}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
