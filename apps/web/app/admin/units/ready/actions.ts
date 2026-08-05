'use server'

import { revalidatePath } from 'next/cache'
import { requireStaffActor } from '@/lib/rbac/session'
import { markUnitReadyToRent } from '@/lib/admin/move-out'

export async function markReadyToRentAction(formData: FormData): Promise<void> {
  const actor = await requireStaffActor()
  await markUnitReadyToRent(
    actor,
    String(formData.get('facilityId') ?? ''),
    String(formData.get('unitId') ?? ''),
  )
  revalidatePath('/admin/units/ready')
  revalidatePath('/admin/units')
}
