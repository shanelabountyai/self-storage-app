'use server'

import { revalidatePath } from 'next/cache'
import { requireStaffActor } from '@/lib/rbac/session'
import { fieldError, success, type FormState } from '@/lib/admin/form-state'
import {
  AccountError,
  addMember,
  attachLease,
  createAccount,
  detachLease,
  removeMember,
} from '@/lib/billing/accounts'

// PRD 01 §9 Phase 3 (B-090 part 5). Every gate lives in lib/billing/accounts.ts;
// these turn a refusal into a sentence next to the field that caused it.

function refusal(error: unknown): FormState {
  if (error instanceof AccountError) return fieldError({ [error.field]: error.message })
  throw error
}

export async function createAccountAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireStaffActor()
  try {
    const account = await createAccount(actor, {
      facilityId: String(formData.get('facilityId') ?? ''),
      name: String(formData.get('name') ?? ''),
      payerEmail: String(formData.get('payerEmail') ?? ''),
    })
    revalidatePath('/admin/billing/accounts')
    return success(`${account.name} created. Add the units it pays for.`)
  } catch (error) {
    return refusal(error)
  }
}

export async function attachLeaseAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireStaffActor()
  const accountId = String(formData.get('accountId') ?? '')
  try {
    const attached = await attachLease(actor, {
      accountId,
      unitNumber: String(formData.get('unitNumber') ?? ''),
    })
    revalidatePath(`/admin/billing/accounts/${accountId}`)
    return success(`Unit ${attached.unitNumber} is now paid for by this account.`)
  } catch (error) {
    return refusal(error)
  }
}

export async function detachLeaseAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireStaffActor()
  const accountId = String(formData.get('accountId') ?? '')
  try {
    const detached = await detachLease(actor, {
      accountId,
      leaseId: String(formData.get('leaseId') ?? ''),
    })
    revalidatePath(`/admin/billing/accounts/${accountId}`)
    return success(
      `Unit ${detached.unitNumber} is off this account. Its own tenant pays for it again.`,
    )
  } catch (error) {
    return refusal(error)
  }
}

// B-258. The people allowed to SEE an account. Look-only, so nothing here
// touches the money path — see the note on `payableLeaseWhere`.

export async function addMemberAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireStaffActor()
  const accountId = String(formData.get('accountId') ?? '')
  try {
    const member = await addMember(actor, {
      accountId,
      email: String(formData.get('email') ?? ''),
    })
    revalidatePath(`/admin/billing/accounts/${accountId}`)
    return success(`${member.name} can now see this account in their portal. They cannot pay it.`)
  } catch (error) {
    return refusal(error)
  }
}

export async function removeMemberAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireStaffActor()
  const accountId = String(formData.get('accountId') ?? '')
  try {
    const member = await removeMember(actor, {
      accountId,
      tenantId: String(formData.get('tenantId') ?? ''),
    })
    revalidatePath(`/admin/billing/accounts/${accountId}`)
    return success(`${member.name} can no longer see this account.`)
  } catch (error) {
    return refusal(error)
  }
}
