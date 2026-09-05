'use server'

import { revalidatePath } from 'next/cache'
import { requireStaffActor } from '@/lib/rbac/session'
import { fieldError, success, type FormState } from '@/lib/admin/form-state'
import {
  BROADCAST_MAX_RECIPIENTS,
  broadcastAudience,
  parseUnitNumbers,
  sendBroadcast,
  type BroadcastInput,
} from '@/lib/admin/broadcast'

// CN-21. One write. Every gate lives in lib/admin/broadcast.ts and in
// sendDirectEmail; this only turns refusals into sentences and puts the
// confirm-and-echo step in front of the press.

function inputFrom(formData: FormData): BroadcastInput {
  return {
    facilityId: String(formData.get('facilityId') ?? ''),
    templateKey: String(formData.get('templateKey') ?? ''),
    subject: String(formData.get('subject') ?? '').trim(),
    message: String(formData.get('message') ?? '').trim(),
    filter: {
      building: String(formData.get('building') ?? '') || null,
      unitNumbers: parseUnitNumbers(String(formData.get('unitNumbers') ?? '')),
    },
  }
}

export async function sendBroadcastAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireStaffActor()
  const input = inputFrom(formData)

  const errors: Record<string, string> = {}
  if (!input.subject) errors.subject = 'Enter a subject line — it is what tenants see in their inbox.'
  if (!input.message) errors.message = 'Enter the message. This is the part tenants read.'
  if (Object.keys(errors).length > 0) return fieldError(errors)

  // 3.3.4 Error Prevention. The same confirm-and-echo step as the tax rate on
  // `/admin/settings` and the new-facility form — reused, not reinvented, and
  // this is the screen it was most obviously built for: nothing else in the
  // product does something irreversible to every tenant at a site at once, and
  // the number in the echo is the fact worth checking. Counted here, at the
  // moment of the press, rather than trusted from a hidden field the page
  // rendered minutes ago.
  const audience = await broadcastAudience(actor, input.facilityId, input.filter)
  if (audience.length === 0) {
    return fieldError({
      unitNumbers:
        'Nobody matches that. Check the building and the unit numbers — only units with a current lease are reachable.',
    })
  }
  if (audience.length > BROADCAST_MAX_RECIPIENTS) {
    return fieldError({
      building: `That reaches ${audience.length} tenants, and one announcement is capped at ${BROADCAST_MAX_RECIPIENTS}. Narrow it to a building or a list of units.`,
    })
  }

  if (formData.get('confirmed') !== 'yes') {
    return {
      status: 'confirm',
      message: 'Check this before it goes out. An email cannot be recalled.',
      confirmLabel: `Yes, send to ${audience.length} ${audience.length === 1 ? 'tenant' : 'tenants'}`,
      echo: [
        { label: 'Going to', value: `${audience.length} ${audience.length === 1 ? 'tenant' : 'tenants'}` },
        {
          label: 'Audience',
          value: [
            input.filter.building ? `Building ${input.filter.building}` : 'Every building',
            input.filter.unitNumbers?.length
              ? `units ${input.filter.unitNumbers.join(', ')}`
              : 'all current tenants',
          ].join(', '),
        },
        { label: 'Kind', value: input.templateKey === 'broadcast.announcement' ? 'Marketing — honours unsubscribes and quiet hours' : 'Operational notice' },
        { label: 'Subject', value: input.subject },
        { label: 'Message', value: input.message },
      ],
    }
  }

  const result = await sendBroadcast(actor, input)

  if (!result.ok) {
    switch (result.problem) {
      case 'comms_off':
        return fieldError({
          message: 'Outbound mail is paused by the kill switch, so nothing was sent. Nobody has been emailed.',
        })
      case 'render':
        return fieldError({
          message: `${result.detail} Missing: ${result.missing.join(', ')}. Fix it under Settings → Message templates; nobody has been emailed.`,
        })
      case 'no_template':
        return fieldError({ templateKey: 'That announcement template is not published for this facility.' })
      case 'no_audience':
        return fieldError({ unitNumbers: 'Nobody matches that any more. Nothing was sent.' })
      case 'too_many':
        return fieldError({ building: `That reaches ${result.detail} tenants, over the ${BROADCAST_MAX_RECIPIENTS} cap.` })
      default:
        return fieldError({ message: 'That announcement could not be sent.' })
    }
  }

  revalidatePath('/admin/comms/broadcast')

  // Says what happened to all of them, not just the good half. A tenant who
  // never got the outage notice because they have unsubscribed or their
  // address hard-bounced is the one the office hears from on Thursday, and
  // "sent to 143" hides them.
  const details = [
    `${result.sent} sent`,
    ...(result.suppressed > 0 ? [`${result.suppressed} not sent — unsubscribed or a bad address`] : []),
    ...(result.cancelled > 0 ? [`${result.cancelled} not sent — the tenant has this kind of message switched off, or it was held back by quiet hours`] : []),
    ...(result.failed > 0 ? [`${result.failed} failed — see the deliverability report`] : []),
  ]
  return success(
    `Announcement sent to ${result.recipients} ${result.recipients === 1 ? 'tenant' : 'tenants'}.`,
    details,
  )
}
