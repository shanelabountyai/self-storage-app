'use client'

import { useEffect, useState } from 'react'
import { AdminForm, Field, FieldSet } from '@/components/admin/form'
import { createPaymentPlanAction } from '@/app/admin/tenants/[tenantId]/actions'
import { formatCents } from '@/lib/format'
import { MAX_INSTALLMENTS, evenSchedule } from '@storage/core/payment-plans'

// PRD 02 §4.6 US-25 / D-98 (B-212). The counter-side plan builder.
//
// A client component for one reason: the twelve fields have to add up to the
// arrears TO THE CENT (`validateSchedule`), and until this row the staffer did
// that sum in their head, in front of a tenant, with no running total and no
// prefill. $1,837.42 over six months is 5 × $306.23 + $306.27. The even-split
// control and the "still to allocate" figure are both about that one sentence.
//
// Neither is a second copy of the rule: the split fills the same fields anyone
// can then edit, the total is a display, and `createPaymentPlan` remains the
// only thing that decides whether a schedule may be agreed.

const FIELD_CLASS = 'flex flex-col gap-1 text-sm'

type Row = { dueDate: string; amount: string }

const EMPTY: Row[] = Array.from({ length: MAX_INSTALLMENTS }, () => ({ dueDate: '', amount: '' }))

/// What the staffer has typed, in cents. Deliberately lenient — a half-typed
/// "306." contributes nothing and the figure simply reads as it did before,
/// rather than flashing NaN at somebody mid-keystroke. The server parses this
/// again properly and refuses what it cannot read.
function typedCents(amount: string): number {
  const value = Number.parseFloat(amount)
  return Number.isFinite(value) && value > 0 ? Math.round(value * 100) : 0
}

