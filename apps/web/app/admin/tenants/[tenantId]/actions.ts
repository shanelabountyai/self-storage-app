'use server'

import { revalidatePath } from 'next/cache'
import { requireStaffActor } from '@/lib/rbac/session'
import {
  addTenantNote,
  flagTenantAddressReturned,
  logTenantDocument,
  setTenantNotePinned,
  updateTenantAddress,
  updateTenantContact,
  type LoggableDocumentType,
} from '@/lib/admin/tenants'
import { fieldError, success, type FormState } from '@/lib/admin/form-state'

// PRD 02 §4.4 US-13/US-16. Thin session wrappers; every real decision lives
// in lib/admin/tenants.ts (and lib/portal/contact.ts underneath it), which
// import nothing from `@/auth` and are therefore directly testable.

function revalidateProfile(tenantId: string): void {
  revalidatePath(`/admin/tenants/${tenantId}`)
}

export async function updateContactAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireStaffActor()
  const tenantId = String(formData.get('tenantId') ?? '')

  const problems = await updateTenantContact(actor, tenantId, {
    phone: String(formData.get('phone') ?? ''),
    altContactName: String(formData.get('altContactName') ?? ''),
    altContactPhone: String(formData.get('altContactPhone') ?? ''),
    altContactEmail: String(formData.get('altContactEmail') ?? ''),
  })
  if (Object.keys(problems).length > 0) return fieldError(problems)

  revalidateProfile(tenantId)
  return success('Contact details saved.')
}

export async function updateAddressAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireStaffActor()
  const tenantId = String(formData.get('tenantId') ?? '')

  const result = await updateTenantAddress(actor, tenantId, {
    addressLine1: String(formData.get('addressLine1') ?? ''),
    addressLine2: String(formData.get('addressLine2') ?? ''),
    city: String(formData.get('city') ?? ''),
    state: String(formData.get('state') ?? ''),
    postalCode: String(formData.get('postalCode') ?? ''),
  })
  if (!result.ok) return fieldError(result.problems)

  revalidateProfile(tenantId)
  return success('Address saved.')
}

export async function flagAddressReturnedAction(formData: FormData): Promise<void> {
  const actor = await requireStaffActor()
  const tenantId = String(formData.get('tenantId') ?? '')
  const addressId = String(formData.get('addressId') ?? '')

  await flagTenantAddressReturned(actor, tenantId, addressId)
  revalidateProfile(tenantId)
}

export async function addNoteAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireStaffActor()
  const tenantId = String(formData.get('tenantId') ?? '')

  const problems = await addTenantNote(actor, tenantId, String(formData.get('body') ?? ''))
  if (Object.keys(problems).length > 0) return fieldError(problems)

  revalidateProfile(tenantId)
  return success('Note added.')
}

export async function setNotePinnedAction(formData: FormData): Promise<void> {
  const actor = await requireStaffActor()
  const tenantId = String(formData.get('tenantId') ?? '')
  const noteId = String(formData.get('noteId') ?? '')
  const pinned = formData.get('pinned') === 'yes'

  await setTenantNotePinned(actor, tenantId, noteId, pinned)
  revalidateProfile(tenantId)
}

const LOGGABLE_DOCUMENT_TYPES = new Set<LoggableDocumentType>(['id_copy', 'insurance_proof', 'other'])

export async function logDocumentAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireStaffActor()
  const tenantId = String(formData.get('tenantId') ?? '')
  const type = String(formData.get('type') ?? '')

  if (!LOGGABLE_DOCUMENT_TYPES.has(type as LoggableDocumentType)) {
    return fieldError({ title: 'Choose a document type.' })
  }

  const problems = await logTenantDocument(actor, tenantId, {
    type: type as LoggableDocumentType,
    title: String(formData.get('title') ?? ''),
    note: String(formData.get('note') ?? ''),
  })
  if (Object.keys(problems).length > 0) return fieldError(problems)

  revalidateProfile(tenantId)
  return success('Document logged.')
}
