'use client'

import { AdminForm, Field } from '@/components/admin/form'
import { applyCreditAction } from '@/app/admin/tenants/[tenantId]/actions'
import { formatCents } from '@/lib/format'

// B-225. The control that ships with the value, per this repo's own rule.
//
// A credit that only three nightly jobs can spend is a number a staffer can
// see and not touch: the tenant on the phone asking "put that towards
// November, not December" has no answer. `billingPolicy`, `invoiceLeadDays`
// and the late-fee ladder all shipped reachable only from a database client
// and took two clean-up passes to close; this does not repeat that.
export function ApplyCreditForm({
  tenantId,
  creditCents,
  openInvoices,
}: {
  tenantId: string
  creditCents: number
  openInvoices: { id: string; number: string; outstandingCents: number }[]
}) {
  // Nothing to spend, or nothing to spend it on. A control that can never
  // succeed is worse than an absent one (B-212's finding, same screen).
  if (creditCents <= 0 || openInvoices.length === 0) return null

  return (
    <div className="border-input flex flex-col gap-2 rounded-md border p-3">
      <p className="max-w-prose text-sm text-pretty">
        <span className="font-medium">{formatCents(creditCents)} is on account</span> for
        this tenant at this facility. It is spent automatically on the next invoice
        raised, and on anything autopay would otherwise charge a card for. Put it
        somewhere specific here.
      </p>
      <AdminForm
        action={applyCreditAction}
        label="Apply credit on account"
        className="flex flex-wrap items-end gap-3"
      >
        <input type="hidden" name="tenantId" value={tenantId} />
        <Field
          name="invoiceId"
          label="Apply to"
          as="select"
          className="flex flex-col gap-1 text-sm"
          // B-225. The amount is NOT a field. It is min(what the invoice owes,
          // what the tenant has), and a typed figure would invent a third
          // quantity that can disagree with both.
          hint="However much of the credit that invoice can absorb."
        >
          {openInvoices.map((invoice) => (
            <option key={invoice.id} value={invoice.id}>
              {invoice.number} — {formatCents(invoice.outstandingCents)} outstanding
            </option>
          ))}
        </Field>
        <button
          type="submit"
          className="border-input hover:bg-accent inline-flex min-h-11 items-center justify-center rounded-md border px-4 text-sm font-medium"
        >
          Apply the credit
        </button>
      </AdminForm>
    </div>
  )
}
