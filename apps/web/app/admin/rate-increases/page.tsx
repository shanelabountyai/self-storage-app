import { AdminForm, Field } from '@/components/admin/form'
import { Button } from '@/components/ui/button'
import { getSwitcherData } from '@/lib/admin/context'
import { resolveSelectedFacility } from '@/lib/admin/facility-selection-logic'
import { hasPermissionAnywhere } from '@/lib/rbac/authorize'
import { formatCents } from '@/lib/format'
import { DEFAULT_ELIGIBILITY, earliestEffectiveDate } from '@storage/core/pricing'
import { pendingRateIncreases, previewEligibleIncreases } from '@/lib/pricing/tenant-rate-increases'
import { prisma } from '@storage/db'
import { approveAction, cancelAction, scheduleBatchAction, scheduleOneOffAction } from './actions'

export const metadata = { title: 'Rate increases' }

// PRD 02 §4.3 US-11 (B-076). "A rate-increase review screen shows pending
// increases with projected revenue delta; regional/owner approval is required
// before notices go out."
//
// One screen, three jobs: review-and-approve what is already scheduled, see
// who the rule would pick, and schedule either kind. The approval bar itself
// (regional or owner) is enforced in the service — a site manager sees this
// screen and can build a worklist, but their approval is refused with the
// reason named.

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' }).format(date)
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10)
}

const STATUS_LABEL: Record<string, string> = {
  pending_approval: 'Awaiting approval',
  approved: 'Approved — notice pending',
  notice_sent: 'Notice sent',
}

