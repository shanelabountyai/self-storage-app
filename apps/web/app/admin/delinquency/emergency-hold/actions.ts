'use server'

import { revalidatePath } from 'next/cache'
import { requireStaffActor } from '@/lib/rbac/session'
import { fieldError, parseDate, success, type FormState } from '@/lib/admin/form-state'
import { emergencyHoldFacilities, placeEmergencyHold, type EmergencyHoldInput } from '@/lib/admin/emergency-hold'

// B-420. One press places an emergency hold across facilities. Same
// confirm-and-echo step as the broadcast, and for the same reason: the count
// is computed at the press, never trusted from the page.

function inputFrom(formData: FormData): { input: EmergencyHoldInput; errors: Record<string, string> } {
  const errors: Record<string, string> = {}
  const facilityIds = formData.getAll('facilityIds').map(String).filter(Boolean)
  const county = String(formData.get('county') ?? '').trim()
  const state = String(formData.get('state') ?? '').trim().toUpperCase()
  const from = parseDate(formData.get('effectiveFrom'))
  const through = parseDate(formData.get('effectiveThrough'))
  if ('error' in from) errors.effectiveFrom = from.error
  if ('error' in through) errors.effectiveThrough = through.error
  if (facilityIds.length === 0 && !county) errors.county = 'Pick at least one facility, or name a county.'
  if (county && !/^[A-Z]{2}$/.test(state)) errors.state = 'State must be a 2-letter code, for example TX.'
  const reason = String(formData.get('reason') ?? '').trim()
  if (!reason) errors.reason = 'Say what the emergency is. It is shown on every affected tenant profile.'
  const subject = String(formData.get('subject') ?? '').trim()
  const message = String(formData.get('message') ?? '').trim()
  if ((subject && !message) || (!subject && message)) {
    errors.message = 'A broadcast needs both a subject and a message, or leave both blank to send nothing.'
  }
  return {
    errors,
    input: {
      facilityIds,
      county: county ? { state, county } : null,
      effectiveFrom: 'value' in from ? from.value : new Date(NaN),
      // "Through" is inclusive: the hold ends at midnight after the last day.
      effectiveTo: 'value' in through ? new Date(through.value.getTime() + 86_400_000) : new Date(NaN),
      reason,
      broadcast: subject && message ? { subject, message } : null,
    },
  }
}

export async function placeEmergencyHoldAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireStaffActor()
  const { input, errors } = inputFrom(formData)
  if (Object.keys(errors).length > 0) return fieldError(errors)
  if (input.effectiveTo.getTime() <= input.effectiveFrom.getTime()) {
    return fieldError({ effectiveThrough: 'The last day must be on or after the first day.' })
  }

  const facilities = await emergencyHoldFacilities(input)
  if (facilities.length === 0) {
    return fieldError({ county: 'No active facility matches that. Check the county spelling under each facility’s settings.' })
  }

  if (formData.get('confirmed') !== 'yes') {
    const day = (date: Date) => date.toISOString().slice(0, 10)
    return {
      status: 'confirm',
      message: 'Check this before it is placed. Every current lease at these sites stops collections tonight.',
      confirmLabel: `Yes, hold ${facilities.length} ${facilities.length === 1 ? 'facility' : 'facilities'}`,
      echo: [
        { label: 'Facilities', value: facilities.map((f) => f.name).join(', ') },
        { label: 'From', value: day(input.effectiveFrom) },
        { label: 'Through', value: day(new Date(input.effectiveTo.getTime() - 86_400_000)) },
        { label: 'Reason', value: input.reason },
        { label: 'Broadcast', value: input.broadcast ? `“${input.broadcast.subject}” to every current tenant` : 'None' },
      ],
    }
  }

  let result
  try {
    result = await placeEmergencyHold(actor, input)
  } catch (error) {
    // A ForbiddenError names the facility the actor cannot reach. Nothing was
    // placed: every site is checked before the first write.
    const message = error instanceof Error ? error.message : 'The emergency hold could not be placed.'
    return { status: 'error', message, fieldErrors: {} }
  }
  if (!result.ok) {
    switch (result.reason) {
      case 'bad_dates':
        return fieldError({ effectiveThrough: 'The last day must be on or after the first day.' })
      case 'missing_reason':
        return fieldError({ reason: 'Say what the emergency is.' })
      default:
        return fieldError({ county: 'No active facility matches that any more. Nothing was placed.' })
    }
  }

  revalidatePath('/admin/delinquency')
  const sent = result.broadcast.reduce((sum, one) => sum + one.sent, 0)
  const refused = result.broadcast.filter((one) => one.problem).length
  return success(
    `Emergency hold placed on ${result.leases} ${result.leases === 1 ? 'lease' : 'leases'} at ${result.facilities} ${result.facilities === 1 ? 'facility' : 'facilities'}.`,
    [
      ...(input.broadcast ? [`${sent} tenants emailed`] : []),
      ...(refused > 0 ? [`the broadcast was refused at ${refused} ${refused === 1 ? 'site' : 'sites'} — see Announcements`] : []),
    ],
  )
}
