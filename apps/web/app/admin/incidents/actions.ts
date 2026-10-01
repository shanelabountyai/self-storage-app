'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { prisma } from '@storage/db'
import { zoneOffsetMinutes } from '@storage/core/jobs'
import { requireStaffActor } from '@/lib/rbac/session'
import { fieldError, success, type FormState } from '@/lib/admin/form-state'
import {
  GATE_LOG_EXCERPT_MAX,
  incidentNotifyAudience,
  isIncidentType,
  logIncidentDocument,
  notifyIncident,
  recordIncident,
  setPoliceReportNumber,
} from '@/lib/admin/incidents'

// B-424. Every action here is a thin parse in front of `lib/admin/incidents`,
// which owns the permission checks.

/// A `datetime-local` value read on the facility's clock. Measured twice, for
/// the reason `zonedMidnight` is: the offset differs across a DST boundary.
function facilityTime(raw: FormDataEntryValue | null, timezone: string): Date | null {
  const naive = Date.parse(`${String(raw ?? '')}Z`)
  if (Number.isNaN(naive)) return null
  const first = zoneOffsetMinutes(new Date(naive), timezone)
  const candidate = naive - first * 60_000
  const second = zoneOffsetMinutes(new Date(candidate), timezone)
  return new Date(second === first ? candidate : naive - second * 60_000)
}

export async function recordIncidentAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireStaffActor()
  const facilityId = String(formData.get('facilityId') ?? '')
  const facility = await prisma.facility.findUnique({ where: { id: facilityId }, select: { timezone: true } })
  if (!facility) return { status: 'error', message: 'Pick a facility first.', fieldErrors: {} }

  const errors: Record<string, string> = {}
  const type = String(formData.get('type') ?? '')
  if (!isIncidentType(type)) errors.type = 'Pick what kind of incident this was.'
  const windowStart = facilityTime(formData.get('windowStart'), facility.timezone)
  const windowEnd = facilityTime(formData.get('windowEnd'), facility.timezone)
  if (!windowStart) errors.windowStart = 'Enter the earliest it could have happened, as a date and a time.'
  if (!windowEnd) errors.windowEnd = 'Enter the latest it could have happened, as a date and a time.'
  if (windowStart && windowEnd && windowEnd.getTime() <= windowStart.getTime()) {
    errors.windowEnd = 'The end must be after the start.'
  }
  const description = String(formData.get('description') ?? '').trim()
  if (!description) errors.description = 'Say what happened. Every affected tenant’s call starts from this.'
  const unitIds = formData.getAll('unitIds').map(String).filter(Boolean)
  if (unitIds.length === 0) errors.unitIds = 'Tick at least one affected unit.'
  if (Object.keys(errors).length > 0 || !isIncidentType(type) || !windowStart || !windowEnd) return fieldError(errors)

  let result
  try {
    result = await recordIncident(actor, {
      facilityId,
      type,
      windowStart,
      windowEnd,
      description,
      policeReportNumber: String(formData.get('policeReportNumber') ?? ''),
      unitIds,
    })
  } catch (error) {
    return { status: 'error', message: error instanceof Error ? error.message : 'The incident could not be recorded.', fieldErrors: {} }
  }
  if (!result.ok) {
    switch (result.reason) {
      case 'window_too_busy':
        return fieldError({
          windowEnd: `The gate log has more than ${GATE_LOG_EXCERPT_MAX} events in that window. Narrow it to when the incident could have happened.`,
        })
      case 'bad_window':
        return fieldError({ windowEnd: 'The end must be after the start.' })
      case 'missing_description':
        return fieldError({ description: 'Say what happened.' })
      default:
        return fieldError({ unitIds: 'One of those units is not at this facility. Reload the page and tick them again.' })
    }
  }

  revalidatePath('/admin/incidents')
  redirect(`/admin/incidents/${result.id}`)
}

export async function setPoliceReportAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireStaffActor()
  const incidentId = String(formData.get('incidentId') ?? '')
  const value = String(formData.get('policeReportNumber') ?? '').trim()
  if (!(await setPoliceReportNumber(actor, incidentId, value))) {
    return { status: 'error', message: 'That incident no longer exists.', fieldErrors: {} }
  }
  revalidatePath(`/admin/incidents/${incidentId}`)
  return success(value ? `Police report number saved: ${value}.` : 'Police report number cleared.')
}

export async function logIncidentDocumentAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireStaffActor()
  const incidentId = String(formData.get('incidentId') ?? '')
  const title = String(formData.get('title') ?? '').trim()
  if (!title) return fieldError({ title: 'Name it, for example “Cut lock on unit 114”.' })
  const logged = await logIncidentDocument(actor, incidentId, {
    type: formData.get('type') === 'inspection_photo' ? 'inspection_photo' : 'other',
    title,
    note: String(formData.get('note') ?? ''),
  })
  if (!logged) return { status: 'error', message: 'That incident no longer exists.', fieldErrors: {} }
  revalidatePath(`/admin/incidents/${incidentId}`)
  return success(`“${title}” added to the incident.`)
}

export async function notifyIncidentAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireStaffActor()
  const incidentId = String(formData.get('incidentId') ?? '')
  const subject = String(formData.get('subject') ?? '').trim()
  const message = String(formData.get('message') ?? '').trim()
  const errors: Record<string, string> = {}
  if (!subject) errors.subject = 'Give the message a subject.'
  if (!message) errors.message = 'Write what every affected tenant should be told.'
  if (Object.keys(errors).length > 0) return fieldError(errors)

  if (formData.get('confirmed') !== 'yes') {
    const units = await incidentNotifyAudience(actor, incidentId)
    if (!units) return { status: 'error', message: 'That incident no longer exists.', fieldErrors: {} }
    return {
      status: 'confirm',
      message: 'Check this before it is sent. It can be sent once, and every affected tenant gets the same words.',
      confirmLabel: 'Yes, send it',
      echo: [
        { label: 'To the tenants of', value: units.length > 0 ? `Unit ${units.join(', ')}` : 'Nobody — no affected unit had a tenant' },
        { label: 'Subject', value: subject },
        { label: 'Message', value: message },
      ],
    }
  }

  let result
  try {
    result = await notifyIncident(actor, incidentId, { subject, message })
  } catch (error) {
    return { status: 'error', message: error instanceof Error ? error.message : 'The message could not be sent.', fieldErrors: {} }
  }
  if (!result.ok) {
    const why = {
      not_found: 'That incident no longer exists.',
      already_notified: 'The tenants were already told. Nothing was sent.',
      no_tenants: 'No affected unit had a tenant, so there is nobody to send to.',
      refused: `The send was refused (${'problem' in result ? result.problem : ''}). Nothing was sent — see Announcements.`,
    }[result.reason]
    return { status: 'error', message: why, fieldErrors: {} }
  }
  revalidatePath(`/admin/incidents/${incidentId}`)
  return success(
    `Sent to ${result.sent} of ${result.recipients} ${result.recipients === 1 ? 'tenant' : 'tenants'}.`,
    result.failed > 0 ? [`${result.failed} could not be sent — see Messages`] : undefined,
  )
}
