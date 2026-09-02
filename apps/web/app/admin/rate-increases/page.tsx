import { ScrollRegion } from '@/components/ui/scroll-region'
import Link from 'next/link'
import { AdminForm, Field } from '@/components/admin/form'
import { Button } from '@/components/ui/button'
import { getSwitcherData } from '@/lib/admin/context'
import { resolveSelectedFacility } from '@/lib/admin/facility-selection-logic'
import { can, hasPermissionAnywhere } from '@/lib/rbac/authorize'
import { rateIncreaseApprovalRollup } from '@/lib/admin/rollups'
import { FacilityRollup } from '@/components/admin/facility-rollup'
import { formatCents } from '@/lib/format'
import { earliestEffectiveDate } from '@storage/core/pricing'
import {
  activeLeaseOptions,
  ecriPolicyFor,
  pendingRateIncreases,
  previewEligibleIncreases,
  type LeaseOption,
} from '@/lib/pricing/tenant-rate-increases'
import { prisma } from '@storage/db'
import {
  approveAction,
  cancelAction,
  renoticeAction,
  scheduleBatchAction,
  scheduleDecreaseAction,
  scheduleOneOffAction,
} from './actions'

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

/// Hundredths of a percent as a person reads them: 1000 → "10%", 750 →
/// "7.5%". Trailing zeros dropped, because "10.00%" in a sentence reads as a
/// figure someone measured rather than one they chose.
function formatPercent(basisPoints: number): string {
  return `${String(Number((basisPoints / 100).toFixed(2)))}%`
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10)
}

const STATUS_LABEL: Record<string, string> = {
  pending_approval: 'Awaiting approval',
  approved: 'Approved — notice pending',
  notice_sent: 'Notice sent',
  notice_failed: 'On hold — notice did not arrive',
}

/// B-152 / D-88, rewritten by B-166. What the operator has to do about a held
/// increase, said in the row rather than only in the task queue: the increase
/// will never apply on its own, so a status with no next step reads as a
/// warning instead of an instruction.
///
/// The copy used to say "cancel this and schedule it again", which was true
/// and was the defect — it described re-typing a lease id into a free-text
/// form and re-deriving the delta by hand, per row. Re-notice does that, so
/// the sentence now names the one thing the operator has to do first.
const NOTICE_FAILURE_HELP: Record<string, string> = {
  undeliverable:
    'The notice bounced or the address is suppressed. Correct the tenant’s contact details, then re-notice — the increase keeps its figures and the notice period restarts.',
  no_send_record:
    'No notice was ever sent for this increase. Check the tenant can be reached, then re-notice.',
}

/// B-177. One <option> list, rendered by both money forms — the picker that
/// replaced a free-text "Lease ID" on each of them.
function leaseOptions(options: LeaseOption[]) {
  return (
    <>
      <option value="">Choose a tenant…</option>
      {options.map((option) => (
        <option key={option.id} value={option.id}>
          {option.tenantName} — unit {option.unitNumber} — {formatCents(option.monthlyRateCents)}/mo now
        </option>
      ))}
    </>
  )
}

