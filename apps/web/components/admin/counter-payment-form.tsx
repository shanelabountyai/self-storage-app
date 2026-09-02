'use client'

import { useState } from 'react'
import { AdminForm, Field } from '@/components/admin/form'
import { takePaymentAction } from '@/app/admin/pos/actions'
import { formatCents } from '@/lib/format'
import type { CounterPayableLease } from '@/lib/admin/pos'

// B-231 / D-110(A). The counter screen finally shows what the tenant owes.
//
// Until this row the form was Unit / Method / Amount with no reference figure
// anywhere on it: a walk-in payment was search → open the profile in another
// tab → read the balance → come back → retype it, and a tenant with two units
// got the money applied to whichever one the staffer guessed. The figure was
// never gated in any meaningful sense — the same person reads it on the tenant
// profile under `tenants:view`, one screen away.
//
// A client component for the same reason `PaymentPlanBuilder` is one: the
// "Pay in full" button fills the amount field and LEAVES IT EDITABLE. Part
// payment at a counter is the normal case, not the exception, so the button is
// a prefill and never a second way of deciding the amount — `takePaymentAction`
// still reads whatever is in the box.

const FIELD_CLASS = 'flex flex-col gap-1 text-sm'

/// The aging in words, beside the money. "41 days past due" is what tells the
/// person taking the cash whether to mention the overlock before the tenant
/// walks back out — it is the same `daysPastDue` the access gate suspends on.
function aging(lease: CounterPayableLease): string {
  if (lease.balanceCents <= 0) return 'nothing owed'
  if (lease.daysPastDue <= 0) return 'due now'
  return `${lease.daysPastDue} day${lease.daysPastDue === 1 ? '' : 's'} past due`
}

function label(lease: CounterPayableLease): string {
  const money = lease.balanceCents > 0 ? `${formatCents(lease.balanceCents)} due` : 'nothing due'
  return `${lease.unitNumber} — ${money}${lease.isFormer ? ' (former tenant)' : ''}`
}

export function CounterPaymentForm({
  facilityId,
  tenantId,
  leases,
  defaultLeaseId,
}: {
  facilityId: string
  tenantId: string
  leases: CounterPayableLease[]
  defaultLeaseId?: string
}) {
  const initial = leases.find((lease) => lease.leaseId === defaultLeaseId) ?? leases[0]
  const [leaseId, setLeaseId] = useState(initial.leaseId)
  const [amount, setAmount] = useState('')

  const selected = leases.find((lease) => lease.leaseId === leaseId) ?? initial

  return (
    <AdminForm
      action={takePaymentAction}
      label="Take a payment"
      className="mt-3 grid max-w-lg grid-cols-2 gap-3"
    >
      <input type="hidden" name="facilityId" value={facilityId} />
      <input type="hidden" name="tenantId" value={tenantId} />
      <Field
        name="leaseId"
        label="Unit"
        as="select"
        required
        className={FIELD_CLASS}
        value={leaseId}
        onChange={(event) => setLeaseId(event.target.value)}
      >
        {leases.map((lease) => (
          <option key={lease.leaseId} value={lease.leaseId}>
            {label(lease)}
          </option>
        ))}
      </Field>
      <Field
        name="method"
        label="Method"
        as="select"
        defaultValue="cash"
        required
        className={FIELD_CLASS}
        // B-231. A former tenant's card is NOT offered here, and the omission is
        // deliberate rather than an oversight: `chargeableLease` scopes the card
        // screen to leases that have not ended, so a `card` selection on an
        // ended lease would redirect to a dead end. Cash, check and money order
        // are what the row was raised for — someone standing at the desk with
        // $400 — and widening the card path to closed leases is a change to the
        // money path, which this row says twice it is not.
        key={selected.isFormer ? 'former' : 'current'}
      >
        <option value="cash">Cash</option>
        <option value="check">Check</option>
        <option value="money_order">Money order</option>
        {!selected.isFormer && <option value="card">Card</option>}
      </Field>
      <div className="col-span-2 flex flex-wrap items-center gap-3">
        <p className="text-sm text-pretty">
          <span className="font-medium">
            {selected.unitNumber} — {formatCents(selected.balanceCents)}
          </span>
          , {aging(selected)}
          {selected.isFormer ? ' · moved out, so this is former-tenant AR' : ''}
        </p>
        {selected.balanceCents > 0 && (
          <button
            type="button"
            onClick={() => setAmount((selected.balanceCents / 100).toFixed(2))}
            className="border-input hover:bg-accent inline-flex min-h-11 items-center rounded-md border px-3 text-sm font-medium"
          >
            Pay in full — {formatCents(selected.balanceCents)}
          </button>
        )}
      </div>
      <Field
        name="amount"
        label="Amount ($)"
        inputMode="decimal"
        required
        className={FIELD_CLASS}
        value={amount}
        onChange={(event) => setAmount(event.target.value)}
      />
      <Field
        name="tendered"
        label="Cash tendered ($)"
        inputMode="decimal"
        hint="Cash only — change is worked out for you."
        className={FIELD_CLASS}
      />
      <Field
        name="checkNumber"
        label="Check / money-order number"
        hint="Required for check and money order."
        className={`${FIELD_CLASS} col-span-2`}
      />
      <p className="text-muted-foreground col-span-2 text-xs text-pretty">
        {selected.isFormer
          ? 'This unit has been moved out of. Cash, check or money order only — a card at the counter needs an open lease.'
          : 'Card takes you to the card screen with this amount, where the tenant enters their own details — or you can charge the card they have on file.'}
      </p>
      <button
        type="submit"
        className="bg-primary text-primary-foreground col-span-2 inline-flex min-h-11 items-center justify-center self-start rounded-md px-4 text-sm font-medium"
      >
        Record payment
      </button>
    </AdminForm>
  )
}
