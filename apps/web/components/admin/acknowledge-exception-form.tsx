'use client'

import { AdminForm, Field } from '@/components/admin/form'
import { acknowledgeExceptionAction } from '@/app/admin/reports/ledger-exceptions/actions'

// B-304. One row's "reviewed, known".
//
// It does not clear the exception and it does not hide the row — the lease
// stays on this report, visibly marked, because the ledger still disagrees and
// B-303 is what repairs that. What it stops is the daily high-priority task
// naming a lease a person has already decided about, so that task can mean
// "something new" again.

export function AcknowledgeExceptionForm({
  leaseId,
  tenantName,
  unitNumber,
}: {
  leaseId: string
  tenantName: string
  unitNumber: string
}) {
  const subject = `${tenantName}, unit ${unitNumber}`
  return (
    <AdminForm
      action={acknowledgeExceptionAction}
      label={`Mark reviewed — ${subject}`}
      className="flex flex-wrap items-end gap-2"
    >
      <input type="hidden" name="leaseId" value={leaseId} />
      {/* A visible label, not a placeholder. A placeholder is gone the moment
          somebody types and is the field's only name until then (3.3.2), and
          this control lives in a dense table cell where reaching for one is
          exactly the temptation. The subject rides along `sr-only` so a rotor
          listing one of these per row hears which lease it is (2.4.6). */}
      <Field
        name="note"
        label={
          <>
            What you found<span className="sr-only"> — {subject}</span>
          </>
        }
        required
        className="flex flex-col gap-1 text-xs"
      />
      <button
        type="submit"
        className="border-input hover:bg-accent inline-flex min-h-11 items-center justify-center rounded-md border px-3 text-sm font-medium"
      >
        Mark reviewed
        <span className="sr-only"> — {subject}</span>
      </button>
    </AdminForm>
  )
}
