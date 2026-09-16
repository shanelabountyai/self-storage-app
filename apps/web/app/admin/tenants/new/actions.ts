'use server'

import { redirect } from 'next/navigation'
import { requireStaffActor } from '@/lib/rbac/session'
import { fieldError, type FormState } from '@/lib/admin/form-state'
import { createLeaselessTenant } from '@/lib/admin/tenants'

export async function createLeaselessTenantAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireStaffActor()

  const result = await createLeaselessTenant(actor, {
    facilityId: String(formData.get('facilityId') ?? ''),
    firstName: String(formData.get('firstName') ?? ''),
    lastName: String(formData.get('lastName') ?? ''),
    email: String(formData.get('email') ?? ''),
    phone: String(formData.get('phone') ?? ''),
    address: {
      addressLine1: String(formData.get('addressLine1') ?? ''),
      addressLine2: String(formData.get('addressLine2') ?? ''),
      city: String(formData.get('city') ?? ''),
      state: String(formData.get('state') ?? ''),
      postalCode: String(formData.get('postalCode') ?? ''),
    },
  })
  if (!result.ok) return fieldError(result.problems)

  redirect(`/admin/tenants/${result.tenantId}`)
}
