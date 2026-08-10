'use server'

import { revalidatePath } from 'next/cache'
import { requireStaffActor } from '@/lib/rbac/session'
import { createMaintenanceTicket } from '@/lib/admin/maintenance'

// PRD 02 §4.9 US-35's "free-form findings that convert to maintenance
// tickets" — this is that conversion.
export async function reportFindingAction(formData: FormData): Promise<void> {
  const actor = await requireStaffActor()
  const facilityId = String(formData.get('facilityId') ?? '')
  const unitId = String(formData.get('unitId') ?? '')
  const title = String(formData.get('title') ?? '')
  const blocksAvailability = formData.get('blocksAvailability') === 'on'

  await createMaintenanceTicket(actor, facilityId, {
    unitId,
    title,
    notes: null,
    priority: 'normal',
    blocksAvailability,
    source: 'walkthrough',
  })

  revalidatePath('/admin/walkthrough')
  revalidatePath('/admin/maintenance')
  revalidatePath('/admin/units')
}
