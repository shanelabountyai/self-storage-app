'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import type { ManualUnitStatus } from '@storage/core/inventory'
import { requireStaffActor } from '@/lib/rbac/session'
import { UnitStatusChangeBlockedError, UnrentableRefusedError, createUnit, setUnitOperationalStatus } from '@/lib/admin/units'
import { fieldError, parseDate, type FormState } from '@/lib/admin/form-state'
import { applyBulkOperation, type BulkUnitOperation } from '@/lib/admin/units-bulk'
import { applyLayoutImport } from '@/lib/admin/unit-layout'
import type { UnitFilters } from '@/lib/admin/unit-query'

function readFilters(formData: FormData): UnitFilters {
  const floor = String(formData.get('filterFloor') ?? '')
  return {
    status: (String(formData.get('filterStatus') ?? '') || undefined) as UnitFilters['status'],
    unitTypeId: String(formData.get('filterUnitTypeId') ?? '') || undefined,
    building: String(formData.get('filterBuilding') ?? '') || undefined,
    floor: floor ? Number(floor) : undefined,
    search: String(formData.get('filterSearch') ?? '') || undefined,
  }
}

function readOperation(formData: FormData): BulkUnitOperation {
  const kind = String(formData.get('operationKind'))
  if (kind === 'status') {
    return { kind: 'status', operationalStatus: String(formData.get('operationalStatus')) as ManualUnitStatus }
  }
  if (kind === 'unitType') {
    return { kind: 'unitType', unitTypeId: String(formData.get('targetUnitTypeId')) }
  }
  const building = String(formData.get('targetBuilding') ?? '')
  const floor = String(formData.get('targetFloor') ?? '')
  const doorType = String(formData.get('targetDoorType') ?? '')
  return {
    kind: 'attributes',
    ...(building !== '' && { building: building === '—' ? null : building }),
    ...(floor !== '' && { floor: Number(floor) }),
    ...(doorType !== '' && { doorType: doorType === '—' ? null : doorType }),
  }
}

export async function createUnitAction(formData: FormData) {
  const actor = await requireStaffActor()
  const facilityId = String(formData.get('facilityId'))

  await createUnit(actor, facilityId, {
    unitTypeId: String(formData.get('unitTypeId')),
    number: String(formData.get('number')),
    building: String(formData.get('building') || '') || null,
    floor: Number(formData.get('floor') || 1),
    doorType: String(formData.get('doorType') || '') || null,
    notes: null,
  })

  revalidatePath('/admin/units')
}

export async function setUnitStatusAction(formData: FormData) {
  const actor = await requireStaffActor()

  // B-433. Unrentable needs a reason, a note and a review date, so the row's
  // one-press control hands over to the form that asks for them.
  if (formData.get('operationalStatus') === 'unrentable') {
    redirect(`/admin/units/unrentable?unit=${encodeURIComponent(String(formData.get('unitId')))}`)
  }

  await setUnitOperationalStatus(
    actor,
    String(formData.get('facilityId')),
    String(formData.get('unitId')),
    String(formData.get('operationalStatus')),
    String(formData.get('reasonCode') || 'management_approval'),
  )

  revalidatePath('/admin/units')
}

/// Confirmed apply. The preview itself is a GET (search params) so it can be
/// re-rendered and linked without a mutation — only this crosses the line.
export async function applyBulkAction(formData: FormData) {
  const actor = await requireStaffActor()

  await applyBulkOperation(
    actor,
    String(formData.get('facilityId')),
    readFilters(formData),
    readOperation(formData),
    String(formData.get('reasonCode') || 'management_approval'),
    String(formData.get('reasonNote') ?? '').trim() || null,
  )

  revalidatePath('/admin/units')
}

export async function applyLayoutImportAction(formData: FormData) {
  const actor = await requireStaffActor()

  await applyLayoutImport(
    actor,
    String(formData.get('facilityId')),
    String(formData.get('layoutJson')),
    String(formData.get('reasonCode') || 'management_approval'),
  )

  revalidatePath('/admin/units')
}

/// B-433. Marks one unit unrentable, or re-saves one that already is.
export async function markUnrentableAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireStaffActor()

  const reason = String(formData.get('reason') ?? '')
  if (!reason) return fieldError({ reason: 'Choose why the unit cannot be rented.' })
  const note = String(formData.get('note') ?? '').trim()
  if (!note) return fieldError({ note: 'Say what is wrong or who is using it, e.g. "roof leak over the door".' })

  let reviewAt: Date | null = null
  if (String(formData.get('reviewAt') ?? '').trim() !== '') {
    const parsed = parseDate(formData.get('reviewAt'))
    if ('error' in parsed) return fieldError({ reviewAt: parsed.error })
    reviewAt = parsed.value
  }

  try {
    await setUnitOperationalStatus(
      actor,
      String(formData.get('facilityId')),
      String(formData.get('unitId')),
      'unrentable',
      'management_approval',
      { reason, note, reviewAt },
    )
  } catch (error) {
    if (error instanceof UnrentableRefusedError) return fieldError({ reviewAt: error.message })
    if (error instanceof UnitStatusChangeBlockedError) return fieldError({ reason: error.message })
    throw error
  }

  revalidatePath('/admin/units')
  redirect('/admin/units/unrentable')
}