export default async function RateIncreasesPage({
  searchParams,
}: {
  searchParams: Promise<{ raise?: string; lower?: string; rate?: string; facility?: string }>
}) {
  const params = await searchParams
  const { actor, facilities, cookieValue, canSeeAll } = await getSwitcherData()

  // B-153. Two authorities reach this screen: `rates:tenant_increase` raises
  // rates (regional and above by seed), `credits:manual` lowers one as a
  // retention save (manager and above). A manager sees the worklist and the
  // save form and none of the increase machinery.
  if (!hasPermissionAnywhere(actor, ['rates:tenant_increase', 'credits:manual'])) {
    return <p className="text-muted-foreground text-sm">You don&apos;t have access to rate changes.</p>
  }

  // B-235. Same drill-in as the other roll-up screens.
  const requested = params.facility ? facilities.find((one) => one.id === params.facility) : undefined
  const selected = requested
    ? { mode: 'single' as const, facility: requested }
    : resolveSelectedFacility(cookieValue, facilities, canSeeAll)
  if (selected.mode !== 'single') {
    return (
      <div className="flex flex-col gap-4">
        <FacilityRollup
          heading="Rate changes waiting for approval"
          rows={await rateIncreaseApprovalRollup(actor)}
        />
        <p className="text-muted-foreground text-sm">
          Open a facility to approve its batch — the notice period a rate increase has to give is a
          per-facility setting, so there is no combined worklist.
        </p>
      </div>
    )
  }

  const facilityId = selected.facility.id
  const canRaise = can(actor, 'rates:tenant_increase', facilityId)
  // B-177. The same gate `checkMonetaryAuthority('credit', …)` applies inside
  // `scheduleRateDecrease`, hoisted so the section is hidden rather than shown
  // and refused — and so the lease picker, which needs one of the two
  // authorities AT THIS FACILITY, is only asked for when one is held.
  const canLower = can(actor, 'credits:manual', facilityId)
  // B-165. The policy is loaded first and PASSED to the preview, rather than
  // each of them reading it separately: the table below states the rule it
  // was computed under, and the two must be the same read.
  const policy = await ecriPolicyFor(facilityId)
  const [review, eligible, facility, leases] = await Promise.all([
    pendingRateIncreases(actor, facilityId),
    canRaise ? previewEligibleIncreases(actor, facilityId, policy) : Promise.resolve([]),
    prisma.facility.findUniqueOrThrow({
      where: { id: facilityId },
      select: { rateIncreaseNoticeDays: true },
    }),
    // B-177. Replaces the free-text "Lease ID" both money forms used to take.
    canRaise || canLower ? activeLeaseOptions(actor, facilityId) : Promise.resolve([]),
  ])

  // A prefill only counts if it names a lease that is actually in the list —
  // otherwise the rate travelling beside it would render into the form beside
  // no tenant at all.
  const prefillRaise = leases.find((lease) => lease.id === params.raise)?.id
  const prefillLower = leases.find((lease) => lease.id === params.lower)?.id
  const prefillRate = prefillRaise && /^\d+(\.\d{1,2})?$/.test(params.rate ?? '') ? params.rate : undefined

  const soonestDate = earliestEffectiveDate(new Date(), facility.rateIncreaseNoticeDays)
  const soonest = isoDay(soonestDate)
  // B-177. A batch's controls are named by what the batch holds rather than by
  // the word "batch" repeated: two batches side by side gave a rotor "Approve
  // batch, Cancel batch, Approve batch, Cancel batch" (2.4.6). Every row in a
  // batch shares one effective date — `scheduleEligibleBatch` takes exactly one.
  const batches = [
    ...new Set(review.rows.map((row) => row.batchId).filter((id): id is string => Boolean(id))),
  ].map((id) => {
    const rows = review.rows.filter((row) => row.batchId === id)
    return {
      id,
      label: `${rows.length} increase${rows.length === 1 ? '' : 's'} effective ${formatDate(rows[0].effectiveDate)}`,
    }
  })
  const heldCount = review.rows.filter((row) => row.status === 'notice_failed').length

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-lg font-semibold">Rate changes — {selected.facility.name}</h1>
        <p className="text-muted-foreground mt-1 max-w-prose text-sm text-pretty">
          This facility gives {facility.rateIncreaseNoticeDays} days&apos; notice, so the soonest an
          increase scheduled today can take effect is {formatDate(soonestDate)}. Nothing is sent to a
          tenant until a regional manager or owner approves it.
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
                {/* B-153: the sign is no longer always plus. A retention save
                    scheduled beside an increase nets off here, and a hardcoded
                    "+" in front of a negative figure is the kind of number an
                    approver acts on without reading. */}
                {review.projectedMonthlyDeltaCents >= 0 ? '+' : '−'}
                {formatCents(Math.abs(review.projectedMonthlyDeltaCents))}
              </span>
            </p>
          )}
        </div>

        {review.rows.length === 0 ? (
          <p className="text-muted-foreground text-sm">Nothing scheduled.</p>
        ) : (
          <ScrollRegion aria-label="Scheduled rate increases">
            <table className="w-full min-w-2xl border-collapse text-sm">
              <caption className="sr-only">
                Scheduled tenant rate increases with their current and new rates, dates and status
              </caption>
              <thead>
                <tr className="border-input border-b text-left">
                  <th scope="col" className="py-2 pr-4">Tenant</th>
                  <th scope="col" className="py-2 pr-4">Unit</th>
                  {/* B-177. A money column headed "Now" is a figure with no
                      unit — these are monthly rents, not balances. */}
                  <th scope="col" className="py-2 pr-4 text-right">Now ($/mo)</th>
                  <th scope="col" className="py-2 pr-4 text-right">New ($/mo)</th>
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
                    <td className="py-2 pr-4">
                      {row.isDecrease && row.status === 'approved'
                        ? 'Retention save — applies on its date'
                        : (STATUS_LABEL[row.status] ?? row.status)}
                      {row.status === 'notice_failed' && (
                        <span className="text-muted-foreground mt-1 block text-xs text-pretty">
                          {NOTICE_FAILURE_HELP[row.noticeFailureReason ?? ''] ??
                            'This increase is on hold until the tenant has been given notice.'}
                        </span>
                      )}
                      {/* B-166. The pair reads as one attempt to notice one
                          increase, not as a second increase on the same
                          tenant — which is what an approver would otherwise
                          see a fortnight after cancelling the first. */}
                      {row.renoticedFromId && (
                        <span className="text-muted-foreground mt-1 block text-xs text-pretty">
                          Re-noticed after an earlier notice did not arrive.
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-4">
                      <div className="flex flex-col gap-2">
                        {row.status === 'pending_approval' && canRaise && (
                          <AdminForm action={approveAction} label={`Approve increase for ${row.tenantName}`} className="flex flex-wrap items-end gap-2">
                            <input type="hidden" name="id" value={row.id} />
                            <Field name="reason" label="Why" className="flex flex-col gap-1 text-xs" />
                            {/* B-177. "Approve" and "Cancel" rendered once
                                per row with identical accessible names and
                                identical styling side by side, so the rotor
                                read "Approve, Cancel, Approve, Cancel…" and
                                the destructive one was a row-misread away
                                (2.4.6). The form's own label buys nothing —
                                no screen reader composes it into a
                                descendant's name. */}
                            <Button type="submit" aria-label={`Approve increase for ${row.tenantName}, unit ${row.unitNumber}`}>
                              Approve
                            </Button>
                          </AdminForm>
                        )}
                        {/* B-166 / D-88. The way back. Named after its
                            subject rather than repeating "Re-notice" down the
                            column (2.4.6), and the outcome — including the
                            refusal when the tenant still has the address that
                            bounced — is announced from `AdminForm`'s live
                            region, which is mounted with the page rather than
                            inserted on submit (4.1.3). */}
                        {row.status === 'notice_failed' && canRaise && (
                          <AdminForm action={renoticeAction} label={`Re-notice increase for ${row.tenantName}`} className="flex flex-wrap items-end gap-2">
                            <input type="hidden" name="id" value={row.id} />
                            <Field name="reason" label="Why" className="flex flex-col gap-1 text-xs" />
                            <Button type="submit" aria-label={`Re-notice increase for ${row.tenantName}, unit ${row.unitNumber}`}>
                              Re-notice
                            </Button>
                          </AdminForm>
                        )}
                        <AdminForm action={cancelAction} label={`Cancel increase for ${row.tenantName}`} className="flex flex-wrap items-end gap-2">
                          <input type="hidden" name="id" value={row.id} />
                          <Field name="reason" label="Why" className="flex flex-col gap-1 text-xs" />
                          <Button
                            type="submit"
                            variant="destructive"
                            aria-label={`Cancel increase for ${row.tenantName}, unit ${row.unitNumber}`}
                          >
                            Cancel
                          </Button>
                        </AdminForm>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollRegion>
        )}

        {heldCount > 0 && canRaise && (
          <div className="border-input flex flex-col gap-3 rounded-lg border p-4">
            <h3 className="text-sm font-medium">
              On hold for an undelivered notice ({heldCount})
            </h3>
            {/* Why this exists as a batch at all: the usual cause is not one
                bad address, it is a provider incident or a bounced corporate
                domain, and forty held rows with one button each is how a
                month of increases quietly lapses. */}
            <p className="text-muted-foreground text-xs text-pretty">
              Re-notices every held increase at this facility that has a corrected address, keeping
              each one&apos;s figures and restarting its notice period. Any tenant whose contact
              details still carry the address that bounced is listed back to you untouched, by name.
            </p>
            <AdminForm action={renoticeAction} label="Re-notice every held increase" className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="facilityId" value={facilityId} />
              <Field name="reason" label="Why" className="flex flex-col gap-1 text-xs" />
              <Button type="submit">Re-notice all held</Button>
            </AdminForm>
          </div>
        )}

        {batches.length > 0 && canRaise && (
          <div className="border-input flex flex-col gap-3 rounded-lg border p-4">
            <h3 className="text-sm font-medium">Whole batches</h3>
            <p className="text-muted-foreground text-xs text-pretty">
              A rule-based batch was scheduled as one worklist and can be approved or cancelled as
              one — approving row by row above works too.
            </p>
            {batches.map((batch) => (
              <div key={batch.id} className="flex flex-wrap items-end gap-3">
                <p className="w-full text-xs font-medium">{batch.label}</p>
                <AdminForm action={approveAction} label={`Approve ${batch.label}`} className="flex flex-wrap items-end gap-2">
                  <input type="hidden" name="batchId" value={batch.id} />
                  <Field name="reason" label="Why" className="flex flex-col gap-1 text-xs" />
                  <Button type="submit" aria-label={`Approve ${batch.label}`}>
                    Approve batch
                  </Button>
                </AdminForm>
                <AdminForm action={cancelAction} label={`Cancel ${batch.label}`} className="flex flex-wrap items-end gap-2">
                  <input type="hidden" name="batchId" value={batch.id} />
                  <Field name="reason" label="Why" className="flex flex-col gap-1 text-xs" />
                  <Button type="submit" variant="destructive" aria-label={`Cancel ${batch.label}`}>
                    Cancel batch
                  </Button>
                </AdminForm>
              </div>
            ))}
          </div>
        )}
      </section>

      {canRaise && (
      <section aria-labelledby="eligible-heading" className="flex flex-col gap-3">
        <h2 id="eligible-heading" className="font-medium">
          Who the rule would pick ({eligible.length})
        </h2>
        {/* B-165. The rule, in the words of the settings that produced it.
            "Raises each of them to street" was true and was the defect: an
            approver reading only a dollar delta could not see that a $89
            tenant was being sent a 63% letter. */}
        <p className="text-muted-foreground max-w-prose text-xs text-pretty">
          Leases at least {policy.minMonthsSinceLastChange} months since their last rate change and
          at least {formatCents(policy.minGapCents)} below the current street rate, largest gap
          first. Each is raised by {formatPercent(policy.percentStepBps)} of what they pay now — at
          least {formatCents(policy.minStepCents)}, at most {formatCents(policy.maxStepCents)},
          rounded to the dollar
          {policy.capAtStreet ? ' and never above street' : ' (street is not a ceiling here)'}.{' '}
          <Link className="underline" href="/admin/settings">
            Change the rule in settings
          </Link>
          .
        </p>

        {eligible.length === 0 ? (
          <p className="text-muted-foreground text-sm">No lease meets the rule right now.</p>
        ) : (
          <ScrollRegion aria-label="Eligible leases">
            <table className="w-full min-w-2xl border-collapse text-sm">
              <caption className="sr-only">Leases eligible for a rule-based rate increase</caption>
              <thead>
                <tr className="border-input border-b text-left">
                  <th scope="col" className="py-2 pr-4">Tenant</th>
                  <th scope="col" className="py-2 pr-4">Unit</th>
                  <th scope="col" className="py-2 pr-4 text-right">Now ($/mo)</th>
                  <th scope="col" className="py-2 pr-4 text-right">New ($/mo)</th>
                  <th scope="col" className="py-2 pr-4 text-right">Change ($/mo)</th>
                  <th scope="col" className="py-2 pr-4 text-right">Street ($/mo)</th>
                  <th scope="col" className="py-2 pr-4 text-right">Gap ($/mo)</th>
                  <th scope="col" className="py-2 pr-4 text-right">Months since change</th>
                  <th scope="col" className="py-2 pr-4">Action</th>
                </tr>
              </thead>
              <tbody>
                {eligible.map((row) => (
                  <tr key={row.leaseId} className="border-input border-b">
                    <th scope="row" className="py-2 pr-4 text-left font-normal">{row.tenantName}</th>
                    <td className="py-2 pr-4">{row.unitNumber}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{formatCents(row.inPlaceRateCents)}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{formatCents(row.newRateCents)}</td>
                    {/* The percentage beside the dollars, per row: the delta
                        alone hides which tenants are taking the whole step. */}
                    <td className="py-2 pr-4 text-right tabular-nums">
                      +{formatCents(row.newRateCents - row.inPlaceRateCents)} (
                      {formatPercent(
                        Math.round(((row.newRateCents - row.inPlaceRateCents) / row.inPlaceRateCents) * 10_000),
                      )}
                      )
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums">{formatCents(row.streetRateCents)}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{formatCents(row.gapCents)}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{row.monthsSinceLastChange ?? '—'}</td>
                    {/* B-177. This table listed every tenant, unit and rate and
                        offered no action, so the workflow was to copy a cuid out
                        of it and paste it into a form below. Plain links, which
                        prefill the picker and jump to it — no client JS, and the
                        form still refuses anything the service refuses. */}
                    <td className="py-2 pr-4">
                      <span className="flex flex-col gap-1 text-xs">
                        <Link
                          className="underline"
                          href={`?raise=${row.leaseId}&rate=${(row.newRateCents / 100).toFixed(2)}#oneoff-heading`}
                        >
                          Schedule an increase
                          <span className="sr-only"> for {row.tenantName}, unit {row.unitNumber}</span>
                        </Link>
                        {/* Only where there is a form to jump to — the
                            retention save is a different authority. */}
                        {canLower && (
                          <Link className="underline" href={`?lower=${row.leaseId}#decrease-heading`}>
                            Lower this rate
                            <span className="sr-only"> for {row.tenantName}, unit {row.unitNumber}</span>
                          </Link>
                        )}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollRegion>
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
      )}

      {canRaise && (
      <section aria-labelledby="oneoff-heading" className="flex flex-col gap-3">
        <h2 id="oneoff-heading" className="font-medium">
          Schedule one tenant
        </h2>
        <AdminForm action={scheduleOneOffAction} label="Schedule one rate increase" className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="facilityId" value={facilityId} />
          <Field
            name="leaseId"
            label="Tenant"
            as="select"
            required
            defaultValue={prefillRaise ?? ''}
            className="flex flex-col gap-1 text-sm"
            hint="What they pay now is shown beside each name."
          >
            {leaseOptions(leases)}
          </Field>
          <Field
            name="newRateDollars"
            label="New monthly rate ($)"
            inputMode="decimal"
            required
            defaultValue={prefillRate}
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
      )}

      {/* PRD 02 US-11 (B-153). The retention save — the same workflow in the
          other direction, and the reason it is a separate form rather than a
          direction toggle: it needs a reason code, gives no notice, and is
          approved by the act of making it. */}
      {canLower && (
      <section aria-labelledby="decrease-heading" className="flex flex-col gap-3">
        <h2 id="decrease-heading" className="font-medium">
          Lower one tenant&apos;s rate
        </h2>
        <p className="text-muted-foreground max-w-prose text-xs text-pretty">
          A retention save. There is no notice period — nothing governs charging a tenant less — and
          no separate approval: the amount you give away each month has to sit inside your own
          monetary limit, and anything above it names the role that can carry it. It applies on its
          effective date and is cancellable until then.
        </p>
        <AdminForm action={scheduleDecreaseAction} label="Lower one tenant's rate" className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="facilityId" value={facilityId} />
          <Field
            name="leaseId"
            label="Tenant"
            as="select"
            required
            defaultValue={prefillLower ?? ''}
            className="flex flex-col gap-1 text-sm"
            hint="What they pay now is shown beside each name."
          >
            {leaseOptions(leases)}
          </Field>
          <Field
            name="newRateDollars"
            label="New monthly rate ($)"
            inputMode="decimal"
            required
            hint="Has to be lower than what they pay now."
          />
          <Field
            name="effectiveDate"
            label="Effective date"
            type="date"
            defaultValue={isoDay(new Date())}
            required
            hint="Today is allowed."
          />
          <Field
            name="reason"
            label="Why"
            required
            className="flex flex-col gap-1 text-sm"
            hint="Recorded against the tenant, permanently."
          />
          <Button type="submit">Lower the rate</Button>
        </AdminForm>
      </section>
      )}

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
