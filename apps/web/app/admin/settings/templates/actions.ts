'use server'

import { revalidatePath } from 'next/cache'
import { requireStaffActor } from '@/lib/rbac/session'
import { fieldError, success, type FormState } from '@/lib/admin/form-state'
import { saveTemplateVersion, testSendTemplate } from '@/lib/admin/templates'
import { DEFAULT_LOCALE, isLocale, LOCALE_NAMES } from '@/lib/i18n'

// CN-16. The editor's two writes. Every gate lives in lib/admin/templates.ts;
// these only turn refusals into sentences.

function draftFrom(formData: FormData) {
  // B-261. Which language's copy of this template is being edited. Hidden on
  // the form and narrowed here rather than trusted: an unrecognised value
  // would publish a version under a locale no send path ever asks for, which
  // looks exactly like a save that silently did nothing.
  const claimed = formData.get('locale')
  return {
    locale: isLocale(claimed) ? claimed : DEFAULT_LOCALE,
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
  // Names the language, because the screen shows one language at a time and a
  // "published" line that does not say which is how the English copy gets
  // edited twice while the Spanish stays untouched.
  const language = LOCALE_NAMES[draftFrom(formData).locale]
  return success(
    scope === 'org'
      ? `Published the ${language} version ${result.version} for every facility.`
      : `Published the ${language} version ${result.version} for this facility only.`,
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
