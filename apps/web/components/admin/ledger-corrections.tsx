'use client'

import { AdminForm, Field } from '@/components/admin/form'
import { AnnounceRegion } from '@/components/admin/announce'
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
  ///
  /// B-338: `rebill` is what the next run bills for the period once it is
  /// voided, or null where it will not bill it again; `rebillIsSame` is whether
  /// that equals the amount being voided.
  voidableInvoices: {
    id: string
    number: string
    outstanding: string
    period: string
    rebill: string | null
    rebillIsSame: boolean
  }[]
}) {
  // What to type if the disagreement is the BALANCE's fault: the difference,
  // negated. Deriving it is the step a person gets wrong, so the hint says it
  // rather than pre-filling it — a pre-filled restatement of what somebody owes
  // is one press away from being posted by a staffer who did not decide it.
  const suggested = (-differenceCents / 100).toFixed(2)

  return (
    <div className="flex flex-col gap-6">
      {/* B-333 / SC 4.1.3, 2.4.3. Two of the three forms below REMOVE
          themselves by succeeding — a written-off balance reaches zero and
          fails `balanceCents > 0`, a voided invoice leaves `voidableInvoices`
          and takes its `<li>` with it — so the `role="status"` inside
          `AdminForm` was unmounted in the same commit that populated it.
          Nothing was announced, nothing was PRINTED either, and focus fell
          from the submit to `<body>`. B-327's and B-328's "the next run bills
          it again at the current rate" sentence is in that lost message, so
          the one line telling a manager what a void does next never arrived.

          B-170's region is the fix rather than a second mechanism: it is
          mounted here, above all three, where no correction can remove it,
          and `announceOutside` pushes the success text up from the action
          while the form is still mounted.

          The adjustment form deliberately does NOT opt in. It survives its own
          success — it renders unconditionally — so its message belongs where
          the reader already is, and focus stays on its submit button rather
          than being pulled to the top of the section. That is B-170's own
          rule, not an omission. */}
      <AnnounceRegion>
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
          announceOutside
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
            cancels it both stay on the ledger. If the invoice is for the current period and the
            lease is active, the next billing run bills it again at the lease&rsquo;s current rate,
            with any promotion or referral credit this invoice carried. An earlier period is not
            billed again automatically. An invoice money has already been paid against is not
            listed here: refund the paid part first and then void it, or post a correction for
            the difference.
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
                  announceOutside
                >
                  <input type="hidden" name="tenantId" value={tenantId} />
                  <input type="hidden" name="leaseId" value={leaseId} />
                  <input type="hidden" name="invoiceId" value={invoice.id} />
                  <ReasonField reasons={VOID_REASONS} />
                  <Field name="note" label="Note (optional)" />
                  {/* B-338. Pre-submit, so it lives INSIDE the form — the
                      region above is for what happened, this is what will.
                      Text tied to the submit rather than a colour (1.4.1): a
                      "rate was never agreed" void with the rate unchanged
                      re-bills exactly what it cancels, and the only place to
                      catch that is before the press. */}
                  {invoice.rebill && (
                    <p id={`rebill-${invoice.id}`} className="basis-full max-w-prose text-xs text-pretty">
                      {invoice.rebillIsSame && <strong>Same amount. </strong>}
                      The next billing run bills this period again at {invoice.rebill}
                      {invoice.rebillIsSame
                        ? ' — exactly what you are voiding. If the rate is what was wrong, change the lease\u2019s rate first.'
                        : ', due the day it is raised.'}{' '}
                      The tenant is sent the updated invoice.
                    </p>
                  )}
                  <button
                    type="submit"
                    className={BUTTON}
                    aria-describedby={invoice.rebill ? `rebill-${invoice.id}` : undefined}
                  >
                    Void
                    <span className="sr-only"> invoice {invoice.number}</span>
                  </button>
                </AdminForm>
              </li>
            ))}
          </ul>
        </section>
      )}
      </AnnounceRegion>
    </div>
  )
}
