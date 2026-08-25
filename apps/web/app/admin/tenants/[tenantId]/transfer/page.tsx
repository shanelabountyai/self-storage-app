import Link from 'next/link'
import { getAdminActor } from '@/lib/admin/context'
import {
  LIEN_TRANSFER_REASONS,
  pendingTransferRequest,
  previewTransfer,
  transferTargets,
  TRANSFER_PROBLEM_COPY,
} from '@/lib/admin/transfer'
import { formatCents, formatDay } from '@/lib/format'
import { AdminForm, Field } from '@/components/admin/form'
import { Button } from '@/components/ui/button'
import { completeTransferAction } from './actions'

export const metadata = { title: 'Transfer unit' }

// PRD 02 §4.3 US-14 (B-077). "One wizard, one confirmation."
//
// One screen, not a multi-step wizard — the same shape the move-out screen
// established and for the same reason: a GET form recalculates the whole
// settlement server-side, so the arithmetic never happens in the browser and
// the figure staff confirm is the figure the action re-runs and posts. The
// codebase's one comment about wizards (`admin/pos/actions.ts`) argues
// against building a second stateful flow, and this needs none.

const FIELD_CLASS = 'flex flex-col gap-1 text-sm'

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

// B-142 / PRD 02 §4.4 US-14. Absolute facility-local date and time, never a
// countdown — matches the density other admin datetimes use (e.g.
// `admin/settings/page.tsx`'s own `formatDateTime`).
function formatExpiry(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: timezone,
  }).format(date)
}

