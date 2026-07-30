'use server'

import { revalidatePath } from 'next/cache'
import { DAYS_OF_WEEK, type WeeklySchedule } from '@storage/core/facility-settings'
import { requireStaffActor } from '@/lib/rbac/session'
import {
  addFeeScheduleEntry,
  addTaxComponent,
  updateFacilityDetails,
  updateFacilityHours,
} from '@/lib/admin/facility-settings'

function readWeeklySchedule(formData: FormData, namePrefix: string): WeeklySchedule {
  const schedule = {} as WeeklySchedule
  for (const day of DAYS_OF_WEEK) {
    const closed = formData.get(`${namePrefix}.${day}.closed`) != null
    schedule[day] = closed
      ? { closed: true }
      : {
          closed: false,
          open: String(formData.get(`${namePrefix}.${day}.open`) ?? ''),
          close: String(formData.get(`${namePrefix}.${day}.close`) ?? ''),
        }
  }
  return schedule
}

export async function updateFacilityDetailsAction(formData: FormData) {
  const actor = await requireStaffActor()
  const facilityId = String(formData.get('facilityId'))

  await updateFacilityDetails(actor, facilityId, {
    name: String(formData.get('name')),
    addressLine1: String(formData.get('addressLine1')),
    addressLine2: String(formData.get('addressLine2') || '') || null,
    city: String(formData.get('city')),
    state: String(formData.get('state')),
    postalCode: String(formData.get('postalCode')),
    timezone: String(formData.get('timezone')),
    phone: String(formData.get('phone') || '') || null,
    email: String(formData.get('email') || '') || null,
  })

  revalidatePath('/admin/settings')
}

export async function updateFacilityHoursAction(formData: FormData) {
  const actor = await requireStaffActor()
  const facilityId = String(formData.get('facilityId'))

  await updateFacilityHours(actor, facilityId, {
    officeHours: readWeeklySchedule(formData, 'officeHours'),
    gateHours: readWeeklySchedule(formData, 'gateHours'),
  })

  revalidatePath('/admin/settings')
}

export async function addTaxComponentAction(formData: FormData) {
  const actor = await requireStaffActor()
  const facilityId = String(formData.get('facilityId'))

  // Entered as a percentage (e.g. "8.25"); stored as basis points (825).
  // Rounded rather than truncated so "8.255" doesn't silently become 8.25.
  const percent = Number(formData.get('ratePercent'))
  const rateBasisPoints = Math.round(percent * 100)

  await addTaxComponent(actor, facilityId, {
    jurisdiction: String(formData.get('jurisdiction')),
    rateBasisPoints,
    effectiveFrom: new Date(String(formData.get('effectiveFrom'))),
  })

  revalidatePath('/admin/settings')
}

export async function addFeeScheduleEntryAction(formData: FormData) {
  const actor = await requireStaffActor()
  const facilityId = String(formData.get('facilityId'))

  // Entered in dollars; stored as cents, per the money-is-cents convention.
  const dollars = Number(formData.get('amountDollars'))
  const amountCents = Math.round(dollars * 100)

  await addFeeScheduleEntry(actor, facilityId, {
    feeType: String(formData.get('feeType')) as 'admin' | 'late' | 'nsf' | 'lien',
    amountCents,
    effectiveFrom: new Date(String(formData.get('effectiveFrom'))),
  })

  revalidatePath('/admin/settings')
}
