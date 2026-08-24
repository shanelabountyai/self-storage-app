'use client'

import { useState } from 'react'
import { AdminForm, Field } from '@/components/admin/form'
import { chargeFeeAction } from '@/app/admin/tenants/[tenantId]/actions'
import type { ChargeableFee } from '@/lib/billing/charges'

// PRD 02 §4.5 US-21/US-23 (B-167). One charge control, rendered on the tenant
// profile and on the move-out screen — the two places a fee is actually
// discovered. One component and one action for both, the same device
// `TaskCompleteForm` uses across four task queues: two forms would be two
// places for the authority rule to drift.
//
// The amount is PRE-FILLED from the facility's schedule and is editable, and
// the editability is the part that carries a rule: departing from the schedule
// in either direction is measured against the actor's fee-waiver limit
// (`postFeeCharge`). A counter staffer's limit is $0, so for them the field is
// effectively a display of the facility's own price — and the refusal, when it
// comes, names the limit and who can carry it rather than just saying no.

function dollars(cents: number): string {
  return (cents / 100).toFixed(2)
}

export function ChargeFeeForm({
  tenantId,
  leaseId,
  fees,
  unitLabel,
}: {
  tenantId: string
  leaseId: string
  fees: ChargeableFee[]
  /// What this charge is against, in a form that reads on its own — "unit 104".
  /// Composed into the form and button names so a rotor listing a page with
  /// several of these hears which is which (2.4.6).
  unitLabel: string
}) {
  const [feeType, setFeeType] = useState<string>(fees[0]?.feeType ?? '')
  const selected = fees.find((fee) => fee.feeType === feeType)

  return (
    <AdminForm
      action={chargeFeeAction}
      label={`Charge a fee — ${unitLabel}`}
      className="flex flex-col gap-3"
    >
      <input type="hidden" name="tenantId" value={tenantId} />
      <input type="hidden" name="leaseId" value={leaseId} />

      <div className="flex flex-wrap items-end gap-3">
        <Field
          name="feeType"
          label="Fee"
          as="select"
          value={feeType}
          onChange={(event) => setFeeType(event.target.value)}
          className="flex flex-col gap-1 text-sm"
        >
          {fees.map((fee) => (
            <option key={fee.feeType} value={fee.feeType}>
              {fee.label}
              {fee.scheduledCents === null ? ' (no price set)' : ` — $${dollars(fee.scheduledCents)}`}
            </option>
          ))}
        </Field>

        {/* `key` on the amount field so changing the fee type re-mounts it with
            the new schedule as its default. Without it React keeps the old
            typed value and a staffer switching from Cleaning to Damage silently
            charges the cleaning price. */}
        <Field
          key={feeType}
          name="amountDollars"
          label="Amount ($)"
          inputMode="decimal"
          required
          defaultValue={selected?.scheduledCents != null ? dollars(selected.scheduledCents) : ''}
          className="flex flex-col gap-1 text-sm"
          hint={
            selected?.scheduledCents == null
              ? 'This facility has not priced this fee. Anything you charge needs waiver authority.'
              : 'Changing this from the facility price needs waiver authority.'
          }
        />
      </div>

      <Field
        name="note"
        label="What it is for"
        required
        className="flex flex-col gap-1 text-sm"
        hint="The tenant reads this on their invoice, and it is recorded against you permanently."
      />

      <button
        type="submit"
        aria-label={`Charge this fee to ${unitLabel}`}
        className="border-input hover:bg-accent inline-flex min-h-11 items-center justify-center self-start rounded-md border px-4 text-sm font-medium"
      >
        Charge
      </button>
    </AdminForm>
  )
}
