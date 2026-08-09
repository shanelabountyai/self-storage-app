'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireStaffActor } from '@/lib/rbac/session'
import { fieldError, parseDate, success, type FormState } from '@/lib/admin/form-state'
import { createInquiry, holdForLead, setLeadStatus } from '@/lib/admin/inquiries'

// PRD 02 US-43 (B-097). Every gate lives in lib/admin/inquiries.ts; these turn
// a refusal into a sentence.

export async function createInquiryAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireStaffActor()
  const facilityId = String(formData.get('facilityId') ?? '')

  // Optional: a caller who says "sometime next month" gives nothing to parse,
  // and refusing the whole inquiry over it would lose the lead to save a field.
  const rawDate = formData.get('targetMoveInDate')
  let targetMoveInDate: Date | null = null
  if (rawDate && String(rawDate).trim()) {
    const parsed = parseDate(rawDate)
    if ('error' in parsed) return fieldError({ targetMoveInDate: parsed.error })
    targetMoveInDate = parsed.value
  }

  const result = await createInquiry(actor, {
    facilityId,
    firstName: String(formData.get('firstName') ?? ''),
    lastName: String(formData.get('lastName') ?? ''),
    phone: String(formData.get('phone') ?? ''),
    email: String(formData.get('email') ?? ''),
    source: String(formData.get('source') ?? ''),
    unitTypeId: String(formData.get('unitTypeId') ?? '') || null,
    targetMoveInDate,
    message: String(formData.get('message') ?? ''),
  })
  if (!result.ok) return fieldError({ [result.field]: result.problem })

  // Straight to the lead, where the quote and the hold are. The sixty-second
  // target is end to end, and a success message on the form would leave the
  // staffer to navigate there themselves while somebody waits on the phone.
  redirect(`/admin/leads/${result.leadId}`)
}

export async function holdForLeadAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireStaffActor()
  const leadId = String(formData.get('leadId') ?? '')

  const result = await holdForLead(actor, leadId, String(formData.get('unitTypeId') ?? ''))
  if (!result.ok) return fieldError({ unitTypeId: result.problem })

  revalidatePath(`/admin/leads/${leadId}`)
  revalidatePath('/admin/leads')
  return success(
    `Held until ${new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(result.expiresAt)}. No card, no account — they can finish online or at the counter.`,
  )
}

export async function setLeadStatusAction(formData: FormData): Promise<void> {
  const actor = await requireStaffActor()
  const leadId = String(formData.get('leadId') ?? '')
  const status = String(formData.get('status') ?? '')

  if (status === 'contacted' || status === 'lost' || status === 'new') {
    await setLeadStatus(actor, leadId, status)
  }
  revalidatePath(`/admin/leads/${leadId}`)
  revalidatePath('/admin/leads')
}
