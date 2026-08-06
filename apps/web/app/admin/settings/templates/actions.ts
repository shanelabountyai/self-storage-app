'use server'

import { revalidatePath } from 'next/cache'
import { requireStaffActor } from '@/lib/rbac/session'
import { fieldError, success, type FormState } from '@/lib/admin/form-state'
import { saveTemplateVersion, testSendTemplate } from '@/lib/admin/templates'

// CN-16. The editor's two writes. Every gate lives in lib/admin/templates.ts;
// these only turn refusals into sentences.

function draftFrom(formData: FormData) {
  return {
    key: String(formData.get('key') ?? ''),
    subject: String(formData.get('subject') ?? ''),
    bodyText: String(formData.get('bodyText') ?? ''),
    // The picker writes these; an operator never types a field name into a
    // list, which is what keeps the declared set honest.
    requiredMergeFields: String(formData.get('requiredMergeFields') ?? '')
      .split(',')
      .map((field) => field.trim())
      .filter(Boolean),
  }
}

export async function saveTemplateAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireStaffActor()
  const facilityId = String(formData.get('facilityId') ?? '')
  const scope = formData.get('scope') === 'org' ? 'org' : 'facility'

  const result = await saveTemplateVersion(actor, facilityId, { ...draftFrom(formData), scope })

  if (!result.ok) {
    switch (result.problem) {
      case 'unknown_fields':
        return fieldError({
          bodyText: `These fields are not available for this message: ${(result.unknown ?? []).join(', ')}. Use the list beside the editor — anything else has no value at send time and the message would simply never go out.`,
        })
      case 'empty':
        return fieldError({ bodyText: 'The message body cannot be empty.' })
      default:
        return {
          status: 'error',
          message: 'This template is not wired to any event, so it cannot be published yet.',
          fieldErrors: {},
        }
    }
  }

  revalidatePath('/admin/settings/templates')
  return success(
    scope === 'org'
      ? `Published as version ${result.version} for every facility.`
      : `Published as version ${result.version} for this facility only.`,
  )
}

export async function testSendAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireStaffActor()
  const facilityId = String(formData.get('facilityId') ?? '')

  const result = await testSendTemplate(actor, facilityId, draftFrom(formData))
  if (!result.ok) {
    return {
      status: 'error',
      message: result.missing?.length
        ? `${result.problem} Missing: ${result.missing.join(', ')}.`
        : result.problem,
      fieldErrors: {},
    }
  }

  // Says where it went, because "sent" without an address is the message that
  // has people checking the wrong inbox.
  return success(`Test message sent to ${result.to}.`)
}
