import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getAdminActor } from '@/lib/admin/context'
import { auctionCase } from '@/lib/auctions/service'
import { SURPLUS_DISPOSITION_LABELS } from '@storage/core/auctions'
import { TIMELINE_DISCLAIMER } from '@storage/core/delinquency'
import { formatCents } from '@/lib/format'
import {
  addAdvertisementAction,
  approveAction,
  cancelAction,
  recordLockCutAction,
  recordSaleAction,
  scheduleAction,
  setVehicleAction,
  surplusDispositionAction,
  surplusNotifiedAction,
} from '../actions'

export const metadata = { title: 'Auction case' }

// PRD 02 §4.6 US-28 / US-29 (B-062). One lien-sale case.
//
// US-29: "shows the configured timeline summary on every auction approval
// screen", and the persistent disclaimer with it. The blockers are rendered as
// a refusal rather than a warning, because that is what they are — there is no
// override control on this page for the same reason there is none in the
// service.

function formatDate(date: Date | null): string {
  if (!date) return '—'
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' }).format(date)
}

/// Four blank rows to start. An inventory is written standing in a doorway, so
/// the form should not demand a decision about how many lines before the first
/// one can be typed.
const INVENTORY_ROWS = [0, 1, 2, 3]

export default async function AuctionCasePage({
  params,
}: {
  params: Promise<{ caseId: string }>
}) {
  const { caseId } = await params
  const actor = await getAdminActor()
  const view = await auctionCase(actor, caseId).catch(() => null)
  if (!view) notFound()

  const sold = view.status === 'sold'
  const closed = sold || view.status === 'cancelled'

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">
          Unit {view.unitNumber} — {view.tenantName}
        </h1>
        <Link href="/admin/auctions" className="text-sm underline underline-offset-2">
          All cases
        </Link>
      </div>

      <p role="note" className="rounded-lg border-2 border-amber-500 bg-amber-50 p-4 text-sm text-amber-950 text-pretty">
        <strong className="block">Not legal advice.</strong>
        {TIMELINE_DISCLAIMER}
      </p>

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted-foreground">Status</dt>
        <dd className="font-medium">{view.status}</dd>
        <dt className="text-muted-foreground">Balance</dt>
        <dd>{formatCents(view.outstandingCents)}</dd>
        {/* US-29's "configured timeline summary on every auction approval
            screen" — the version pinned to this case, not whatever is current. */}
        <dt className="text-muted-foreground">Timeline</dt>
        <dd>
          {view.timelineLabel ? `${view.timelineLabel} (version ${view.timelineVersion})` : 'None configured'}
        </dd>
        <dt className="text-muted-foreground">Approved</dt>
        <dd>{view.approvedAt ? `${formatDate(view.approvedAt)} by ${view.approvedByName}` : 'Not yet'}</dd>
        <dt className="text-muted-foreground">Sale date</dt>
        <dd>{formatDate(view.scheduledSaleDate)}</dd>
      </dl>

      {view.readiness.blockers.length > 0 && (
        <section aria-labelledby="blockers-heading">
          <h2 id="blockers-heading" className="sr-only">
            Why this sale cannot be scheduled
          </h2>
          <div role="alert" className="rounded-lg border-2 border-red-500 bg-red-50 p-4 text-red-950">
            <p className="font-semibold">
              This sale cannot be scheduled — {view.readiness.blockers.length} outstanding
            </p>
            <ul className="mt-2 list-inside list-disc text-sm">
              {view.readiness.blockers.map((blocker, index) => (
                <li key={`${blocker.kind}-${index}`} className="text-pretty">
                  {blocker.message}
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      <section aria-labelledby="steps-heading" className="flex flex-col gap-3">
        <h2 id="steps-heading" className="text-sm font-medium">
          Step history
        </h2>
        {view.steps.length === 0 ? (
          <p className="text-muted-foreground text-sm">No timeline is pinned to this case.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-max text-left text-sm">
              <thead>
                <tr className="text-muted-foreground">
                  <th scope="col" className="pb-2 font-normal">Day</th>
                  <th scope="col" className="pb-2 font-normal">Step</th>
                  <th scope="col" className="pb-2 font-normal">Ran</th>
                  <th scope="col" className="pb-2 font-normal">Proof</th>
                </tr>
              </thead>
              <tbody>
                {view.steps.map((step) => (
                  <tr key={step.dayOffset} className="border-t">
                    <th scope="row" className="py-2 text-left font-medium">{step.dayOffset}</th>
                    <td className="py-2">{step.label}</td>
                    <td className="py-2">{step.executed ? 'Yes' : 'No'}</td>
                    <td className="py-2">
                      {!step.staffTaskLabel
                        ? 'Automatic'
                        : step.blocked
                          ? 'Missing'
                          : step.task?.status === 'completed'
                            ? 'Recorded'
                            : 'Outstanding'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {!closed && (
        <>
          <section aria-labelledby="vehicle-heading" className="flex flex-col gap-2">
            <h2 id="vehicle-heading" className="text-sm font-medium">
              Contents check
            </h2>
            <p className="text-muted-foreground max-w-prose text-xs text-pretty">
              A vehicle, boat or trailer follows a separate lien process and cannot be sold through
              this pipeline. Flagging one blocks the case outright — there is no override.
            </p>
            <form action={setVehicleAction} className="border-input flex flex-col gap-2 rounded-lg border p-4">
              <input type="hidden" name="caseId" value={caseId} />
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name="containsVehicle"
                  value="yes"
                  defaultChecked={view.containsVehicle}
                  className="h-4 w-4"
                />
                This unit contains a vehicle, boat or trailer
              </label>
              <label className="flex flex-col gap-1 text-sm">
                What was found
                <input
                  name="note"
                  required
                  defaultValue={view.vehicleNote ?? ''}
                  className="border-input bg-background min-h-11 rounded-md border px-3 text-sm"
                />
              </label>
              <button type="submit" className="border-input hover:bg-accent min-h-11 self-start rounded-md border px-4 text-sm font-medium">
                Record
              </button>
            </form>
          </section>

          {!view.approvedAt && !view.containsVehicle && (
            <section aria-labelledby="approve-heading" className="flex flex-col gap-2">
              <h2 id="approve-heading" className="text-sm font-medium">
                Approval
              </h2>
              <p className="text-muted-foreground max-w-prose text-xs text-pretty">
                A regional manager or owner only. A site manager cannot approve the sale of their own
                site&apos;s tenant.
              </p>
              <form action={approveAction} className="border-input flex flex-wrap items-end gap-2 rounded-lg border p-4">
                <input type="hidden" name="caseId" value={caseId} />
                <label className="flex flex-1 flex-col gap-1 text-sm">
                  Why this sale is approved
                  <input
                    name="reasonCode"
                    required
                    className="border-input bg-background min-h-11 rounded-md border px-3 text-sm"
                  />
                </label>
                <button type="submit" className="border-input hover:bg-accent min-h-11 rounded-md border px-4 text-sm font-medium">
                  Approve
                </button>
              </form>
            </section>
          )}

          <section aria-labelledby="ads-heading" className="flex flex-col gap-2">
            <h2 id="ads-heading" className="text-sm font-medium">
              Advertising ({view.advertisements.length})
            </h2>
            {view.advertisements.length > 0 && (
              <ul className="text-sm">
                {view.advertisements.map((ad) => (
                  <li key={ad.id}>
                    {ad.publication} — {formatDate(ad.runDate)}
                    {ad.reference && ` (${ad.reference})`}
                  </li>
                ))}
              </ul>
            )}
            <form action={addAdvertisementAction} className="border-input flex flex-wrap items-end gap-2 rounded-lg border p-4">
              <input type="hidden" name="caseId" value={caseId} />
              <label className="flex flex-col gap-1 text-sm">
                Publication or site
                <input name="publication" required className="border-input bg-background min-h-11 rounded-md border px-3 text-sm" />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Run date
                <input name="runDate" type="date" required className="border-input bg-background min-h-11 rounded-md border px-3 text-sm" />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Reference
                <input name="reference" className="border-input bg-background min-h-11 rounded-md border px-3 text-sm" />
              </label>
              <button type="submit" className="border-input hover:bg-accent min-h-11 rounded-md border px-4 text-sm font-medium">
                Add run
              </button>
            </form>
          </section>

          {view.readiness.ready && view.status === 'eligible' && (
            <section aria-labelledby="schedule-heading" className="flex flex-col gap-2">
              <h2 id="schedule-heading" className="text-sm font-medium">
                Schedule the sale
              </h2>
              <form action={scheduleAction} className="border-input flex flex-wrap items-end gap-2 rounded-lg border p-4">
                <input type="hidden" name="caseId" value={caseId} />
                <label className="flex flex-col gap-1 text-sm">
                  Sale date
                  <input name="saleDate" type="date" required className="border-input bg-background min-h-11 rounded-md border px-3 text-sm" />
                </label>
                <button type="submit" className="border-input hover:bg-accent min-h-11 rounded-md border px-4 text-sm font-medium">
                  Schedule
                </button>
              </form>
            </section>
          )}

          {view.status === 'scheduled' && !view.lockCutAt && (
            <section aria-labelledby="lockcut-heading" className="flex flex-col gap-2">
              <h2 id="lockcut-heading" className="text-sm font-medium">
                Lock cut and contents inventory
              </h2>
              <p className="text-muted-foreground max-w-prose text-xs text-pretty">
                The primary evidence that you sold what you said you sold. Recorded once, hashed, and
                never editable afterwards — every line needs a photograph.
              </p>
              <form action={recordLockCutAction} className="border-input flex flex-col gap-3 rounded-lg border p-4">
                <input type="hidden" name="caseId" value={caseId} />
                <label className="flex flex-col gap-1 text-sm">
                  What happened to the tenant&apos;s lock
                  <input name="oldLockDisposition" required className="border-input bg-background min-h-11 rounded-md border px-3 text-sm" />
                </label>
                <fieldset className="flex flex-col gap-2">
                  <legend className="text-sm">Contents</legend>
                  {INVENTORY_ROWS.map((row) => (
                    <div key={row} className="flex flex-wrap gap-2">
                      <label className="flex flex-1 flex-col gap-1 text-xs">
                        Item {row + 1}
                        <input name="itemDescription" className="border-input bg-background min-h-11 rounded-md border px-3 text-sm" />
                      </label>
                      <label className="flex flex-1 flex-col gap-1 text-xs">
                        Photograph reference {row + 1}
                        <input name="itemPhoto" className="border-input bg-background min-h-11 rounded-md border px-3 text-sm" />
                      </label>
                    </div>
                  ))}
                </fieldset>
                <button type="submit" className="border-input hover:bg-accent min-h-11 self-start rounded-md border px-4 text-sm font-medium">
                  Record the cut and inventory
                </button>
              </form>
            </section>
          )}

          {view.status === 'scheduled' && view.lockCutAt && (
            <section aria-labelledby="sale-heading" className="flex flex-col gap-2">
              <h2 id="sale-heading" className="text-sm font-medium">
                Record the sale
              </h2>
              <p className="text-muted-foreground max-w-prose text-xs text-pretty">
                Enter what the sale raised and what it cost. The system applies sale costs, then the
                lien balance, then the surplus — and posts the ledger entries itself.
              </p>
              <form action={recordSaleAction} className="border-input flex flex-col gap-3 rounded-lg border p-4">
                <input type="hidden" name="caseId" value={caseId} />
                <div className="flex flex-wrap gap-2">
                  <label className="flex flex-col gap-1 text-sm">
                    Sale date
                    <input name="soldAt" type="date" required className="border-input bg-background min-h-11 rounded-md border px-3 text-sm" />
                  </label>
                  <label className="flex flex-col gap-1 text-sm">
                    Gross proceeds ($)
                    <input name="grossProceeds" inputMode="decimal" required className="border-input bg-background min-h-11 rounded-md border px-3 text-sm" />
                  </label>
                  <label className="flex flex-col gap-1 text-sm">
                    Sale costs ($)
                    <input name="saleCosts" inputMode="decimal" defaultValue="0" className="border-input bg-background min-h-11 rounded-md border px-3 text-sm" />
                  </label>
                </div>
                <fieldset className="flex flex-col gap-2">
                  <legend className="text-sm font-medium">Buyer</legend>
                  <p className="text-muted-foreground text-xs text-pretty">
                    A sales-tax return on auction proceeds cannot be filed without this.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <label className="flex flex-1 flex-col gap-1 text-xs">
                      Name
                      <input name="buyerName" required className="border-input bg-background min-h-11 rounded-md border px-3 text-sm" />
                    </label>
                    <label className="flex flex-1 flex-col gap-1 text-xs">
                      Address
                      <input name="buyerAddressLine1" required className="border-input bg-background min-h-11 rounded-md border px-3 text-sm" />
                    </label>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <label className="flex flex-1 flex-col gap-1 text-xs">
                      City
                      <input name="buyerCity" required className="border-input bg-background min-h-11 rounded-md border px-3 text-sm" />
                    </label>
                    <label className="flex flex-col gap-1 text-xs">
                      State
                      <input name="buyerState" required maxLength={2} className="border-input bg-background min-h-11 w-20 rounded-md border px-3 text-sm" />
                    </label>
                    <label className="flex flex-col gap-1 text-xs">
                      Postal code
                      <input name="buyerPostalCode" required className="border-input bg-background min-h-11 w-32 rounded-md border px-3 text-sm" />
                    </label>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <label className="flex flex-1 flex-col gap-1 text-xs">
                      Government ID reference
                      <input
                        name="buyerGovernmentIdReference"
                        required
                        placeholder="TX DL ****1234"
                        className="border-input bg-background min-h-11 rounded-md border px-3 text-sm"
                      />
                    </label>
                    <label className="flex flex-1 flex-col gap-1 text-xs">
                      Payment method
                      <input name="buyerPaymentMethod" required className="border-input bg-background min-h-11 rounded-md border px-3 text-sm" />
                    </label>
                  </div>
                  <p className="text-muted-foreground text-xs text-pretty">
                    A reference, never the number itself — enough to find the record, not enough to
                    become a breach.
                  </p>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="buyerTaxExempt" className="h-4 w-4" />
                    Buyer claims sales-tax exemption
                  </label>
                  <label className="flex flex-col gap-1 text-xs">
                    Resale certificate reference (required if exempt)
                    <input name="buyerResaleCertificateReference" className="border-input bg-background min-h-11 rounded-md border px-3 text-sm" />
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <label className="flex flex-col gap-1 text-xs">
                      Cleanout deadline
                      <input name="buyerCleanoutDeadline" type="date" required className="border-input bg-background min-h-11 rounded-md border px-3 text-sm" />
                    </label>
                    <label className="flex flex-1 flex-col gap-1 text-xs">
                      Forfeit terms
                      <input
                        name="buyerForfeitTerms"
                        defaultValue="Contents left after the deadline are forfeit."
                        className="border-input bg-background min-h-11 rounded-md border px-3 text-sm"
                      />
                    </label>
                  </div>
                </fieldset>
                <button type="submit" className="border-input hover:bg-accent min-h-11 self-start rounded-md border px-4 text-sm font-medium">
                  Record the sale
                </button>
              </form>
            </section>
          )}

          <section aria-labelledby="cancel-heading" className="flex flex-col gap-2">
            <h2 id="cancel-heading" className="text-sm font-medium">
              Cancel
            </h2>
            <form action={cancelAction} className="border-input flex flex-wrap items-end gap-2 rounded-lg border p-4">
              <input type="hidden" name="caseId" value={caseId} />
              <label className="flex flex-1 flex-col gap-1 text-sm">
                Why (the tenant paid, a mistake, something else)
                <input name="reason" required className="border-input bg-background min-h-11 rounded-md border px-3 text-sm" />
              </label>
              <button type="submit" className="border-input hover:bg-accent min-h-11 rounded-md border px-4 text-sm font-medium">
                Cancel this sale
              </button>
            </form>
          </section>
        </>
      )}

      {sold && (
        <section aria-labelledby="outcome-heading" className="flex flex-col gap-3">
          <h2 id="outcome-heading" className="text-sm font-medium">
            Outcome
          </h2>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted-foreground">Sold</dt>
            <dd>{formatDate(view.sale.soldAt)}</dd>
            <dt className="text-muted-foreground">Gross proceeds</dt>
            <dd>{formatCents(view.sale.grossProceedsCents ?? 0)}</dd>
            <dt className="text-muted-foreground">Sale costs recovered</dt>
            <dd>{formatCents(view.sale.costsRecoveredCents ?? 0)}</dd>
            <dt className="text-muted-foreground">Applied to the lien</dt>
            <dd>{formatCents(view.sale.appliedToLienCents ?? 0)}</dd>
            <dt className="text-muted-foreground">Surplus</dt>
            <dd>{formatCents(view.sale.surplusCents ?? 0)}</dd>
            {(view.sale.deficiencyCents ?? 0) > 0 && (
              <>
                <dt className="text-muted-foreground">Still owed</dt>
                <dd>{formatCents(view.sale.deficiencyCents ?? 0)}</dd>
              </>
            )}
          </dl>

          {(view.sale.surplusCents ?? 0) > 0 && (
            <div className="border-input flex flex-col gap-3 rounded-lg border p-4">
              <p className="text-sm font-medium">
                Surplus: {SURPLUS_DISPOSITION_LABELS[view.surplus.disposition]}
              </p>
              {view.surplus.outstanding && (
                <ul className="list-inside list-disc text-sm text-pretty">
                  {view.surplus.outstandingActions.map((action) => (
                    <li key={action}>{action}</li>
                  ))}
                </ul>
              )}
              {view.surplus.outstanding && !view.surplus.notifiedAt && (
                <form action={surplusNotifiedAction}>
                  <input type="hidden" name="caseId" value={caseId} />
                  <button type="submit" className="border-input hover:bg-accent min-h-11 rounded-md border px-4 text-sm font-medium">
                    Record that the former tenant was notified
                  </button>
                </form>
              )}
              {view.surplus.outstanding && (
                <form action={surplusDispositionAction} className="flex flex-wrap items-end gap-2">
                  <input type="hidden" name="caseId" value={caseId} />
                  <label className="flex flex-col gap-1 text-sm">
                    Disposition
                    <select name="disposition" className="border-input bg-background min-h-11 rounded-md border px-3 text-sm">
                      <option value="claimed">Claimed by the former tenant</option>
                      <option value="remitted">Remitted to the state</option>
                    </select>
                  </label>
                  <label className="flex flex-1 flex-col gap-1 text-sm">
                    Where the money went
                    <input name="note" required className="border-input bg-background min-h-11 rounded-md border px-3 text-sm" />
                  </label>
                  <button type="submit" className="border-input hover:bg-accent min-h-11 rounded-md border px-4 text-sm font-medium">
                    Record
                  </button>
                </form>
              )}
              {!view.surplus.outstanding && view.surplus.note && (
                <p className="text-muted-foreground text-sm text-pretty">{view.surplus.note}</p>
              )}
            </div>
          )}
        </section>
      )}

      {view.status === 'cancelled' && (
        <p className="border-input rounded-lg border p-4 text-sm text-pretty">
          Cancelled {formatDate(view.cancelledAt)} — {view.cancelledReason}
        </p>
      )}
    </div>
  )
}
