import Link from 'next/link'
import { getAdminActor } from '@/lib/admin/context'
import {
  LIEN_TRANSFER_REASONS,
  pendingTransferRequest,
  previewTransfer,
  transferTargets,
  TRANSFER_PROBLEM_COPY,
} from '@/lib/admin/transfer'
import { formatCents } from '@/lib/format'
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
  searchParams: Promise<{ lease?: string; unit?: string; date?: string }>
}) {
  const { tenantId } = await params
  const { lease: leaseId, unit: toUnitId, date } = await searchParams
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
  const preview = selectedUnitId
    ? await previewTransfer(actor, leaseId, selectedUnitId, new Date(`${transferDate}T00:00:00.000Z`))
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

      {targets.length === 0 ? (
        <p className="text-sm">
          There is no available unit at this facility to transfer into.
        </p>
      ) : (
        <form method="GET" className="border-input flex flex-wrap items-end gap-3 rounded-lg border p-4">
          <input type="hidden" name="lease" value={leaseId} />
          <label className={FIELD_CLASS} htmlFor="unit">
            Move to
            <select
              id="unit"
              name="unit"
              defaultValue={selectedUnitId ?? ''}
              className="border-input bg-background min-h-11 rounded-md border px-3 text-sm"
            >
              <option value="">Choose a unit…</option>
              {targets.map((unit) => (
                <option key={unit.id} value={unit.id}>
                  {unit.number} — {unit.unitTypeName}
                  {unit.rateCents === null ? ' (no rate published)' : ` — ${formatCents(unit.rateCents)}/mo`}
                </option>
              ))}
            </select>
          </label>
          <label className={FIELD_CLASS} htmlFor="date">
            Transfer date
            <input
              id="date"
              name="date"
              type="date"
              defaultValue={transferDate}
              className="border-input bg-background min-h-11 rounded-md border px-3 text-sm"
            />
          </label>
          <Button type="submit" variant="outline">
            Recalculate
          </Button>
        </form>
      )}

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

            <dt>Rent on the new unit</dt>
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

          <AdminForm
            action={completeTransferAction}
            label="Confirm the transfer"
            className="flex flex-col gap-3"
          >
            <input type="hidden" name="tenantId" value={tenantId} />
            <input type="hidden" name="leaseId" value={leaseId} />
            <input type="hidden" name="toUnitId" value={preview.preview.toUnitId} />
            <input type="hidden" name="transferDate" value={transferDate} />

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
            <Button type="submit" className="self-start">
              Transfer to unit {preview.preview.toUnitNumber}
            </Button>
          </AdminForm>
        </section>
      )}
    </div>
  )
}
