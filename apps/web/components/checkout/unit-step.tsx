import { AdminForm, Field } from '@/components/admin/form'
import { confirmUnitAction } from '@/app/(public)/checkout/actions'
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
  startDate,
  earliest,
  latest,
}: {
  token: string
  unitNumber: string | null
  unitLabel: string
  facilityName: string
  quotedRateCents: number
  /// `YYYY-MM-DD`. What the field starts on — the renter's own earlier answer
  /// if they have been here before (§6.4: going back never loses data), and
  /// today otherwise.
  startDate: string
  /// The window's ends, for the picker's own `min`/`max` and for the sentence
  /// beside it. B-106.
  earliest: string
  latest: string
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
      </dl>

      <p className="text-muted-foreground mt-3 text-sm text-pretty">
        Month-to-month — no long-term commitment. We are holding this unit for you while you finish.
      </p>

      <AdminForm action={confirmUnitAction} label="Confirm this unit" className="mt-4 flex flex-col gap-3">
        <input type="hidden" name="token" value={token} />
        {/* B-106. A real date field, not a fixed "today".
        
            `min`/`max` give a picker its bounds, and the hint states them in
            words as well — a native picker greys out what is unreachable, but
            a renter typing the date by hand gets no such signal, and the row
            requires manual text entry to work. The server judges it either
            way: `min`/`max` are a convenience, never the enforcement. */}
        <Field
          name="startDate"
          label="Move-in date"
          type="date"
          defaultValue={startDate}
          min={earliest}
          max={latest}
          hint={
            earliest === latest
              ? 'Move-ins start today at this location.'
              : `Any day from ${earliest} to ${latest}. Leave it as it is to move in today.`
          }
          className="flex flex-col gap-1 text-sm"
        />
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