export function PaymentPlanBuilder({
  tenantId,
  leaseId,
  unitNumber,
  arrearsCents,
  balanceCents,
  planGraceDays,
}: {
  tenantId: string
  leaseId: string
  unitNumber: string
  /// What the installments must total. The page only renders this component
  /// when it is above zero (B-212) — a builder over $0.00 can never succeed.
  arrearsCents: number
  /// The lease's WHOLE balance, which is a different and usually larger number
  /// shown in the table directly above. The two were unnamed and unreconciled,
  /// and a staffer who typed against the balance was refused.
  balanceCents: number
  planGraceDays: number
}) {
  const [rows, setRows] = useState<Row[]>(EMPTY)
  const [count, setCount] = useState(3)
  const [start, setStart] = useState('')

  const allocatedCents = rows.reduce((sum, row) => sum + typedCents(row.amount), 0)
  const remainingCents = arrearsCents - allocatedCents

  const summary =
    allocatedCents === 0
      ? `${formatCents(arrearsCents)} to allocate.`
      : remainingCents > 0
        ? `${formatCents(remainingCents)} still to allocate.`
        : remainingCents < 0
          ? `${formatCents(-remainingCents)} too much — the installments come to ${formatCents(allocatedCents)} against ${formatCents(arrearsCents)} past due.`
          : `Adds up exactly to ${formatCents(arrearsCents)}.`

  // B-248. The region's text, one settling behind `summary`. Typing `306.23`
  // into an amount field mutates `summary` six times; a polite region does NOT
  // coalesce those — NVDA queues each text change and JAWS speaks them — so
  // the region was six full sentences per number entered, on the one form in
  // the product where the number is money owed. The delay is what makes one
  // field edit one announcement. It is not perceptible on screen either: the
  // figure is read after a number is typed, not during it.
  const [settled, setSettled] = useState(summary)
  useEffect(() => {
    const timer = setTimeout(() => setSettled(summary), 700)
    return () => clearTimeout(timer)
  }, [summary])

  function fill() {
    if (!start) return
    const suggested = evenSchedule(arrearsCents, count, start)
    setRows(
      EMPTY.map((_, index) => {
        const installment = suggested[index]
        return installment
          ? { dueDate: installment.dueDate, amount: (installment.amountCents / 100).toFixed(2) }
          : { dueDate: '', amount: '' }
      }),
    )
  }

  function edit(index: number, patch: Partial<Row>) {
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="max-w-prose text-xs text-pretty">
        <span className="font-medium">{formatCents(arrearsCents)} is past due on this lease.</span>{' '}
        The installments must add up to exactly that. Fill in as many as the plan
        needs and leave the rest blank.
        {/* B-212. The two money figures on this screen, said in one sentence so
            they cannot be mistaken for each other. The leases table above shows
            the lease's TOTAL BALANCE; a plan is agreed over what is already
            PAST DUE, which is smaller whenever this month's rent is invoiced
            and not yet due. A staffer typing the balance into these fields is
            refused, and the refusal never explained why the number they were
            looking at was the wrong one. */}
        {balanceCents !== arrearsCents && (
          <>
            {' '}
            The <span className="font-medium">{formatCents(balanceCents)}</span> total
            balance in the leases table above is a different figure — it includes
            rent that is invoiced but not due yet, which a plan does not cover.
          </>
        )}
      </p>
      <p className="text-muted-foreground max-w-prose text-xs text-pretty">
        Agreeing one places a hold that stops dunning, late fees and access
        suspension on this lease tonight;{' '}
        {/* B-210. The grace window is what the tenant will be told on the phone
            and in every plan email, so the person agreeing the plan has to be
            quoting the same rule. */}
        {planGraceDays > 0
          ? `an installment still unpaid ${planGraceDays} ${planGraceDays === 1 ? 'day' : 'days'} after its date`
          : 'missing an installment'}{' '}
        lifts it automatically and collections resume. Rent invoiced from here on
        is still due on its own date — a plan covers what is already past due, so
        paying next month&rsquo;s rent does not count towards an installment, and
        that rent is still collected on its own due date.
      </p>

      {/* Outside the <AdminForm> on two counts. These controls are a
          calculator, not plan data — nothing here should be posted — and
          `AdminForm` already owns a `role="status"` inside itself, which a
          second one in the same form would make ambiguous to every
          `form.getByRole('status')` in the suite (B-184's comment). */}
      <div className="border-input flex flex-col gap-2 rounded-md border p-3">
        <div className="flex flex-wrap items-end gap-3">
          {/* `Field` rather than hand-rolled controls even though these post
              nothing: it is where B-201's `min-w-0` lives, and the five local
              hand-copies of that class string are exactly why that fix reached
              some screens and not others. Outside the <form>, so the names are
              inert. */}
          <Field
            name="splitCount"
            label="Split into"
            as="select"
            value={count}
            onChange={(event) => setCount(Number(event.target.value))}
            className={FIELD_CLASS}
          >
            {Array.from({ length: MAX_INSTALLMENTS }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n} {n === 1 ? 'installment' : 'installments'}
              </option>
            ))}
          </Field>
          <Field
            name="splitStart"
            label="First one due"
            type="date"
            value={start}
            onChange={(event) => setStart(event.target.value)}
            className={FIELD_CLASS}
          />
          <button
            type="button"
            onClick={fill}
            disabled={!start}
            className="border-input hover:bg-accent inline-flex min-h-11 items-center justify-center rounded-md border bg-white px-4 text-sm font-medium disabled:opacity-50"
          >
            Fill the schedule
          </button>
        </div>
        <p className="text-muted-foreground text-xs text-pretty">
          Monthly from that date, adding up to {formatCents(arrearsCents)} exactly.
          Every field stays editable afterwards.
        </p>
        {/* The running total, `role="status"` so it is not sighted-only.
            B-248, and B-216's standard for what a comment here may claim: the
            region is polite and its text settles 700ms after the last
            keystroke, so ONE field edit produces one text change. Whether any
            screen reader then speaks it has not been observed here, and no
            announcement is asserted — the delay removes a known defect (six
            sentences per number typed), it does not buy a guarantee.

            Declared limitation, per B-248 and the same insertion problem as
            B-245: this whole component lives inside the closed <details> at
            the tenant profile's `page.tsx`, so the region enters the
            accessibility tree already populated when the staffer opens the
            disclosure. Hoisting it out would mean splitting the figure away
            from the fields it counts. The figure is also plain page content in
            reading order, so it is reachable by browsing whatever the live
            region does or does not do. */}
        <p role="status" className="text-sm font-medium tabular-nums">
          {settled}
        </p>
      </div>

      <AdminForm
        action={createPaymentPlanAction}
        label={`Agree a payment plan for unit ${unitNumber}`}
        className="flex flex-col gap-3"
        announceOutside
      >
        <input type="hidden" name="tenantId" value={tenantId} />
        <input type="hidden" name="leaseId" value={leaseId} />
        {/* B-246. `md:` not `sm:`. Tailwind's `sm` breakpoint is 640px, which
            is EXACTLY the viewport a 200%-zoom check produces — so three
            columns of a date field and a money field were being asked to fit
            in 640px and painted 18px past the right edge with no way to scroll
            to them. A counter staffer at 200% zoom, or on a phone in landscape,
            lost the third installment's amount box off the side of the screen.
            `min-w-0` on the fieldsets as well, per B-201: a date input has a
            wide intrinsic minimum and will not shrink to its column without
            being told it may. */}
        <div className="grid gap-2 md:grid-cols-3">
          {rows.map((row, index) => (
            // B-192. A real <fieldset>/<legend>, not a <div> with a <span> in
            // it. Six of these render twelve controls called "Due" and
            // "Amount ($)", and without the group name nothing ties any of
            // them to an ordinal — a screen-reader user meets twelve
            // identically-named fields (1.3.1, 3.3.2).
            //
            // `FieldSet` rather than a bare <fieldset> because the schedule's
            // refusals are about an INSTALLMENT, not about one of its two
            // fields: "must be in date order" belongs to the pair.
            // `validateSchedule` numbers its problems by installment, and
            // `createPaymentPlanAction` reports each under this key (3.3.1,
            // 3.3.3). B-213 owns what that key does and does not reach.
            <FieldSet
              key={index}
              name={`installment_${index + 1}`}
              legend={<span className="text-xs">Installment {index + 1}</span>}
              className="border-input flex min-w-0 flex-col gap-1 rounded-md border p-2"
            >
              {/* B-248. The visible <label> stays "Due" and "Amount ($)" —
                  under the <legend> that is what the column reads as, and
                  twelve fields called "Installment 3 due date" would be a
                  wall of repeated words on screen. The ORDINAL has to be in
                  the accessible name as well, because <legend> is announced
                  on ENTERING the group and a rotor jump straight to control
                  seventeen enters nothing: without it that list is
                  twenty-four entries reading "Due", "Amount ($)", twelve
                  times over (1.3.1, 3.3.2, and B-192's finding one level
                  down). `aria-label` overrides the visible name, so the two
                  must stay a superset of it — "Installment 3 due date"
                  contains "due" (2.5.3 Label in Name). */}
              <Field
                name={`dueDate_${index + 1}`}
                label="Due"
                aria-label={`Installment ${index + 1} due date`}
                type="date"
                value={row.dueDate}
                onChange={(event) => edit(index, { dueDate: event.target.value })}
                className={FIELD_CLASS}
              />
              <Field
                name={`amount_${index + 1}`}
                label="Amount ($)"
                aria-label={`Installment ${index + 1} amount ($)`}
                type="text"
                inputMode="decimal"
                value={row.amount}
                onChange={(event) => edit(index, { amount: event.target.value })}
                className={FIELD_CLASS}
              />
            </FieldSet>
          ))}
        </div>
        {/* D-97. Auto-collection is the default and the box is ticked;
            unticking it is the tenant asking to pay each installment
            themselves. Present at agreement rather than as a setting somewhere
            else, because it is a term of the conversation being had at that
            moment. */}
        <label className="flex max-w-prose items-start gap-2 text-sm">
          <input type="checkbox" name="autoCollect" defaultChecked className="mt-1 size-4" />
          <span>
            Charge each installment to the card on file on its due date.{' '}
            <span className="text-muted-foreground">
              Untick if the tenant would rather pay each one themselves. Either
              way this lease keeps paying its ordinary rent automatically if it
              already does — a plan defers what is past due, not what comes next.
            </span>
          </span>
        </label>
        <Field name="note" label="Note (optional)" className={FIELD_CLASS} />
        <div>
          <button
            type="submit"
            className="border-input hover:bg-accent inline-flex min-h-11 items-center justify-center rounded-md border px-4 text-sm font-medium"
          >
            Agree the plan for unit {unitNumber}
          </button>
        </div>
      </AdminForm>
    </div>
  )
}
