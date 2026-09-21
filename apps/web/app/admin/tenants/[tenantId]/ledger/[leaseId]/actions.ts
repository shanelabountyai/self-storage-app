'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@storage/db'

import {
  postLedgerAdjustment,
  voidRentInvoice,
  writeOffOpenLeaseBalance,
  type CorrectionRefusal,
} from '@/lib/billing/corrections'
import { fieldError, parseScaled, success, type FormState } from '@/lib/admin/form-state'
import { formatCents } from '@/lib/format'
import { requireStaffActor } from '@/lib/rbac/session'

// B-303. The three repairs, from the ledger screen the exception report already
// links to. Every gate is the domain function's; this only turns its refusals
// into sentences with a control attached.

function revalidateLedger(tenantId: string, leaseId: string): void {
  revalidatePath(`/admin/tenants/${tenantId}/ledger/${leaseId}`)
  revalidatePath(`/admin/tenants/${tenantId}`)
  // The whole point of the repair: the lease leaves the exception list.
  revalidatePath('/admin/reports/ledger-exceptions')
}

/// B-346 / D-145, SC 3.3.4. Nothing reverses a correction, so each one echoes
/// what it is about to post and waits for the press to come back carrying the
/// amount it echoed. The domain's `preview` has already run every refusal, and
/// the echo reads the tenant, unit and balance from the database rather than
/// from the page — the figure being agreed to is what is true, not what the
/// browser was showing (B-177's rule).
///
/// Returns null when the press carried the echoed amount back, which is the
/// caller's signal to post for real.
async function confirmCorrection(
  formData: FormData,
  leaseId: string,
  what: { amountCents: number; confirmLabel: string; rows?: { label: string; value: string }[] },
): Promise<FormState | null> {
  const token = `yes:${what.amountCents}`
  if (formData.get('confirmed') === token) return null

  const lease = await prisma.lease.findUnique({
    where: { id: leaseId },
    select: {
      unit: { select: { number: true } },
      tenant: { select: { firstName: true, lastName: true } },
    },
  })
  const balance = await prisma.ledgerEntry.aggregate({ where: { leaseId }, _sum: { amountCents: true } })
  const balanceCents = balance._sum.amountCents ?? 0

  return {
    status: 'confirm',
    message: 'Check this before it is posted. It stays on this tenant\u2019s ledger permanently.',
    echo: [
      { label: 'Tenant', value: lease ? `${lease.tenant.firstName} ${lease.tenant.lastName}` : '—' },
      { label: 'Unit', value: lease?.unit.number ?? '—' },
      ...(what.rows ?? []),
      { label: 'Amount', value: formatCents(Math.abs(what.amountCents)) },
      {
        label: 'Direction',
        value: what.amountCents < 0 ? 'Reduces what the tenant owes' : 'Increases what the tenant owes',
      },
      { label: 'Balance after', value: formatCents(balanceCents + what.amountCents) },
    ],
    confirmLabel: what.confirmLabel,
    confirmValue: token,
    cancel: { label: 'Cancel', message: 'Cancelled. Nothing was posted.' },
  }
}

/// The refusals the three share, onto the field a reader can actually change.
///
/// An authority refusal goes on the AMOUNT wherever there is one — B-167's
/// rule. On a write-off there is no amount field, because the amount is the
/// balance, so it goes on the form.
function refusalState(
  refusal: CorrectionRefusal,
  options: { amountField?: string; nothingToDo: string },
): FormState {
  const amountField = options.amountField ?? null
  switch (refusal.reason) {
    case 'missing_reason':
      return fieldError({ reasonCode: 'Choose why this is being posted — it is the record.' })
    case 'bad_amount':
      return fieldError({
        [amountField ?? 'amountDollars']: 'Enter an amount in dollars, like -161.00.',
      })
    case 'forbidden':
      return {
        status: 'error',
        message: 'You do not have permission to correct a ledger at this facility.',
        fieldErrors: {},
      }
    case 'over_limit': {
      const sentence = `That is more than your ${formatCents(refusal.limitCents)} limit.${
        refusal.escalateTo ? ` A ${refusal.escalateTo} can carry it.` : ''
      }`
      return amountField
        ? fieldError({ [amountField]: sentence })
        : { status: 'error', message: sentence, fieldErrors: {} }
    }
    case 'nothing_to_do':
      return {
        status: 'error',
        message: options.nothingToDo,
        fieldErrors: {},
      }
    default:
      return { status: 'error', message: 'That lease could not be found.', fieldErrors: {} }
  }
}

