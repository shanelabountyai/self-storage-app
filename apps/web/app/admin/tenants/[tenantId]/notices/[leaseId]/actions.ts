'use server'

import { revalidatePath } from 'next/cache'
import { requireStaffActor } from '@/lib/rbac/session'
import { generateNotice, mailNoticeCertified, recordNoticeDelivery } from '@/lib/notices/service'
import { success, type FormState } from '@/lib/admin/form-state'
import type { LienNoticeType, NoticeDeliveryMethod } from '@storage/core/notices'
import { DELIVERY_PROOF_FIELDS } from '@storage/core/notices'

export async function generateNoticeAction(formData: FormData): Promise<void> {
  const actor = await requireStaffActor()
  const tenantId = String(formData.get('tenantId') ?? '')
  const leaseId = String(formData.get('leaseId') ?? '')
  const type = String(formData.get('type') ?? '') as LienNoticeType
  const correctsNoticeId = String(formData.get('correctsNoticeId') ?? '') || undefined
  const deadlineDaysRaw = String(formData.get('deadlineDays') ?? '')
  const deadlineDays = deadlineDaysRaw ? Number(deadlineDaysRaw) : undefined

  // The result — including a refusal — is read back off the page, which
  // re-derives it from `noticeContext`. A refusal is not an exception: "this
  // lease does not reconcile" is information staff need on screen, not a 500.
  await generateNotice(actor, leaseId, type, {
    correctsNoticeId,
    deadlineDays: Number.isFinite(deadlineDays) && deadlineDays! > 0 ? deadlineDays : undefined,
  })

  revalidatePath(`/admin/tenants/${tenantId}/notices/${leaseId}`)
}

export async function recordDeliveryAction(formData: FormData): Promise<void> {
  const actor = await requireStaffActor()
  const tenantId = String(formData.get('tenantId') ?? '')
  const leaseId = String(formData.get('leaseId') ?? '')
  const noticeId = String(formData.get('noticeId') ?? '')
  const method = String(formData.get('method') ?? '') as NoticeDeliveryMethod
  const deliveredAtRaw = String(formData.get('deliveredAt') ?? '')

  // Only the proof keys this method actually requires — a form that posted
  // every possible field would let a tracking number arrive on a hand-delivery
  // and sit in the evidence record meaning nothing.
  const proof: Record<string, string> = {}
  for (const key of DELIVERY_PROOF_FIELDS[method] ?? []) {
    const value = formData.get(key)
    if (value) proof[key] = String(value)
  }

  await recordNoticeDelivery(actor, noticeId, {
    method,
    deliveredAt: deliveredAtRaw ? new Date(deliveredAtRaw) : new Date(),
    proof,
  })

  revalidatePath(`/admin/tenants/${tenantId}/notices/${leaseId}`)
}

/// B-083. Posts the notice by certified mail and records the tracking number
/// the provider returns.
///
/// The one action on this page that returns `FormState` rather than reading its
/// outcome back off the re-rendered screen, and the reason is the failure mode
/// the others do not have: if the provider accepts the letter and recording it
/// here then fails, the tracking number exists in exactly one place — that
/// refusal. Re-deriving the page state would show a notice that is still
/// unserved and say nothing about the letter now in the post.
export async function mailNoticeAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireStaffActor()
  const tenantId = String(formData.get('tenantId') ?? '')
  const leaseId = String(formData.get('leaseId') ?? '')
  const noticeId = String(formData.get('noticeId') ?? '')

  const result = await mailNoticeCertified(actor, noticeId)
  revalidatePath(`/admin/tenants/${tenantId}/notices/${leaseId}`)

  if (!result.ok) {
    return { status: 'error', message: result.reason, fieldErrors: {} }
  }
  return success(
    `Posted by certified mail. Tracking number ${result.trackingNumber}, recorded against this notice as proof of service.`,
  )
}
