'use server'

import { revalidatePath } from 'next/cache'
import { requireTenantActor } from '@/lib/rbac/session'
import { askAboutCharge } from '@/lib/portal/charge-question'
import { fieldError, success, type FormState } from '@/lib/admin/form-state'
import { messages } from '@/lib/i18n/server'

// PRD 01 US-705 "Ask about one charge" (B-421). One field, one task, one
// answer. The ownership check and the one-open-request rule are in
// `askAboutCharge`; this reads the form and says what happened.
export async function askAboutChargeAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireTenantActor()
  const { t } = await messages()
  const result = await askAboutCharge(
    actor,
    String(formData.get('lineItemId') ?? ''),
    String(formData.get('question') ?? ''),
  )
  if (!result.ok) {
    if (result.reason === 'already_open') return { status: 'error', message: t('paypg.askAlreadyOpen'), fieldErrors: {} }
    if (result.reason === 'not_found') return { status: 'error', message: t('paypg.askNotFound'), fieldErrors: {} }
    return fieldError({ question: t(result.reason === 'empty' ? 'paypg.askEmpty' : 'paypg.askTooLong') })
  }
  revalidatePath('/portal/pay')
  return success(t('paypg.askSent'))
}
