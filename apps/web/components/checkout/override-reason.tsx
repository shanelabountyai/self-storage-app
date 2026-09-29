'use client'

import { Field, useFormState } from '@/components/admin/form'

/// B-415 / PRD 02 US-32. The reason a manager gives for renting to somebody
/// who matched a tenant owing money or flagged do not rent.
///
/// Rendered only while `submitCounterDetailsAction` is asking for it, so an
/// ordinary walk-in never sees the field. English, like every staff surface
/// (D-122).
export function OverrideReason() {
  const state = useFormState()
  const asked =
    (state.status === 'confirm' && state.confirmValue === 'override') ||
    (state.status === 'error' && 'overrideReason' in state.fieldErrors)
  if (!asked) return null

  return (
    <Field
      name="overrideReason"
      label="Reason for renting to them anyway"
      required
      className="flex flex-col gap-1 text-sm sm:col-span-2"
      hint="Recorded in the audit log with your name."
    />
  )
}
