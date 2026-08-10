'use server'

import { revalidatePath } from 'next/cache'
import { requireStaffActor } from '@/lib/rbac/session'
import { createMaintenanceTicket, setTicketStatus } from '@/lib/admin/maintenance'
import type { MaintenanceTicketStatus } from '@storage/db'

export async function createTicketAction(formData: FormData): Promise<void> {
  const actor = await requireStaffActor()
  const facilityId = String(formData.get('facilityId') ?? '')
  const unitId = String(formData.get('unitId') ?? '')
  const title = String(formData.get('title') ?? '')
  const notes = String(formData.get('notes') ?? '')
  const priority = formData.get('priority') === 'high' ? 'high' : 'normal'
  const blocksAvailability = formData.get('blocksAvailability') === 'on'

  await createMaintenanceTicket(actor, facilityId, {
    unitId,
    title,
    notes: notes || null,
    priority,
    blocksAvailability,
    source: 'manual',
  })

  revalidatePath('/admin/maintenance')
  revalidatePath('/admin/units')
}

export async function updateTicketStatusAction(formData: FormData): Promise<void> {
  const actor = await requireStaffActor()
  const ticketId = String(formData.get('ticketId') ?? '')
  const status = String(formData.get('status') ?? '') as MaintenanceTicketStatus

  await setTicketStatus(actor, ticketId, status)

  revalidatePath('/admin/maintenance')
  revalidatePath('/admin/units')
}
