'use server'

import { revalidatePath } from 'next/cache'
import type { ManualUnitStatus } from '@storage/core/inventory'
import { requireStaffActor } from '@/lib/rbac/session'
import { createUnit, setUnitOperationalStatus } from '@/lib/admin/units'
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
