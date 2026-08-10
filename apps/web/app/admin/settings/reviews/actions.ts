'use server'

import { revalidatePath } from 'next/cache'
import { requireStaffActor } from '@/lib/rbac/session'
import { createReview, setReviewVisibility, updateReviewSettings } from '@/lib/admin/reviews'
import type { ReviewSource } from '@storage/db'

export async function updateReviewSettingsAction(formData: FormData): Promise<void> {
  const actor = await requireStaffActor()
  const facilityId = String(formData.get('facilityId') ?? '')
  const googleReviewUrl = String(formData.get('googleReviewUrl') ?? '').trim() || null
  const reviewRequestDelayDays = Number(formData.get('reviewRequestDelayDays') ?? 7)

  await updateReviewSettings(actor, facilityId, { googleReviewUrl, reviewRequestDelayDays })
  revalidatePath('/admin/settings/reviews')
}

export async function createReviewAction(formData: FormData): Promise<void> {
  const actor = await requireStaffActor()
  const facilityId = String(formData.get('facilityId') ?? '')
  const rating = Number(formData.get('rating') ?? 0)
  const text = String(formData.get('text') ?? '')
  const reviewerDisplayName = String(formData.get('reviewerDisplayName') ?? '')
  const reviewDateRaw = String(formData.get('reviewDate') ?? '')
  const source = String(formData.get('source') ?? 'manual_google') as ReviewSource

  await createReview(actor, facilityId, {
    rating,
    text,
    reviewerDisplayName,
    reviewDate: reviewDateRaw ? new Date(`${reviewDateRaw}T00:00:00.000Z`) : new Date(),
    source,
  })
  revalidatePath('/admin/settings/reviews')
}

export async function setReviewVisibilityAction(formData: FormData): Promise<void> {
  const actor = await requireStaffActor()
  const reviewId = String(formData.get('reviewId') ?? '')
  const visible = formData.get('visible') === 'true'

  await setReviewVisibility(actor, reviewId, visible)
  revalidatePath('/admin/settings/reviews')
}
