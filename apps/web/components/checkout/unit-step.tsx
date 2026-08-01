import { AdminForm } from '@/components/admin/form'
import { advanceAction } from '@/app/(public)/checkout/actions'
import { formatRate } from '@/lib/format'

// PRD 01 US-501 step 2. "Move-in date & unit confirmation."
//
// The unit was assigned when the session started (B-020) rather than here: the
// lock has to exist from the first moment of checkout, or the renter spends
// step 1 filling in a form for a unit anyone could take. So this step confirms
// what is already held — it does not do the assigning US-501 describes at this
// point, and that difference is deliberate.

export function UnitStep({
  token,
  unitNumber,
  unitLabel,
  facilityName,
  quotedRateCents,
  moveInDate,
}: {
  token: string
  unitNumber: string | null
  unitLabel: string
  facilityName: string
  quotedRateCents: number
  moveInDate: string
}) {
  return (
    <div className="mt-4">
      <dl className="border-input flex flex-col gap-3 rounded-lg border p-4 text-sm">
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">Facility</dt>
          <dd className="font-medium">{facilityName}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">Size</dt>
          <dd className="font-medium">{unitLabel}</dd>
        </div>
        {unitNumber && (
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Your unit</dt>
            <dd className="font-medium">{unitNumber}</dd>
          </div>
        )}
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">Rate</dt>
          {/* The rate locked when the session started. US-301: price seen is
              price charged, so this cannot move under the renter mid-checkout
              even if the published rate changes. */}
          <dd className="font-medium">{formatRate(quotedRateCents)}/mo</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">Move-in date</dt>
          <dd className="font-medium">{moveInDate}</dd>
        </div>
      </dl>

      <p className="text-muted-foreground mt-3 text-sm text-pretty">
        Month-to-month — no long-term commitment. We are holding this unit for you while you finish.
      </p>

      <AdminForm action={advanceAction} label="Confirm this unit" className="mt-4">
        <input type="hidden" name="token" value={token} />
        <input type="hidden" name="from" value="unit_assign" />
        <button
          type="submit"
          className="bg-primary text-primary-foreground inline-flex min-h-11 w-full items-center justify-center rounded-md px-4 text-base font-medium sm:w-auto"
        >
          This is right — continue
        </button>
      </AdminForm>
    </div>
  )
}
