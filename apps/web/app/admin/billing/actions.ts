'use server'

import { revalidatePath } from 'next/cache'
import { requireStaffActor } from '@/lib/rbac/session'
import { rerunJobRun } from '@/lib/admin/billing-runs'

// FR-4's "manually re-runnable by admin". A plain form action: the outcome the
// operator wants to see is the run's own row, which the revalidated table
// already shows with its new status and item counts.
export async function rerunAction(formData: FormData): Promise<void> {
  const actor = await requireStaffActor()
  await rerunJobRun(actor, String(formData.get('runId') ?? ''))
  revalidatePath('/admin/billing')
}
