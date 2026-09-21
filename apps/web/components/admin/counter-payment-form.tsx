'use client'

import { useId, useState } from 'react'
import { AdminForm, Field } from '@/components/admin/form'
import { takePaymentAction } from '@/app/admin/pos/actions'
import { formatCents } from '@/lib/format'
import { overflowWarning, unitList } from '@/lib/admin/counter-overflow'
import type { CounterPayableAccount, CounterPayableLease } from '@/lib/admin/pos'

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

/// B-280. The picker's value for a whole business account; `takePaymentAction`
/// reads the same prefix.
const ACCOUNT = 'account:'

/// B-339. Several of the tenant's own units in one payment, the first being
/// the anchor a surplus stays on; `takePaymentAction` reads the same prefix.
const UNITS = 'units:'

/// The aging in words, beside the money. "41 days past due" is what tells the
/// person taking the cash whether to mention the overlock before the tenant
/// walks back out — it is the same `daysPastDue` the access gate suspends on.
function aging(lease: { balanceCents: number; daysPastDue: number }): string {
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
  accounts,
  defaultLeaseId,
}: {
  facilityId: string
  tenantId: string
  leases: CounterPayableLease[]
  accounts: CounterPayableAccount[]
  defaultLeaseId?: string
}) {
  const [subject, setSubject] = useState(
    (leases.find((lease) => lease.leaseId === defaultLeaseId) ?? leases[0])?.leaseId ??
      `${ACCOUNT}${accounts[0].accountId}`,
  )
  const [amount, setAmount] = useState('')
  // B-319. Controlled, so changing the picker never touches it. It used to be
  // uncontrolled under a `key` that changed with the picker's class (unit,
  // former unit, account), which remounted it at `cash` — and a check typed
  // against the account then booked as cash against the unit, number and all.
  const [method, setMethod] = useState('cash')
  const [methodReset, setMethodReset] = useState('')
  const statusId = useId()

  // B-339. The unit last picked on its own, plus every OTHER unit of this
  // tenant's that owes: the several-unit subject B-305's entry asked for. A
  // unit pick still settles that unit only (B-305 stands); this is the option
  // the warning below offers when the amount says the tenant meant more.
  const [anchorId, setAnchorId] = useState(
    leases.some((l) => l.leaseId === subject) ? subject : (leases[0]?.leaseId ?? ''),
  )
  const anchor = leases.find((l) => l.leaseId === anchorId)
  const others = leases.filter((l) => l.leaseId !== anchorId && l.balanceCents > 0)
  const together = anchor && others.length > 0 ? [anchor, ...others] : []
  const togetherValue = `${UNITS}${together.map((l) => l.leaseId).join(',')}`
  const togetherUnits = unitList(together.map((l) => l.unitNumber))
  const togetherCents = together.reduce((sum, l) => sum + l.balanceCents, 0)

  // B-280. Either a whole account or one unit; everything below the picker
  // reads this one shape so the balance, the aging and "Pay in full" follow it.
  const account = accounts.find((a) => `${ACCOUNT}${a.accountId}` === subject)
  const several = !account && together.length > 0 && subject === togetherValue
  const lease = account || several ? null : (leases.find((l) => l.leaseId === subject) ?? leases[0])
  const selected = account
    ? { ...account, heading: account.name }
    : several
      ? {
          heading: togetherUnits,
          balanceCents: togetherCents,
          daysPastDue: Math.max(...together.map((l) => l.daysPastDue)),
          isFormer: together.every((l) => l.isFormer),
        }
      : { ...lease!, heading: lease!.unitNumber }

  // B-339 / O5. Said before submit, while the money is still on the desk.
  const warning = lease ? overflowWarning(lease, others, amount) : ''

  // Card is the one method a subject can rule out: the card screen needs an
  // open lease, and takes one unit (or, since B-320, one account) at a time.
  function chooseSubject(next: string) {
    setSubject(next)
    if (leases.some((l) => l.leaseId === next)) setAnchorId(next)
    const nextAccount = accounts.find((a) => `${ACCOUNT}${a.accountId}` === next)
    const nextSeveral = next.startsWith(UNITS)
    const nextFormer = (nextAccount ?? leases.find((l) => l.leaseId === next))?.isFormer
    if (method === 'card' && (nextFormer || nextSeveral)) {
      setMethod('cash')
      setMethodReset(
        nextSeveral
          ? 'Method changed from Card to Cash: the card screen takes one unit at a time.'
          : `Method changed from Card to Cash: ${nextAccount ? 'every unit on this account' : 'this unit'} has been moved out of, and a card needs an open lease.`,
      )
    } else {
      setMethodReset('')
    }
  }

  const leaseOptions = [
    ...leases.map((lease) => (
      <option key={lease.leaseId} value={lease.leaseId}>
        {label(lease)}
      </option>
    )),
    together.length > 0 && (
      <option key={togetherValue} value={togetherValue}>
        {togetherUnits} together — {formatCents(togetherCents)} due
      </option>
    ),
  ]

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
        label={accounts.length > 0 ? 'Unit or account' : 'Unit'}
        as="select"
        required
        className={FIELD_CLASS}
        value={subject}
        onChange={(event) => chooseSubject(event.target.value)}
      >
        {accounts.length > 0 ? (
          <>
            <optgroup label="Business account — one payment for every unit">
              {accounts.map((a) => (
                <option key={a.accountId} value={`${ACCOUNT}${a.accountId}`}>
                  {a.name} — {a.balanceCents > 0 ? `${formatCents(a.balanceCents)} due` : 'nothing due'}{' '}
                  across {a.unitNumbers.join(', ')}
                </option>
              ))}
            </optgroup>
            {leases.length > 0 && <optgroup label="Unit">{leaseOptions}</optgroup>}
          </>
        ) : (
          leaseOptions
        )}
      </Field>
      <Field
        name="method"
        label="Method"
        as="select"
        required
        className={FIELD_CLASS}
        value={method}
        onChange={(event) => {
          setMethod(event.target.value)
          setMethodReset('')
        }}
        // B-231. A former tenant's card is NOT offered here, and the omission is
        // deliberate rather than an oversight: `chargeableLease` scopes the card
        // screen to leases that have not ended, so a `card` selection on an
        // ended lease would redirect to a dead end. Cash, check and money order
        // are what the row was raised for — someone standing at the desk with
        // $400 — and widening the card path to closed leases is a change to the
        // money path, which this row says twice it is not.
      >
        <option value="cash">Cash</option>
        <option value="check">Check</option>
        <option value="money_order">Money order</option>
        {!selected.isFormer && !several && <option value="card">Card</option>}
      </Field>
      {/* B-319. Always mounted so the reset is announced, not just shown.
          B-334: `sr-only` while idle, never `empty:hidden` — that is
          `display:none`, which kept this region out of the accessibility tree
          until the moment it had text, so the reset was announced to nobody. */}
      <p
        id={statusId}
        role="status"
        className="col-span-2 text-sm font-medium text-pretty empty:sr-only"
      >
        {[methodReset, warning].filter(Boolean).join(' ')}
      </p>
      {warning && (
        <button
          type="button"
          onClick={() => chooseSubject(togetherValue)}
          className="border-input hover:bg-accent col-span-2 inline-flex min-h-11 items-center justify-self-start rounded-md border px-3 text-sm font-medium"
        >
          Pay {togetherUnits} together — {formatCents(togetherCents)} due
        </button>
      )}
      <div className="col-span-2 flex flex-wrap items-center gap-3">
        <p className="text-sm text-pretty">
          <span className="font-medium">
            {selected.heading} — {formatCents(selected.balanceCents)}
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
        aria-describedby={warning ? statusId : undefined}
      />
      {/* B-334. Each tender field shows only for its method. HIDDEN, not
          unmounted: a number typed under Check still submits after a switch to
          Cash, so B-319's server refusal ("Method is Cash, but a check number
          is filled in") catches the mis-pick instead of it booking silently as
          cash. `hidden` also takes the field out of the tab order and the
          accessibility tree, so nobody is asked for a number that does not
          apply. */}
      <Field
        name="tendered"
        label="Cash tendered ($)"
        inputMode="decimal"
        hint="Change is worked out for you."
        className={method === 'cash' ? FIELD_CLASS : 'hidden'}
      />
      <Field
        name="checkNumber"
        label={method === 'money_order' ? 'Money order number' : 'Check number'}
        className={method === 'check' || method === 'money_order' ? FIELD_CLASS : 'hidden'}
      />
      <p className="text-muted-foreground col-span-2 text-xs text-pretty">
        {account
          ? `Settles ${account.name}’s oldest invoices first, across ${account.unitNumbers.join(', ')}, and is receipted to ${account.payerName}. ${account.isFormer ? 'Every unit on it has been moved out of — cash, check or money order only.' : `Card takes you to the card screen, where ${account.payerName}’s card is charged — the one they hand over, or the one on file.`}`
          : several
          ? `Settles units ${togetherUnits}, oldest invoices first; anything over their balance stays as credit on ${anchor!.unitNumber}. Cash, check or money order — the card screen takes one unit at a time.`
          : selected.isFormer
          ? `Settles unit ${selected.heading} only; anything over its balance stays as credit on it. This unit has been moved out of — cash, check or money order only, because a card at the counter needs an open lease.`
          : `Settles unit ${selected.heading} only; anything over its balance stays as credit on it. Card takes you to the card screen with this amount, where the tenant enters their own details — or you can charge the card they have on file.`}
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