export async function adjustLedgerAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireStaffActor()
  const tenantId = String(formData.get('tenantId') ?? '')
  const leaseId = String(formData.get('leaseId') ?? '')

  // A ceiling in both directions, and it is the point: this is the one control
  // in the product that can move a balance by an arbitrary signed number, and a
  // fat-fingered "16100" for a $161 correction is a $16,100 restatement of what
  // somebody owes. $100,000 is past any single lease's ledger.
  //
  // Zero is deliberately inside the range. It is the answer for a lease whose
  // balance is already right and whose invoices are what moved — B-292's
  // transfer shape — and `postLedgerAdjustment` refuses it only when there is
  // nothing to reconcile either.
  const amount = parseScaled(formData.get('amountDollars'), {
    scale: 100,
    min: -100_000,
    max: 100_000,
    unit: 'dollars',
  })
  if ('error' in amount) return fieldError({ amountDollars: amount.error })

  const input = {
    leaseId,
    balanceChangeCents: amount.value,
    reasonCode: String(formData.get('reasonCode') ?? ''),
    note: String(formData.get('note') ?? '') || undefined,
  }
  const refused = (result: Exclude<Awaited<ReturnType<typeof postLedgerAdjustment>>, { ok: true }>) =>
    refusalState(result, {
      amountField: 'amountDollars',
      nothingToDo:
        'Nothing to correct: this lease already agrees with its invoices and you asked for no change to the balance.',
    })

  // D-145: a non-zero change confirms. Zero leaves what the tenant owes where
  // it is, and only brings the invoices back into line.
  if (amount.value !== 0) {
    const preview = await postLedgerAdjustment(actor, { ...input, preview: true })
    if (!preview.ok) return refused(preview)
    const confirm = await confirmCorrection(formData, leaseId, {
      amountCents: amount.value,
      confirmLabel: 'Yes, post this correction',
    })
    if (confirm) return confirm
  }

  const result = await postLedgerAdjustment(actor, input)
  if (!result.ok) return refused(result)

  revalidateLedger(tenantId, leaseId)
  return success(
    result.balanceChangeCents === 0
      ? 'Corrected. The balance is unchanged and this lease now agrees with its invoices.'
      : `Balance corrected by ${formatCents(result.balanceChangeCents)}. This lease now agrees with its invoices.`,
  )
}

export async function writeOffLedgerAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireStaffActor()
  const tenantId = String(formData.get('tenantId') ?? '')
  const leaseId = String(formData.get('leaseId') ?? '')

  const input = {
    leaseId,
    reasonCode: String(formData.get('reasonCode') ?? ''),
    note: String(formData.get('note') ?? '') || undefined,
  }
  const nothingToDo = 'This lease owes nothing, so there is nothing to write off.'

  const preview = await writeOffOpenLeaseBalance(actor, { ...input, preview: true })
  if (!preview.ok) return refusalState(preview, { nothingToDo })
  // The echoed amount is the whole balance, so a payment landing between the
  // echo and the press changes the token and asks again.
  const confirm = await confirmCorrection(formData, leaseId, {
    amountCents: -preview.amountCents,
    confirmLabel: 'Yes, write off the balance',
  })
  if (confirm) return confirm

  // ponytail: the balance is re-read here, not locked from the preview; a
  // payment in the milliseconds between the two is written off with the rest.
  const result = await writeOffOpenLeaseBalance(actor, input)
  if (!result.ok) return refusalState(result, { nothingToDo })

  revalidateLedger(tenantId, leaseId)
  return success(
    `${formatCents(result.amountCents)} written off. ${
      result.invoicesMarked === 1
        ? 'One invoice is marked uncollectible'
        : `${result.invoicesMarked} invoices are marked uncollectible`
    }, and the lease still reconciles.`,
  )
}

export async function voidInvoiceAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireStaffActor()
  const tenantId = String(formData.get('tenantId') ?? '')
  const leaseId = String(formData.get('leaseId') ?? '')

  const input = {
    invoiceId: String(formData.get('invoiceId') ?? ''),
    reasonCode: String(formData.get('reasonCode') ?? ''),
    note: String(formData.get('note') ?? '') || undefined,
  }

  const preview = await voidRentInvoice(actor, { ...input, preview: true })
  if (preview.ok) {
    // The invoice's own lease, not the form's hidden one: the echo names whose
    // ledger this lands on.
    const confirm = await confirmCorrection(formData, preview.leaseId, {
      amountCents: -preview.amountCents,
      confirmLabel: `Yes, void invoice ${preview.number}`,
      rows: [{ label: 'Invoice', value: preview.number }],
    })
    if (confirm) return confirm
  }

  // A refused preview falls through: the real call refuses the same way, and
  // the refusals below own the wording.
  const result = preview.ok ? await voidRentInvoice(actor, input) : preview
  // B-329. The one refusal that has to name what to do instead: voiding an
  // invoice money has been taken against would leave that payment allocated to
  // an invoice that no longer exists, and the period would be billed again at
  // full rate.
  if (!result.ok && result.reason === 'partly_paid') {
    return {
      status: 'error',
      message: `${formatCents(result.amountPaidCents)} has already been paid against this invoice, so it cannot be voided. Refund the paid part first and then void it, or post a correction for the difference.`,
      fieldErrors: {},
    }
  }
  if (!result.ok) {
    return refusalState(result, {
      nothingToDo: 'That invoice has already been paid, voided or written off.',
    })
  }

  revalidateLedger(tenantId, leaseId)
  return success(
    `Invoice ${result.number} voided and ${formatCents(result.amountCents)} taken off the ledger. If it was for the current period and the lease is active, the next billing run bills it again at the current rate.`,
  )
}
