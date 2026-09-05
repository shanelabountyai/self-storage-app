import { AdminForm, Field } from '@/components/admin/form'
import {
  addUnitAction,
  confirmUnitAction,
  removeUnitAction,
} from '@/app/(public)/checkout/actions'
import { formatRate } from '@/lib/format'
import { translate, type Dictionary, type MessageKey } from '@/lib/i18n'

// PRD 01 US-501 step 2. "Move-in date & unit confirmation."
//
// The first unit was assigned when the session started (B-020) rather than
// here: the lock has to exist from the first moment of checkout, or the renter
// spends step 1 filling in a form for a unit anyone could take. So this step
// confirms what is already held — it does not do the assigning US-501
// describes at this point, and that difference is deliberate.
//
// B-106 part 5 makes the basket editable. Three things follow from the row's
// own criteria and none of them is decoration:
//
//   * Each unit is its own labelled region, so the N "Remove" controls do not
//     share one accessible name (2.4.4/4.1.2). The control's VISIBLE text
//     carries the unit number too, rather than an `aria-label` that says more
//     than the button reads — 2.5.3 wants the accessible name to contain the
//     visible one, and "Remove" + a hidden "unit A-104" is the pattern that
//     breaks voice control.
//   * ONE move-in date for the basket, not one per unit. The lock is one lock
//     and the lease starts one day; a date per unit would be a second billing
//     anniversary per renter for no reason anyone asked for.
//   * The add control is a plain <select> of what is actually available, not a
//     link back to the facility page — leaving checkout to add a unit is how a
//     renter loses the lock on the one they already have.

export type BasketLineView = {
  /// The `CheckoutSessionUnit` row id — what the remove control posts back.
  id: string
  unitNumber: string | null
  unitLabel: string
  quotedRateCents: number
}