export default async function TransferPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantId: string }>
  searchParams: Promise<{ lease?: string; unit?: string; date?: string; rate?: string }>
}) {
  const { tenantId } = await params
  const { lease: leaseId, unit: toUnitId, date, rate } = await searchParams
  const actor = await getAdminActor()

  if (!leaseId) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-lg font-semibold">Transfer unit</h1>
        <p className="text-sm">Choose a unit from the tenant&apos;s profile to transfer.</p>
        <Link href={`/admin/tenants/${tenantId}`} className="text-sm underline underline-offset-2">
          ← Back to the profile
        </Link>
      </div>
    )
  }

  // B-090 part 2. If the tenant asked for this from the portal, their choice
  // is the default — staff arriving from the task see the unit and date that
  // were requested, already priced, rather than re-picking them from memory.
  const requested = await pendingTransferRequest(actor, leaseId)
  const transferDate = date ?? (requested ? requested.transferDate.toISOString().slice(0, 10) : todayIso())
  const selectedUnitId = toUnitId ?? requested?.toUnitId
  const targets = await transferTargets(actor, leaseId)
  // B-162 / D-93. A rate staff typed, in dollars, re-previewed rather than
  // applied on confirm — the same discipline the date and unit already keep, so
  // the figure somebody confirms is the figure that posts. A blank or unusable
  // entry falls back to the facility's policy rather than to zero.
  const dollars = rate === undefined || rate.trim() === '' ? null : Number(rate)
  const rateOverrideCents =
    dollars !== null && Number.isFinite(dollars) && dollars >= 0 ? Math.round(dollars * 100) : null
  const preview = selectedUnitId
    ? await previewTransfer(
        actor,
        leaseId,
        selectedUnitId,
        new Date(`${transferDate}T00:00:00.000Z`),
        rateOverrideCents,
      )
    : null

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold">Transfer unit</h1>
        <p className="text-muted-foreground mt-1 max-w-prose text-sm text-pretty">
          Moves this tenant to another unit at the same facility. The old lease closes and a new one
          opens on the same billing day, so their billing date does not move — both halves of the
          period are prorated and net against each other.{' '}
          <Link href={`/admin/tenants/${tenantId}`} className="underline underline-offset-2">
            Back to the profile
          </Link>
          .
        </p>
      </div>

      {requested && (
        <p
          className="border-input rounded-lg border p-4 text-sm text-pretty"
          role="note"
        >
          <strong>The tenant asked for this.</strong> They chose Unit {requested.toUnitNumber} for{' '}
          {new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric' }).format(
            requested.transferDate,
          )}
          , and that unit is held for them until{' '}
          <strong>{formatExpiry(requested.expiresAt, requested.facilityTimezone)}</strong> — the hold
          lapses on its own if nobody completes or cancels it before then. They were quoted{' '}
          {formatCents(requested.quotedRateCents)}/mo, and that is the rate this settles at while the
          hold lives — not today&apos;s street rate, if it has moved since. Nothing has moved yet —
          check the old unit is actually empty before you confirm.
        </p>
      )}

      {/* B-173. One form, one truth.

          The unit, date and rate used to sit in their own `method="GET"` form
          whose only submit was "Recalculate", while the confirming form below
          carried hidden copies built from the URL — so changing any of the three
          and pressing Transfer committed the PREVIOUS one, after showing staff
          the new one's figures. Nothing said the controls were inert until a
          second button was pressed. They are fields of the committing form now,
          and `stalePreview` refuses while a control and the priced value
          disagree; "Recalculate" is a native GET submit of this same form, which
          a submit button with a STRING `formAction` gets — React hands that one
          case back to the browser. */}
      {targets.length === 0 ? (
        <p className="text-sm">
          There is no available unit at this facility to transfer into.
        </p>
      ) : (
        <AdminForm
          action={completeTransferAction}
          label="Confirm the transfer"
          className="flex flex-col gap-6"
        >
          <input type="hidden" name="tenantId" value={tenantId} />
          <input type="hidden" name="leaseId" value={leaseId} />
          <input type="hidden" name="lease" value={leaseId} />
          <input type="hidden" name="previewed_unit" value={selectedUnitId ?? ''} />
          <input type="hidden" name="previewed_date" value={transferDate} />
          <input type="hidden" name="previewed_rate" value={rate ?? ''} />

          <div className="border-input flex flex-wrap items-end gap-3 rounded-lg border p-4">
            <Field name="unit" label="Move to" as="select" defaultValue={selectedUnitId ?? ''} className={FIELD_CLASS}>
              <option value="">Choose a unit…</option>
              {targets.map((unit) => (
                <option key={unit.id} value={unit.id}>
                  {unit.number} — {unit.unitTypeName}
                  {unit.rateCents === null ? ' (no rate published)' : ` — ${formatCents(unit.rateCents)}/mo`}
                </option>
              ))}
            </Field>
            <Field
              name="date"
              label="Transfer date"
              type="date"
              defaultValue={transferDate}
              className={FIELD_CLASS}
            />
            {/* B-162 / D-93. Empty means the facility's policy decides. Typed
                in dollars because that is what a person reads off a screen and
                says on the phone; the preview restates what the policy would
                have charged so moving off it is visible rather than
                invisible. */}
            <Field
              name="rate"
              label="Rent on the new unit"
              type="number"
              min={0}
              step="0.01"
              inputMode="decimal"
              defaultValue={rate ?? ''}
              placeholder={preview?.ok ? (preview.preview.policyRateCents / 100).toFixed(2) : ''}
              hint="Leave blank to use this facility's transfer rate policy."
              className={FIELD_CLASS}
            />
            <Button
              type="submit"
              variant="outline"
              formMethod="get"
              formAction={`/admin/tenants/${tenantId}/transfer`}
            >
              Recalculate
            </Button>
          </div>

          {preview && !preview.ok && (
            <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900">
              {TRANSFER_PROBLEM_COPY[preview.problem]}
            </p>
          )}

          {preview?.ok && (
            <section aria-labelledby="settlement-heading" className="flex flex-col gap-4">
              <h2 id="settlement-heading" className="font-medium">
                {preview.preview.tenantName}: unit {preview.preview.fromUnitNumber} →{' '}
                {preview.preview.toUnitNumber}
              </h2>

              <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-2 text-sm">
                <dt>Rent now</dt>
                <dd className="text-right tabular-nums">{formatCents(preview.preview.currentRateCents)}/mo</dd>

                <dt>
                  Rent on the new unit
                  {preview.preview.rateOverridden && (
                    <span className="text-muted-foreground block text-xs">
                      You set this. The policy figure is{' '}
                      {formatCents(preview.preview.policyRateCents)}/mo; street is{' '}
                      {formatCents(preview.preview.toStreetRateCents)}/mo.
                    </span>
                  )}
                </dt>
                <dd className="text-right tabular-nums">{formatCents(preview.preview.newRateCents)}/mo</dd>

                {preview.preview.prorates ? (
                  <>
                    <dt>
                      Credit for unit {preview.preview.fromUnitNumber}, unused
                      <span className="text-muted-foreground block text-xs">{preview.preview.dayRange}</span>
                    </dt>
                    <dd className="text-right tabular-nums">−{formatCents(preview.preview.refundCents)}</dd>

                    <dt>
                      Charge for unit {preview.preview.toUnitNumber}
                      <span className="text-muted-foreground block text-xs">{preview.preview.dayRange}</span>
                    </dt>
                    <dd className="text-right tabular-nums">{formatCents(preview.preview.chargeCents)}</dd>
                  </>
                ) : (
                  <>
                    <dt className="col-span-2 text-muted-foreground text-xs text-pretty">
                      This facility does not prorate, so neither side of the period is adjusted — the new
                      rate starts with the next invoice.
                    </dt>
                  </>
                )}

                {preview.preview.transferFeeCents > 0 && (
                  <>
                    <dt>Transfer fee</dt>
                    <dd className="text-right tabular-nums">{formatCents(preview.preview.transferFeeCents)}</dd>
                  </>
                )}

                <dt className="border-input border-t pt-2 font-medium">
                  {preview.preview.totalDueTodayCents < 0 ? 'Credited to the account' : 'Due today'}
                </dt>
                <dd className="border-input border-t pt-2 text-right font-medium tabular-nums">
                  {formatCents(Math.abs(preview.preview.totalDueTodayCents))}
                </dd>
              </dl>

              <div className="flex flex-col gap-3">
                {preview.preview.rateOverridden && (
                  <input
                    type="hidden"
                    name="rateOverrideCents"
                    value={String(preview.preview.newRateCents)}
                  />
                )}

                {/* B-162. A transfer is a service request the tenant asked for, and
                    it used to be able to raise their rent with none of US-11's
                    notice period, approval or record. It still can — an upsize
                    legitimately costs more — but nobody confirms it without being
                    told, and the amount is stated rather than left to be worked out
                    from two rows of a table. Never colour alone (WCAG 1.4.1). */}
                {preview.preview.raisesRate && (
                  <p
                    role="note"
                    className="rounded-md border-2 border-amber-500 bg-amber-50 p-3 text-sm text-amber-950 text-pretty"
                  >
                    <strong className="font-medium">This puts their rent up.</strong>{' '}
                    {formatCents(preview.preview.currentRateCents)} →{' '}
                    {formatCents(preview.preview.newRateCents)} a month, from{' '}
                    {new Intl.DateTimeFormat('en-US', {
                      month: 'long',
                      day: 'numeric',
                      year: 'numeric',
                    }).format(new Date(`${transferDate}T00:00:00.000Z`))}
                    . A transfer is not a rate increase, so there is no notice period behind this figure
                    — tell them before you confirm.
                  </p>
                )}

                {/* D-93. Cancelled on commit, and said before rather than after. */}
                {preview.preview.liveRateIncrease && (
                  <p
                    role="note"
                    className="rounded-md border-2 border-amber-500 bg-amber-50 p-3 text-sm text-amber-950 text-pretty"
                  >
                    <strong className="font-medium">
                      An approved rate change to{' '}
                      {formatCents(preview.preview.liveRateIncrease.newRateCents)} is in flight
                    </strong>{' '}
                    for{' '}
                    {new Intl.DateTimeFormat('en-US', {
                      month: 'long',
                      day: 'numeric',
                      year: 'numeric',
                    }).format(preview.preview.liveRateIncrease.effectiveDate)}
                    . Transferring cancels it, because it was approved against a rate this move
                    replaces. Raise a new one against the new lease if it is still wanted.
                  </p>
                )}

                {/*
                  B-157 / D-85. A lien notice naming this unit has been served and
                  the goods in it are being prepared for sale. D-85 chose to allow
                  the move rather than block it — refusing costs the operator the
                  tenant AND the balance — on three conditions, and this is where
                  two of them are asked for. The third (the lien clock does not
                  reset) is enforced in the auction case's own reads.
                */}
                {preview.preview.inLienPipeline && (
                  <div className="flex flex-col gap-3 rounded-md border-2 border-amber-500 bg-amber-50 p-3">
                    <p role="alert" className="max-w-prose text-sm text-amber-950 text-pretty">
                      <strong className="font-medium">
                        Unit {preview.preview.fromUnitNumber} is in the lien pipeline.
                      </strong>{' '}
                      A served lien notice names this unit, so moving the tenant&apos;s goods out of it
                      needs a recorded reason — the notice and the move have to reconcile if the sale is
                      ever challenged. The balance and the lien clock both follow the tenant to the new
                      unit; this does not restart their timeline or settle what they owe.
                    </p>
                    <Field name="reasonCode" label="Why is this tenant being moved?" as="select" defaultValue="">
                      <option value="">Choose a reason…</option>
                      {LIEN_TRANSFER_REASONS.map((reason) => (
                        <option key={reason.value} value={reason.value}>
                          {reason.label}
                        </option>
                      ))}
                    </Field>
                    <Field name="reasonNote" label="Note (optional)" />
                  </div>
                )}

                <p className="text-muted-foreground max-w-prose text-xs text-pretty">
                  Confirming closes the lease on unit {preview.preview.fromUnitNumber} and opens one on{' '}
                  {preview.preview.toUnitNumber}. Both units change status at the same moment, the
                  tenant&apos;s history stays on one account, and their gate code is reissued for the new
                  unit.
                </p>
                {/* B-173. The day and the unit are in the button's own accessible
                    name, not only in controls the reader passed several fields
                    ago. */}
                <Button type="submit" className="self-start">
                  Transfer to unit {preview.preview.toUnitNumber} on {formatDay(transferDate)}
                </Button>
              </div>
            </section>
          )}
        </AdminForm>
      )}
    </div>
  )
}
