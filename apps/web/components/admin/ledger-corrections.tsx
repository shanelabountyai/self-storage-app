'use client'

import { AdminForm, Field } from '@/components/admin/form'
import {
  adjustLedgerAction,
  voidInvoiceAction,
  writeOffLedgerAction,
} from '@/app/admin/tenants/[tenantId]/ledger/[leaseId]/actions'

// B-303. The buttons the exception report has been promising since B-277.
//
// All three live on the ledger screen rather than on the exception row itself,
// and that is deliberate: the report's row already links here, and a correction
// posted from a list is posted by somebody who has not looked at the ledger it
// corrects.
//
// The one field asks what the BALANCE should change by, not what entry to post,
// because those are different questions and only the operator can answer the
// first. B-292 left two permanently broken shapes and they need opposite
// answers: a payment that landed on the wrong unit needs the balance moved, and
// an invoice that a transfer carried away needs it left exactly where it is.
// `postLedgerAdjustment` works out the entries either way — the comment on it
// has the arithmetic.

/// The reason vocabulary, narrowed to what actually explains a ledger that
/// disagrees with its invoices. Free text stays in the note beside it; the code
/// is what keeps the audit log filterable, the same discipline `WAIVER_REASONS`
/// uses on the tenant profile.
const CORRECTION_REASONS = [
  { value: 'multi_unit_payment', label: 'Payment split across units before B-257' },
  { value: 'transfer_residue', label: 'Balance left behind by a transfer' },
  { value: 'billing_error', label: 'Billing error' },
  { value: 'system_error', label: 'System error' },
  { value: 'management_approval', label: 'Management approval' },
  { value: 'other', label: 'Other (explain in the note)' },
] as const

const WRITE_OFF_REASONS = [
  { value: 'uncollectible', label: 'Uncollectible — tenant cannot be traced' },
  { value: 'bankruptcy', label: 'Bankruptcy' },
  { value: 'settlement', label: 'Settled for less' },
  { value: 'management_approval', label: 'Management approval' },
  { value: 'other', label: 'Other (explain in the note)' },
] as const

const VOID_REASONS = [
  { value: 'billing_error', label: 'Billing error' },
  { value: 'duplicate', label: 'Duplicate invoice' },
  { value: 'wrong_period', label: 'Wrong period billed' },
  { value: 'rate_not_agreed', label: 'Rate was never agreed' },
  { value: 'other', label: 'Other (explain in the note)' },
] as const

const BUTTON =
  'border-input hover:bg-accent inline-flex min-h-11 items-center justify-center self-start rounded-md border px-4 text-sm font-medium'

function ReasonField({
  reasons,
}: {
  reasons: readonly { value: string; label: string }[]
}) {
  return (
    <Field name="reasonCode" label="Reason" as="select" required defaultValue="">
      <option value="">Choose a reason…</option>
      {reasons.map((reason) => (
        <option key={reason.value} value={reason.value}>
          {reason.label}
        </option>
      ))}
    </Field>
  )
}