export function UnitStep({
  token,
  lines,
  facilityName,
  addableTypes,
  startDate,
  earliest,
  latest,
  dict,
}: {
  token: string
  lines: readonly BasketLineView[]
  facilityName: string
  /// Sizes with a published rate and something on the shelf right now. Empty
  /// when the facility is full, in which case the add control is not rendered
  /// at all rather than offering a choice that can only be refused.
  addableTypes: readonly { unitTypeId: string; label: string; webRateCents: number }[]
  /// `YYYY-MM-DD`. What the field starts on — the renter's own earlier answer
  /// if they have been here before (§6.4: going back never loses data), and
  /// today otherwise.
  startDate: string
  /// The window's ends, for the picker's own `min`/`max` and for the sentence
  /// beside it. B-106.
  earliest: string
  latest: string
  dict: Dictionary
}) {
  const t = (key: MessageKey, vars?: Record<string, string | number>) =>
    translate(dict, key, vars)
  const monthlyCents = lines.reduce((sum, line) => sum + line.quotedRateCents, 0)

  return (
    <div className="mt-4">
      <p className="text-muted-foreground text-sm">
        {lines.length === 1
          ? t('unit.oneAt', { facility: facilityName })
          : t('unit.manyAt', {
              count: lines.length,
              facility: facilityName,
              total: `${formatRate(monthlyCents)}${t('card.perMonth')}`,
            })}
      </p>

      <ul className="mt-3 flex flex-col gap-3">
        {lines.map((line, index) => {
          // The unit number when we have one, and the size when we do not —
          // a unit is only assigned a number once claimed, and the region still
          // needs a name that tells this line from the one below it.
          const name = line.unitNumber
            ? t('unit.numbered', { number: line.unitNumber })
            : t('unit.unnumbered', { label: line.unitLabel, index: index + 1 })
          const headingId = `basket-line-${line.id}`

          return (
            <li key={line.id}>
              <section
                aria-labelledby={headingId}
                className="border-input flex flex-wrap items-start justify-between gap-3 rounded-lg border p-4"
              >
                <div className="text-sm">
                  <h3 id={headingId} className="font-medium">
                    {name}
                  </h3>
                  <p className="text-muted-foreground mt-1">{line.unitLabel}</p>
                  {/* The rate locked when this line was added. US-301: price
                      seen is price charged, so it cannot move under the renter
                      mid-checkout even if the published rate changes. */}
                  <p className="mt-1 tabular-nums">
                    {formatRate(line.quotedRateCents)}
                    {t('card.perMonth')}
                  </p>
                </div>

                {/* Withheld rather than disabled when it is the only unit left.
                    B-093's rule is that a control is never `disabled` — but the
                    honest version here is not a disabled button with an
                    explanation, it is no button: there is no such action, and
                    `removeUnitFromBasket` refuses it server-side too. */}
                {lines.length > 1 && (
                  <AdminForm
                    action={removeUnitAction}
                    label={t('unit.remove', { name })}
                    className="shrink-0"
                  >
                    <input type="hidden" name="token" value={token} />
                    <input type="hidden" name="lineId" value={line.id} />
                    <button
                      type="submit"
                      className="border-input hover:bg-accent inline-flex min-h-11 items-center rounded-md border px-4 text-sm font-medium"
                    >
                      {t('unit.remove', { name })}
                    </button>
                  </AdminForm>
                )}
              </section>
            </li>
          )
        })}
      </ul>

      {addableTypes.length > 0 && (
        <AdminForm
          action={addUnitAction}
          label={t('unit.addFormLabel')}
          className="border-input mt-3 flex flex-wrap items-end gap-3 rounded-lg border border-dashed p-4"
        >
          <input type="hidden" name="token" value={token} />
          <Field
            name="unitTypeId"
            // NOT "Add another unit" — that is the FORM's accessible name, and
            // a select sharing it gives two elements one name, which is the
            // same 4.1.2 defect this step fixes for the Remove controls. Found
            // by the spec below rather than by review.
            label={t('unit.sizeToAdd')}
            as="select"
            hint={t('unit.sizeToAddHint')}
            className="flex flex-1 flex-col gap-1 text-sm"
          >
            {addableTypes.map((type) => (
              <option key={type.unitTypeId} value={type.unitTypeId}>
                {type.label} — {formatRate(type.webRateCents)}
                {t('card.perMonth')}
              </option>
            ))}
          </Field>
          <button
            type="submit"
            className="border-input hover:bg-accent inline-flex min-h-11 items-center rounded-md border px-4 text-sm font-medium"
          >
            {t('unit.addToRental')}
          </button>
        </AdminForm>
      )}

      <p className="text-muted-foreground mt-3 text-sm text-pretty">
        {lines.length === 1 ? t('unit.holdingOne') : t('unit.holdingMany')}
      </p>

      <AdminForm
        action={confirmUnitAction}
        label={t('unit.confirmFormLabel')}
        className="mt-4 flex flex-col gap-3"
      >
        <input type="hidden" name="token" value={token} />
        {/* B-106. A real date field, not a fixed "today".

            `min`/`max` give a picker its bounds, and the hint states them in
            words as well — a native picker greys out what is unreachable, but
            a renter typing the date by hand gets no such signal, and the row
            requires manual text entry to work. The server judges it either
            way: `min`/`max` are a convenience, never the enforcement. */}
        <Field
          name="startDate"
          label={lines.length === 1 ? t('unit.moveInDate') : t('unit.moveInDateAll')}
          type="date"
          defaultValue={startDate}
          min={earliest}
          max={latest}
          hint={
            earliest === latest
              ? t('unit.startsToday')
              : t('unit.dateRange', { earliest, latest })
          }
          className="flex flex-col gap-1 text-sm"
        />
        <button
          type="submit"
          className="bg-primary text-primary-foreground inline-flex min-h-11 w-full items-center justify-center rounded-md px-4 text-base font-medium sm:w-auto"
        >
          {lines.length === 1 ? t('unit.confirmOne') : t('unit.confirmMany')}
        </button>
      </AdminForm>
    </div>
  )
}
