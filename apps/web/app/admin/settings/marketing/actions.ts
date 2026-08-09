'use server'

import { revalidatePath } from 'next/cache'
import { requireStaffActor } from '@/lib/rbac/session'
import { fieldError, success, type FormState } from '@/lib/admin/form-state'
import {
  addFaq,
  addPhoto,
  removeFaq,
  removePhoto,
  saveGbpChecklist,
  saveMarketingCopy,
} from '@/lib/admin/marketing-profile'
import { prisma } from '@storage/db'
import { facilityPagePath } from '@/lib/marketing/paths'

// PRD 04 US-2 (B-067). Every gate lives in lib/admin/marketing-profile.ts;
// these turn a refusal into a sentence and revalidate the page that changed.

/// US-2 AC2: "edits publish to the live page within 5 minutes (revalidation)."
///
/// `revalidatePath` is immediate rather than five minutes — the AC is a
/// ceiling, not a target. The facility path has to be looked up rather than
/// passed from the form, because a form field naming which path to purge is a
/// field somebody can point at another facility's page.
async function revalidateFacility(facilityId: string): Promise<void> {
  const facility = await prisma.facility.findUnique({
    where: { id: facilityId },
    select: { state: true, city: true, slug: true },
  })
  if (facility) revalidatePath(facilityPagePath(facility))
  revalidatePath('/admin/settings/marketing')
}

export async function saveCopyAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireStaffActor()
  const facilityId = String(formData.get('facilityId') ?? '')

  const result = await saveMarketingCopy(actor, facilityId, {
    seoTitle: String(formData.get('seoTitle') ?? ''),
    metaDescription: String(formData.get('metaDescription') ?? ''),
    heroCopy: String(formData.get('heroCopy') ?? ''),
    longDescription: String(formData.get('longDescription') ?? ''),
  })
  if (!result.ok) return fieldError({ [result.field]: result.problem })

  await revalidateFacility(facilityId)
  return success('Saved. The live page is already showing it.')
}

export async function addFaqAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireStaffActor()
  const facilityId = String(formData.get('facilityId') ?? '')

  const result = await addFaq(actor, facilityId, {
    question: String(formData.get('question') ?? ''),
    answer: String(formData.get('answer') ?? ''),
  })
  if (!result.ok) return fieldError({ [result.field]: result.problem })

  await revalidateFacility(facilityId)
  return success('Added.')
}

export async function removeFaqAction(formData: FormData): Promise<void> {
  const actor = await requireStaffActor()
  const facilityId = String(formData.get('facilityId') ?? '')
  await removeFaq(actor, facilityId, String(formData.get('faqId') ?? ''))
  await revalidateFacility(facilityId)
}

export async function addPhotoAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireStaffActor()
  const facilityId = String(formData.get('facilityId') ?? '')

  const result = await addPhoto(actor, facilityId, {
    url: String(formData.get('url') ?? ''),
    alt: String(formData.get('alt') ?? ''),
    kind: String(formData.get('kind') ?? 'other'),
  })
  if (!result.ok) return fieldError({ [result.field]: result.problem })

  await revalidateFacility(facilityId)
  return success('Added.')
}

export async function removePhotoAction(formData: FormData): Promise<void> {
  const actor = await requireStaffActor()
  const facilityId = String(formData.get('facilityId') ?? '')
  await removePhoto(actor, facilityId, String(formData.get('photoId') ?? ''))
  await revalidateFacility(facilityId)
}

/// US-5 AC2. Confirmed by a person, stamped with a date.
export async function saveGbpAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireStaffActor()
  const facilityId = String(formData.get('facilityId') ?? '')

  await saveGbpChecklist(actor, facilityId, formData.getAll('gbp').map(String))

  revalidatePath('/admin/settings/marketing')
  return success('Checked off, and dated today.')
}
