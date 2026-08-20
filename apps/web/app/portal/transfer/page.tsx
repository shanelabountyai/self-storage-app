import Link from 'next/link'
import { requireTenantActor } from '@/lib/rbac/session'
import {
  previewTenantTransfer,
  tenantTransferLeases,
  transferOptionsFor,
} from '@/lib/portal/transfer'
import { formatRate } from '@/lib/format'
import { AdminForm } from '@/components/admin/form'
import { cancelTransferAction, requestTransferAction } from './actions'

export const metadata = { title: 'Move to another unit' }

// PRD 01 §9 / US-14 (B-090 part 2). Pick a unit → pick a date → see what the
// swap settles to → ask. Nothing here commits a transfer: that stays exactly
// where B-077 built it, behind a person who can see whether the old unit is
// actually empty.

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric' }).format(date)
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col gap-6">{children}</div>
}

export default async function PortalTransferPage({
  searchParams,
}: {
  searchParams: Promise<{ lease?: string; unit?: string; date?: string }>
}) {
  const { lease: leaseId, unit: toUnitId, date } = await searchParams
  const actor = await requireTenantActor()
  const leases = await tenantTransferLeases(actor.tenantId)

  if (leases.length === 0) {
    return (
      <Shell>
        <h1 className="text-xl font-semibold">Move to another unit</h1>
        <p className="text-sm text-pretty">We don&apos;t see an active unit on this account.</p>
        <Link href="/portal" className="text-sm underline underline-offset-4">
          Back to my account
        </Link>
      </Shell>
    )
  }

  const selectedId = leaseId ?? (leases.length === 1 ? leases[0].leaseId : undefined)

  if (!selectedId) {
    return (
      <Shell>
        <h1 className="text-xl font-semibold">Move to another unit</h1>
        <p className="text-sm">Which unit are you moving out of?</p>
        <ul className="flex flex-col gap-2">
          {leases.map((lease) => (
            <li key={lease.leaseId}>
              <Link
                href={`/portal/transfer?lease=${lease.leaseId}`}
                className="border-input hover:bg-accent inline-flex min-h-11 items-center rounded-md border px-4 text-sm font-medium"
              >
                {lease.facilityName} — Unit {lease.unitNumber} ({lease.unitTypeName})
              </Link>
            </li>
          ))}
        </ul>
      </Shell>
    )
  }

  const lease = leases.find((l) => l.leaseId === selectedId)
  if (!lease) {
    return (
      <Shell>
        <h1 className="text-xl font-semibold">Move to another unit</h1>
        <p className="text-sm text-pretty">We couldn&apos;t find that unit on your account.</p>
        <Link href="/portal/transfer" className="text-sm underline underline-offset-4">
          Choose a unit
        </Link>
      </Shell>
    )
  }

  // Already asked: show what was asked for and a way to withdraw it, not the
  // picker again. Same shape as the move-out request screen.
  if (lease.pending) {
    return (
      <Shell>
        <h1 className="text-xl font-semibold">Transfer requested</h1>
        <p className="text-sm text-pretty">
          We&apos;re holding <strong>Unit {lease.pending.unitNumber}</strong> at {lease.facilityName} for
          you, for a move on <strong>{formatDate(lease.pending.transferDate)}</strong>. Nothing has
          changed yet — you still have Unit {lease.unitNumber}, your gate code still works, and your
          rent is unchanged until the team completes the move with you.
        </p>
        <p className="text-sm text-pretty">
          They&apos;ll call to arrange a time. If you need it sooner, ring the office
          {lease.facilityPhone ? ` on ${lease.facilityPhone}` : ''}.
        </p>
        <AdminForm action={cancelTransferAction} label="Cancel transfer request">
          <input type="hidden" name="leaseId" value={lease.leaseId} />
          <button
            type="submit"
            className="border-input hover:bg-accent inline-flex min-h-11 items-center rounded-md border px-4 text-sm font-medium"
          >
            Cancel this request
          </button>
        </AdminForm>
        <Link href="/portal" className="text-sm underline underline-offset-4">
          Back to my account
        </Link>
      </Shell>
    )
  }

  const options = await transferOptionsFor(actor.tenantId, lease.leaseId)
  const transferDate = date ? new Date(`${date}T00:00:00.000Z`) : new Date()
  const selectedUnit = options.find((option) => option.unitId === toUnitId)
  const previewResult = selectedUnit
    ? await previewTenantTransfer(actor.tenantId, lease.leaseId, selectedUnit.unitId, transferDate)
    : null
  const preview = previewResult?.ok ? previewResult.preview : null

  return (
    <Shell>
      <div>
        {leases.length > 1 && (
          <Link href="/portal/transfer" className="text-sm underline underline-offset-4">
            ← Choose a different unit
          </Link>
        )}
        <h1 className="mt-1 text-xl font-semibold">
          Move out of Unit {lease.unitNumber} into another unit
        </h1>
        <p className="text-muted-foreground mt-1 text-sm text-pretty">
          You&apos;re paying {formatRate(lease.monthlyRateCents)} a month for Unit {lease.unitNumber} (
          {lease.unitTypeName}) at {lease.facilityName}. Asking here holds the unit you pick — it
          doesn&apos;t move anything. The team will call you to arrange the day and finish the swap.
        </p>
      </div>

      {options.length === 0 ? (
        <p className="text-sm text-pretty">
          There&apos;s nothing else free at {lease.facilityName} right now. Ring the office
          {lease.facilityPhone ? ` on ${lease.facilityPhone}` : ''} and they&apos;ll let you know when
          something opens up.
        </p>
      ) : (
        <>
          <form method="GET" className="flex flex-col gap-4">
            <input type="hidden" name="lease" value={lease.leaseId} />
            <fieldset className="flex flex-col gap-2">
              <legend className="text-sm font-medium">Which unit would you like?</legend>
              {options.map((option) => (
                <label
                  key={option.unitId}
                  className="border-input flex min-h-11 items-center gap-3 rounded-md border px-3 py-2 text-sm"
                >
                  <input
                    type="radio"
                    name="unit"
                    value={option.unitId}
                    defaultChecked={option.unitId === toUnitId}
                  />
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-medium">Unit {option.unitNumber}</span>
                    <span className="text-muted-foreground">
                      {option.unitTypeName} · {option.widthFt}×{option.lengthFt}
                    </span>
                    <span className="tabular-nums">{formatRate(option.rateCents)}/mo</span>
                    <span className="text-muted-foreground tabular-nums">
                      {option.monthlyDifferenceCents === 0
                        ? 'same as now'
                        : option.monthlyDifferenceCents > 0
                          ? `${formatRate(option.monthlyDifferenceCents)} more a month`
                          : `${formatRate(-option.monthlyDifferenceCents)} less a month`}
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>

            <label htmlFor="date" className="flex flex-col gap-1 text-sm">
              When would you like to move?
              <input
                id="date"
                name="date"
                type="date"
                min={isoDate(new Date())}
                defaultValue={isoDate(transferDate)}
                className="border-input bg-background h-11 max-w-xs rounded-md border px-2"
              />
            </label>

            <button
              type="submit"
              className="border-input hover:bg-accent inline-flex min-h-11 items-center self-start rounded-md border px-4 text-sm font-medium"
            >
              Show me what it costs
            </button>
          </form>

          {preview && (
            <>
              <dl className="border-input flex flex-col gap-2 rounded-lg border p-4 text-sm">
                <div className="flex justify-between gap-4">
                  <dt>New monthly rent for Unit {preview.toUnitNumber}</dt>
                  <dd className="tabular-nums">{formatRate(preview.newRateCents)}</dd>
                </div>
                {preview.refundCents > 0 && (
                  <div className="flex justify-between gap-4">
                    <dt>Credit for the days left on Unit {preview.fromUnitNumber}</dt>
                    <dd className="tabular-nums">−{formatRate(preview.refundCents)}</dd>
                  </div>
                )}
                {preview.chargeCents > 0 && (
                  <div className="flex justify-between gap-4">
                    <dt>Unit {preview.toUnitNumber} for {preview.dayRange}</dt>
                    <dd className="tabular-nums">{formatRate(preview.chargeCents)}</dd>
                  </div>
                )}
                {preview.transferFeeCents > 0 && (
                  <div className="flex justify-between gap-4">
                    <dt>Transfer fee</dt>
                    <dd className="tabular-nums">{formatRate(preview.transferFeeCents)}</dd>
                  </div>
                )}
                <div className="flex justify-between gap-4 border-t pt-2 font-medium">
                  <dt>
                    {preview.totalDueTodayCents > 0
                      ? 'To pay on the day'
                      : preview.totalDueTodayCents < 0
                        ? 'Credited to your account'
                        : 'Nothing to pay on the day'}
                  </dt>
                  <dd className="tabular-nums">
                    {formatRate(Math.abs(preview.totalDueTodayCents))}
                  </dd>
                </div>
              </dl>

              <AdminForm
                action={requestTransferAction}
                label="Request this transfer"
                className="flex flex-col gap-3"
              >
                <input type="hidden" name="leaseId" value={lease.leaseId} />
                <input type="hidden" name="toUnitId" value={preview.toUnitId} />
                <input type="hidden" name="transferDate" value={isoDate(transferDate)} />
                <p className="text-muted-foreground text-sm text-pretty">
                  We&apos;ll hold Unit {preview.toUnitNumber} for you and the team will call to arrange
                  the move. Your current unit, gate code and rent stay exactly as they are until you
                  and the team have actually done the swap — you can cancel any time before that.
                </p>
                <button
                  type="submit"
                  className="bg-primary text-primary-foreground inline-flex min-h-11 items-center justify-center self-start rounded-md px-4 text-sm font-medium"
                >
                  Request this transfer
                </button>
              </AdminForm>
            </>
          )}
        </>
      )}

      <Link href="/portal" className="text-sm underline underline-offset-4">
        Back to my account
      </Link>
    </Shell>
  )
}