export function LedgerCorrections({
  tenantId,
  leaseId,
  unitLabel,
  differenceCents,
  balanceCents,
  balance,
  difference,
  voidableInvoices,
}: {
  tenantId: string
  leaseId: string
  /// What these act on, in a form that reads on its own — "unit 104". Composed
  /// into each form's name so a rotor listing three of them hears which is
  /// which (2.4.6).
  unitLabel: string
  /// The reconciliation difference, or 0 where the lease reconciles. Only used
  /// to pre-fill the suggested correction.
  differenceCents: number
  balanceCents: number
  /// Both pre-formatted by the server component, for the same reason the
  /// invoice amounts are.
  balance: string
  difference: string
  /// Pre-formatted by the server component — `formatCents` and the facility's
  /// own date formatting both live there, and a client bundle does not need a
  /// second copy of either.
  voidableInvoices: { id: string; number: string; outstanding: string; period: string }[]
}) {
  // What to type if the disagreement is the BALANCE's fault: the difference,
  // negated. Deriving it is the step a person gets wrong, so the hint says it
  // rather than pre-filling it — a pre-filled restatement of what somebody owes
  // is one press away from being posted by a staffer who did not decide it.
  const suggested = (-differenceCents / 100).toFixed(2)

  return (
    <div className="flex flex-col gap-6">
      <AdminForm
        action={adjustLedgerAction}
        label={`Post a ledger correction — ${unitLabel}`}
        className="flex flex-col gap-3"
      >
        <input type="hidden" name="tenantId" value={tenantId} />
        <input type="hidden" name="leaseId" value={leaseId} />
        <h3 className="text-sm font-medium">Correct the ledger</h3>
        <p className="text-muted-foreground max-w-prose text-xs text-pretty">
          Restates this lease so its ledger and its invoices agree. Say what the balance should
          change by — including nothing at all, if the balance is already right. It does not move a
          payment and it does not change an invoice.
        </p>

        <div className="flex flex-wrap items-end gap-3">
          <Field
            name="amountDollars"
            label="Change the balance by ($)"
            inputMode="decimal"
            required
            defaultValue="0.00"
            className="flex flex-col gap-1 text-sm"
            hint={
              differenceCents === 0
                ? `This lease owes ${balance}. Negative reduces that; positive increases it.`
                : `This lease owes ${balance} and its invoices disagree by ${difference}. Enter ${suggested} if the tenant does not owe that; leave it at 0.00 if the balance is right and it is the invoices that moved. Either way the two are brought back into line.`
            }
          />
          <ReasonField reasons={CORRECTION_REASONS} />
        </div>

        <Field
          name="note"
          label="Note (optional)"
          className="flex flex-col gap-1 text-sm"
          hint="Recorded against your name permanently."
        />

        <button type="submit" className={BUTTON}>
          Post correction
          <span className="sr-only"> to {unitLabel}</span>
        </button>
      </AdminForm>

      {balanceCents > 0 && (
        <AdminForm
          action={writeOffLedgerAction}
          label={`Write off the balance — ${unitLabel}`}
          className="border-input flex flex-col gap-3 border-t pt-6"
        >
          <input type="hidden" name="tenantId" value={tenantId} />
          <input type="hidden" name="leaseId" value={leaseId} />
          <h3 className="text-sm font-medium">Write off the balance</h3>
          <p className="text-muted-foreground max-w-prose text-xs text-pretty">
            Forgives everything this lease owes as bad debt and marks the invoices behind it
            uncollectible. The lease stays open and the entries stay on the ledger. It is measured
            against your credit limit.
          </p>
          <ReasonField reasons={WRITE_OFF_REASONS} />
          <Field name="note" label="Note (optional)" className="flex flex-col gap-1 text-sm" />
          <button type="submit" className={BUTTON}>
            Write off the balance
            <span className="sr-only"> on {unitLabel}</span>
          </button>
        </AdminForm>
      )}

      {voidableInvoices.length > 0 && (
        <section
          aria-labelledby="void-heading"
          className="border-input flex flex-col gap-3 border-t pt-6"
        >
          <h3 id="void-heading" className="text-sm font-medium">
            Void a rent invoice
          </h3>
          <p className="text-muted-foreground max-w-prose text-xs text-pretty">
            For an invoice that should never have been raised. The charge and the entry that
            cancels it both stay on the ledger. The period will not be billed again — raise a
            corrected charge from the tenant profile if it should be.
          </p>
          <ul className="flex flex-col gap-3">
            {voidableInvoices.map((invoice) => (
              <li key={invoice.id} className="border-input rounded-lg border p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium tabular-nums">{invoice.outstanding}</span>
                  <span className="text-muted-foreground text-xs">
                    Invoice {invoice.number} · {invoice.period}
                  </span>
                </div>
                <AdminForm
                  action={voidInvoiceAction}
                  label={`Void invoice ${invoice.number}`}
                  className="mt-3 flex flex-wrap items-end gap-2"
                >
                  <input type="hidden" name="tenantId" value={tenantId} />
                  <input type="hidden" name="leaseId" value={leaseId} />
                  <input type="hidden" name="invoiceId" value={invoice.id} />
                  <ReasonField reasons={VOID_REASONS} />
                  <Field name="note" label="Note (optional)" />
                  <button type="submit" className={BUTTON}>
                    Void
                    <span className="sr-only"> invoice {invoice.number}</span>
                  </button>
                </AdminForm>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