export default async function RateIncreasesPage() {
  const { actor, facilities, cookieValue, canSeeAll } = await getSwitcherData()

  if (!hasPermissionAnywhere(actor, ['rates:tenant_increase'])) {
    return <p className="text-muted-foreground text-sm">You don&apos;t have access to rate increases.</p>
  }

  const selected = resolveSelectedFacility(cookieValue, facilities, canSeeAll)
  if (selected.mode !== 'single') {
    return (
      <p className="text-muted-foreground text-sm">
        Pick a single facility above — the notice period a rate increase has to give is a
        per-facility setting.
      </p>
    )
  }

  const facilityId = selected.facility.id
  const [review, eligible, facility] = await Promise.all([
    pendingRateIncreases(actor, facilityId),
    previewEligibleIncreases(actor, facilityId),
    prisma.facility.findUniqueOrThrow({
      where: { id: facilityId },
      select: { rateIncreaseNoticeDays: true },
    }),
  ])

  const soonest = isoDay(earliestEffectiveDate(new Date(), facility.rateIncreaseNoticeDays))
  const batchIds = [...new Set(review.rows.map((row) => row.batchId).filter((id): id is string => Boolean(id)))]

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-lg font-semibold">Rate increases — {selected.facility.name}</h1>
        <p className="text-muted-foreground mt-1 max-w-prose text-sm text-pretty">
          This facility gives {facility.rateIncreaseNoticeDays} days&apos; notice, so the soonest an
          increase scheduled today can take effect is {soonest}. Nothing is sent to a tenant until a
          regional manager or owner approves it.
        </p>
      </div>

      <section aria-labelledby="pending-heading" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="pending-heading" className="font-medium">
            Scheduled ({review.rows.length})
          </h2>
          {review.rows.length > 0 && (
            <p className="text-sm">
              Projected monthly change:{' '}
              <span className="font-medium tabular-nums">
                +{formatCents(review.projectedMonthlyDeltaCents)}
              </span>
            </p>
          )}
        </div>

        {review.rows.length === 0 ? (
          <p className="text-muted-foreground text-sm">Nothing scheduled.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-2xl border-collapse text-sm">
              <caption className="sr-only">
                Scheduled tenant rate increases with their current and new rates, dates and status
              </caption>
              <thead>
                <tr className="border-input border-b text-left">
                  <th scope="col" className="py-2 pr-4">Tenant</th>
                  <th scope="col" className="py-2 pr-4">Unit</th>
                  <th scope="col" className="py-2 pr-4 text-right">Now</th>
                  <th scope="col" className="py-2 pr-4 text-right">New</th>
                  <th scope="col" className="py-2 pr-4">Notice on</th>
                  <th scope="col" className="py-2 pr-4">Effective</th>
                  <th scope="col" className="py-2 pr-4">Status</th>
                  <th scope="col" className="py-2 pr-4">Action</th>
                </tr>
              </thead>
              <tbody>
                {review.rows.map((row) => (
                  <tr key={row.id} className="border-input border-b align-top">
                    <th scope="row" className="py-2 pr-4 text-left font-normal">{row.tenantName}</th>
                    <td className="py-2 pr-4">{row.unitNumber}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{formatCents(row.currentRateCents)}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{formatCents(row.newRateCents)}</td>
                    <td className="py-2 pr-4">{formatDate(row.noticeDate)}</td>
                    <td className="py-2 pr-4">{formatDate(row.effectiveDate)}</td>
                    <td className="py-2 pr-4">{STATUS_LABEL[row.status] ?? row.status}</td>
                    <td className="py-2 pr-4">
                      <div className="flex flex-col gap-2">
                        {row.status === 'pending_approval' && (
                          <AdminForm action={approveAction} label={`Approve increase for ${row.tenantName}`} className="flex flex-wrap items-end gap-2">
                            <input type="hidden" name="id" value={row.id} />
                            <Field name="reason" label="Why" className="flex flex-col gap-1 text-xs" />
                            <Button type="submit">Approve</Button>
                          </AdminForm>
                        )}
                        <AdminForm action={cancelAction} label={`Cancel increase for ${row.tenantName}`} className="flex flex-wrap items-end gap-2">
                          <input type="hidden" name="id" value={row.id} />
                          <Field name="reason" label="Why" className="flex flex-col gap-1 text-xs" />
                          <Button type="submit">Cancel</Button>
                        </AdminForm>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {batchIds.length > 0 && (
          <div className="border-input flex flex-col gap-3 rounded-lg border p-4">
            <h3 className="text-sm font-medium">Whole batches</h3>
            <p className="text-muted-foreground text-xs text-pretty">
              A rule-based batch was scheduled as one worklist and can be approved or cancelled as
              one — approving row by row above works too.
            </p>
            {batchIds.map((batchId) => (
              <div key={batchId} className="flex flex-wrap items-end gap-3">
                <AdminForm action={approveAction} label="Approve batch" className="flex flex-wrap items-end gap-2">
                  <input type="hidden" name="batchId" value={batchId} />
                  <Field name="reason" label="Why" className="flex flex-col gap-1 text-xs" />
                  <Button type="submit">Approve batch</Button>
                </AdminForm>
                <AdminForm action={cancelAction} label="Cancel batch" className="flex flex-wrap items-end gap-2">
                  <input type="hidden" name="batchId" value={batchId} />
                  <Field name="reason" label="Why" className="flex flex-col gap-1 text-xs" />
                  <Button type="submit">Cancel batch</Button>
                </AdminForm>
              </div>
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="eligible-heading" className="flex flex-col gap-3">
        <h2 id="eligible-heading" className="font-medium">
          Who the rule would pick ({eligible.length})
        </h2>
        <p className="text-muted-foreground max-w-prose text-xs text-pretty">
          Leases at least {DEFAULT_ELIGIBILITY.minMonthsSinceLastChange} months since their last rate
          change and at least {formatCents(DEFAULT_ELIGIBILITY.minGapCents)} below the current street
          rate, largest gap first. Scheduling a batch raises each of them to street.
        </p>

        {eligible.length === 0 ? (
          <p className="text-muted-foreground text-sm">No lease meets the rule right now.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-2xl border-collapse text-sm">
              <caption className="sr-only">Leases eligible for a rule-based rate increase</caption>
              <thead>
                <tr className="border-input border-b text-left">
                  <th scope="col" className="py-2 pr-4">Tenant</th>
                  <th scope="col" className="py-2 pr-4">Unit</th>
                  <th scope="col" className="py-2 pr-4 text-right">Now</th>
                  <th scope="col" className="py-2 pr-4 text-right">Street</th>
                  <th scope="col" className="py-2 pr-4 text-right">Gap</th>
                  <th scope="col" className="py-2 pr-4 text-right">Months since change</th>
                </tr>
              </thead>
              <tbody>
                {eligible.map((row) => (
                  <tr key={row.leaseId} className="border-input border-b">
                    <th scope="row" className="py-2 pr-4 text-left font-normal">{row.tenantName}</th>
                    <td className="py-2 pr-4">{row.unitNumber}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{formatCents(row.inPlaceRateCents)}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{formatCents(row.streetRateCents)}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{formatCents(row.gapCents)}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{row.monthsSinceLastChange ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <AdminForm action={scheduleBatchAction} label="Schedule the whole eligible batch" className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="facilityId" value={facilityId} />
          <Field
            name="effectiveDate"
            label="Effective date"
            type="date"
            defaultValue={soonest}
            required
            hint={`Must be at least ${facility.rateIncreaseNoticeDays} days out.`}
          />
          <Button type="submit">Schedule batch</Button>
        </AdminForm>
      </section>

      <section aria-labelledby="oneoff-heading" className="flex flex-col gap-3">
        <h2 id="oneoff-heading" className="font-medium">
          Schedule one tenant
        </h2>
        <AdminForm action={scheduleOneOffAction} label="Schedule one rate increase" className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="facilityId" value={facilityId} />
          <Field
            name="leaseId"
            label="Lease ID"
            required
            className="flex flex-col gap-1 text-sm"
            hint="From the tenant's lease page."
          />
          <Field
            name="newRateDollars"
            label="New monthly rate ($)"
            inputMode="decimal"
            required
            hint="Has to be higher than what they pay now."
          />
          <Field
            name="effectiveDate"
            label="Effective date"
            type="date"
            defaultValue={soonest}
            required
          />
          <Button type="submit">Schedule</Button>
        </AdminForm>
      </section>

      <p className="text-muted-foreground max-w-prose text-xs text-pretty">
        The notice email goes out automatically on the notice date and quotes the old rate, the new
        rate, the effective date and the notice period. The new rate is applied to the first invoice
        generated on or after the effective date — an increase whose notice never went out is never
        applied. Draft copy, not legal advice: the notice period your state and lease actually
        require is a question for your attorney.
      </p>
    </div>
  )
}
