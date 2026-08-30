'use server'

import { revalidatePath } from 'next/cache'
import { requireStaffActor } from '@/lib/rbac/session'
import {
  addAdvertisement,
  approveAuction,
  cancelAuction,
  recordLockCut,
  recordSaleOutcome,
  recordSurplusDisposition,
  recordSurplusNotified,
  scheduleSale,
  setContainsVehicle,
  setGoodsDescription,
} from '@/lib/auctions/service'
import type { SurplusDisposition } from '@storage/db'

// Every action here re-reads its own page afterwards. A refusal is not an
// exception — "this sale is blocked because three steps lack proof" is
// information a manager needs on screen, and the page derives it from the same
// readiness call the service used.

function revalidate(caseId: string): void {
  revalidatePath('/admin/auctions')
  revalidatePath(`/admin/auctions/${caseId}`)
}

function dateFrom(value: FormDataEntryValue | null): Date {
  const raw = String(value ?? '')
  // Date-only input, read as UTC midnight — the sale is "on the 14th", and
  // parsing it in the server's local zone would shift it a day for half the
  // world.
  return raw ? new Date(`${raw}T00:00:00.000Z`) : new Date()
}

export async function setVehicleAction(formData: FormData): Promise<void> {
  const actor = await requireStaffActor()
  const caseId = String(formData.get('caseId') ?? '')
  await setContainsVehicle(
    actor,
    caseId,
    formData.get('containsVehicle') === 'yes',
    String(formData.get('note') ?? ''),
  )
  revalidate(caseId)
}

export async function setGoodsDescriptionAction(formData: FormData): Promise<void> {
  const actor = await requireStaffActor()
  const caseId = String(formData.get('caseId') ?? '')
  await setGoodsDescription(actor, caseId, String(formData.get('goodsDescription') ?? ''))
  revalidate(caseId)
}

export async function approveAction(formData: FormData): Promise<void> {
  const actor = await requireStaffActor()
  const caseId = String(formData.get('caseId') ?? '')
  await approveAuction(actor, caseId, String(formData.get('reasonCode') ?? ''))
  revalidate(caseId)
}

export async function scheduleAction(formData: FormData): Promise<void> {
  const actor = await requireStaffActor()
  const caseId = String(formData.get('caseId') ?? '')
  await scheduleSale(actor, caseId, dateFrom(formData.get('saleDate')))
  revalidate(caseId)
}

export async function addAdvertisementAction(formData: FormData): Promise<void> {
  const actor = await requireStaffActor()
  const caseId = String(formData.get('caseId') ?? '')
  await addAdvertisement(actor, caseId, {
    publication: String(formData.get('publication') ?? ''),
    runDate: dateFrom(formData.get('runDate')),
    reference: String(formData.get('reference') ?? '') || null,
  })
  revalidate(caseId)
}

export async function recordLockCutAction(formData: FormData): Promise<void> {
  const actor = await requireStaffActor()
  const caseId = String(formData.get('caseId') ?? '')

  // Parallel arrays from the repeated row inputs. Zipped rather than indexed
  // by a hidden key, because a row a staffer left blank should simply not
  // appear rather than becoming an empty inventory line.
  const descriptions = formData.getAll('itemDescription').map(String)
  const photos = formData.getAll('itemPhoto').map(String)
  const items = descriptions
    .map((description, index) => ({ description, photoReference: photos[index] ?? '' }))
    .filter((item) => item.description.trim() || item.photoReference.trim())

  await recordLockCut(actor, caseId, {
    cutAt: new Date(),
    oldLockDisposition: String(formData.get('oldLockDisposition') ?? ''),
    items,
  })
  revalidate(caseId)
}

export async function recordSaleAction(formData: FormData): Promise<void> {
  const actor = await requireStaffActor()
  const caseId = String(formData.get('caseId') ?? '')

  const dollars = (name: string): number => {
    const raw = String(formData.get(name) ?? '').trim()
    // Integer cents, never a float multiplication that rounds into somebody's
    // surplus. Parsed from the string's own decimal places.
    const [whole, fraction = ''] = raw.replace(/[^0-9.]/g, '').split('.')
    const cents = Number(whole || 0) * 100 + Number((fraction + '00').slice(0, 2) || 0)
    return Number.isFinite(cents) ? cents : 0
  }

  await recordSaleOutcome(actor, caseId, {
    soldAt: dateFrom(formData.get('soldAt')),
    grossProceedsCents: dollars('grossProceeds'),
    saleCostsCents: dollars('saleCosts'),
    buyer: {
      name: String(formData.get('buyerName') ?? ''),
      addressLine1: String(formData.get('buyerAddressLine1') ?? ''),
      city: String(formData.get('buyerCity') ?? ''),
      state: String(formData.get('buyerState') ?? ''),
      postalCode: String(formData.get('buyerPostalCode') ?? ''),
      governmentIdReference: String(formData.get('buyerGovernmentIdReference') ?? ''),
      paymentMethod: String(formData.get('buyerPaymentMethod') ?? ''),
      taxExempt: formData.get('buyerTaxExempt') === 'on',
      resaleCertificateReference: String(formData.get('buyerResaleCertificateReference') ?? '') || null,
      cleanoutDeadline: formData.get('buyerCleanoutDeadline')
        ? dateFrom(formData.get('buyerCleanoutDeadline'))
        : null,
      forfeitTerms: String(formData.get('buyerForfeitTerms') ?? '') || null,
    },
  })
  revalidate(caseId)
}

export async function cancelAction(formData: FormData): Promise<void> {
  const actor = await requireStaffActor()
  const caseId = String(formData.get('caseId') ?? '')
  await cancelAuction(actor, caseId, String(formData.get('reason') ?? ''))
  revalidate(caseId)
}

export async function surplusNotifiedAction(formData: FormData): Promise<void> {
  const actor = await requireStaffActor()
  const caseId = String(formData.get('caseId') ?? '')
  await recordSurplusNotified(actor, caseId)
  revalidate(caseId)
}

export async function surplusDispositionAction(formData: FormData): Promise<void> {
  const actor = await requireStaffActor()
  const caseId = String(formData.get('caseId') ?? '')
  await recordSurplusDisposition(
    actor,
    caseId,
    String(formData.get('disposition') ?? '') as SurplusDisposition,
    String(formData.get('note') ?? ''),
  )
  revalidate(caseId)
}
