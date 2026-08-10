'use server'

import { revalidatePath } from 'next/cache'
import { requireStaffActor } from '@/lib/rbac/session'
import { saveNoticeTemplate } from '@/lib/admin/notice-templates'
import type { LienNoticeType } from '@storage/core/notices'

export async function saveNoticeTemplateAction(formData: FormData): Promise<void> {
  const actor = await requireStaffActor()
  const facilityId = String(formData.get('facilityId') ?? '')
  const type = String(formData.get('type') ?? '') as LienNoticeType
  const title = String(formData.get('title') ?? '')
  const body = String(formData.get('body') ?? '')

  await saveNoticeTemplate(actor, facilityId, { type, title, body })
  revalidatePath('/admin/settings/notices')
}
