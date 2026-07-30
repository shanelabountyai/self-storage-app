'use server'

import { revalidatePath } from 'next/cache'
import { requireStaffActor } from '@/lib/rbac/session'
import { cloneUnitType, createUnitType, updateUnitType, type UnitTypeInput } from '@/lib/admin/unit-types'

function readUnitTypeInput(formData: FormData): UnitTypeInput {
  const heightFt = String(formData.get('heightFt') ?? '').trim()
  return {
    name: String(formData.get('name')),
    widthFt: Number(formData.get('widthFt')),
    lengthFt: Number(formData.get('lengthFt')),
    heightFt: heightFt ? Number(heightFt) : null,
    climateControlled: formData.get('climateControlled') != null,
    driveUp: formData.get('driveUp') != null,
    floor: Number(formData.get('floor') || 1),
    powerAvailable: formData.get('powerAvailable') != null,
    description: String(formData.get('description') || '') || null,
    // Entered in dollars; stored in cents, per the money-is-cents convention.
    streetRateCents: Math.round(Number(formData.get('streetRateDollars')) * 100),
    webRateCents: Math.round(Number(formData.get('webRateDollars')) * 100),
  }
}

export async function createUnitTypeAction(formData: FormData) {
  const actor = await requireStaffActor()
  const facilityId = String(formData.get('facilityId'))

  await createUnitType(actor, facilityId, readUnitTypeInput(formData))

  revalidatePath('/admin/units/types')
}

export async function updateUnitTypeAction(formData: FormData) {
  const actor = await requireStaffActor()
  const facilityId = String(formData.get('facilityId'))
  const unitTypeId = String(formData.get('unitTypeId'))

  await updateUnitType(actor, facilityId, unitTypeId, readUnitTypeInput(formData))

  revalidatePath('/admin/units/types')
}

export async function cloneUnitTypeAction(formData: FormData) {
  const actor = await requireStaffActor()
  const sourceUnitTypeId = String(formData.get('unitTypeId'))
  const targetFacilityId = String(formData.get('targetFacilityId'))

  await cloneUnitType(actor, sourceUnitTypeId, targetFacilityId)

  revalidatePath('/admin/units/types')
}
