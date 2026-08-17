'use server'

import { revalidatePath } from 'next/cache'
import { requireStaffActor } from '@/lib/rbac/session'
import { fieldError, success, type FormState } from '@/lib/admin/form-state'
import { saveCityCopy } from '@/lib/admin/city-copy'
import { citySlugPath } from '@/lib/marketing/paths'

// PRD 04 §3.2 US-4 AC1 (B-128). The gate and the validation live in
// lib/admin/city-copy.ts; this turns a refusal into a sentence and purges the
// page that changed.

export async function saveCityCopyAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireStaffActor()
  const state = String(formData.get('state') ?? '')
  const city = String(formData.get('city') ?? '')

  const result = await saveCityCopy(actor, state, city, String(formData.get('intro') ?? ''))
  if (!result.ok) return fieldError({ [result.field]: result.problem })

  // The city page is `revalidate = 300`, so without this an operator sees their
  // own copy up to five minutes after saving it and reasonably concludes the
  // save did not work.
  revalidatePath(citySlugPath(state, city))
  revalidatePath('/admin/settings/marketing/cities')
  return success('Saved. The live page is already showing it.')
}
