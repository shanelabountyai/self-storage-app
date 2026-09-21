import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import {
  postLedgerAdjustment,
  voidRentInvoice,
  writeOffOpenLeaseBalance,
} from '../apps/web/lib/billing/corrections'
import {
  acknowledgeLedgerException,
  leaseLedger,
  ledgerExceptions,
  raiseLedgerExceptionTasks,
} from '../apps/web/lib/admin/ledger'
import { claimForLease } from '../apps/web/lib/notices/service'
import type { Actor } from '../apps/web/lib/rbac/actor'
import type { PermissionKey } from '@storage/db/rbac-catalog'

// B-303. The repairs, against the two shapes B-292 named as permanently
// unrepairable — which is what made them the right test: neither can be cleared
// by anything else in the product, and before this row the only way out of
// either was a database client.
//
// Both are built the way the real paths leave them rather than by writing a
// discrepancy straight into the ledger, because the arithmetic is the whole
// point: the two shapes need OPPOSITE corrections, and a fixture that simply
// posted a wrong balance would pass under a mechanism that only handles one.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)

let facilityId = ''
let staffId = ''
let unitTypeId = ''
let counter = 0
let leaseCounter = 0
const tenantIds: string[] = []

const PERMS: PermissionKey[] = ['credits:manual', 'tenants:view', 'reports:financial']

/// A manager: `credits:manual` with B-197's seeded $50 limit, which is what
/// makes the over-limit case reachable without inventing a role.
function manager(maxCreditCents: number | null = 5_000): Actor {
  return {
    kind: 'staff',
    staffUserId: staffId,
    assignments: [
      {
        facilityId,
        roleKey: 'manager',
        rank: 20,
        permissions: new Set<PermissionKey>(PERMS),
        limits: { maxFeeWaiverCents: 0, maxRefundCents: 0, maxCreditCents },
      },
    ],
  }
}

/// The same person without the permission at all — the `forbidden` branch,
/// which is a different refusal from being under the limit.
function counterStaff(): Actor {
  return {
    kind: 'staff',
    staffUserId: staffId,
    assignments: [
      {
        facilityId,
        roleKey: 'counter',
        rank: 10,
        permissions: new Set<PermissionKey>(['tenants:view']),
        limits: { maxFeeWaiverCents: 0, maxRefundCents: 0, maxCreditCents: 0 },
      },
    ],
  }
}

async function makeLease(label: string, tenantId?: string) {
  // Numbered as well as labelled: the two shapes below are each built several
  // times in this file, and a unit number is unique per facility.
  leaseCounter += 1
  label = `${label}${leaseCounter}`
  if (!tenantId) {
    const tenant = await prisma.tenant.create({
      data: { email: `lc-${label}-${suffix}@example.com`, firstName: 'Cora', lastName: label },
    })
    tenantIds.push(tenant.id)
    tenantId = tenant.id
  }
  const unit = await prisma.unit.create({
    data: { facilityId, unitTypeId, number: `${label}-${suffix}` },
  })
  const lease = await prisma.lease.create({
    data: {
      facilityId,
      tenantId,
      unitId: unit.id,
      status: 'active',
      startDate: new Date('2026-08-01T00:00:00.000Z'),
      billingDay: 1,
      monthlyRateCents: 12_900,
    },
  })
  return { leaseId: lease.id, tenantId, unitNumber: unit.number }
}

async function openRent(leaseId: string, cents: number): Promise<string> {
  counter += 1
  const start = new Date(Date.UTC(2026, counter % 12, 1))
  const end = new Date(Date.UTC(2026, (counter % 12) + 1, 1))
  const invoice = await prisma.invoice.create({
    data: {
      facilityId,
      leaseId,
      number: `LC${String(counter).padStart(4, '0')}-${suffix}`,
      kind: 'rent',
      status: 'open',
      issueDate: start,
      dueDate: start,
      periodStart: start,
      periodEnd: end,
      subtotalCents: cents,
      totalCents: cents,
      lineItems: {
        create: { type: 'rent', description: 'Rent', unitAmountCents: cents, amountCents: cents },
      },
    },
  })
  await prisma.ledgerEntry.create({
    data: {
      facilityId,
      leaseId,
      type: 'charge',
      amountCents: cents,
      description: 'Rent',
      occurredAt: start,
      invoiceId: invoice.id,
    },
  })
  return invoice.id
}

async function differenceFor(leaseId: string): Promise<number> {
  const ledger = await leaseLedger(manager(null), leaseId)
  return ledger!.reconciliation.differenceCents
}

/// B-292's first shape. A multi-unit payment before B-257: both invoices paid,
/// the whole amount posted to ONE lease's ledger. The other lease's balance
/// still says the tenant owes money they have handed over.
async function splitPaymentShape() {
  const p = await makeLease('SPLIT-P')
  const q = await makeLease('SPLIT-Q', p.tenantId)
  const invoiceP = await openRent(p.leaseId, 10_000)
  const invoiceQ = await openRent(q.leaseId, 10_000)
  const payment = await prisma.payment.create({
    data: {
      facilityId,
      tenantId: p.tenantId,
      amountCents: 20_000,
      method: 'cash',
      status: 'succeeded',
    },
  })
  await prisma.paymentAllocation.createMany({
    data: [
      { paymentId: payment.id, invoiceId: invoiceP, amountCents: 10_000 },
      { paymentId: payment.id, invoiceId: invoiceQ, amountCents: 10_000 },
    ],
  })
  await prisma.invoice.updateMany({
    where: { id: { in: [invoiceP, invoiceQ] } },
    data: { amountPaidCents: 10_000, status: 'paid' },
  })
  await prisma.ledgerEntry.create({
    data: {
      facilityId,
      leaseId: p.leaseId,
      type: 'payment',
      amountCents: -20_000,
      description: 'Payment',
      paymentId: payment.id,
    },
  })
  return q
}

/// B-292's second shape. A partially paid invoice carried to another unit by a
/// transfer, leaving the paid part on the old lease with nothing to back it.
/// The pair of entries is what `transfer.ts` writes, and the invoice really
/// does move — that is what makes this one unrepairable by a balance change.
async function transferResidueShape() {
  const from = await makeLease('RESIDUE-FROM')
  const to = await makeLease('RESIDUE-TO', from.tenantId)
  const invoiceId = await openRent(from.leaseId, 10_000)

  const payment = await prisma.payment.create({
    data: {
      facilityId,
      tenantId: from.tenantId,
      amountCents: 5_000,
      method: 'cash',
      status: 'succeeded',
    },
  })
  await prisma.paymentAllocation.create({
    data: { paymentId: payment.id, invoiceId, amountCents: 5_000 },
  })
  await prisma.invoice.update({
    where: { id: invoiceId },
    data: { amountPaidCents: 5_000, status: 'partially_paid' },
  })
  await prisma.ledgerEntry.create({
    data: {
      facilityId,
      leaseId: from.leaseId,
      type: 'payment',
      amountCents: -5_000,
      description: 'Payment',
      paymentId: payment.id,
    },
  })

  // The transfer: the invoice and the arrears move, as a pair of entries that
  // both name the invoice.
  await prisma.invoice.update({ where: { id: invoiceId }, data: { leaseId: to.leaseId } })
  await prisma.ledgerEntry.createMany({
    data: [
      {
        facilityId,
        leaseId: from.leaseId,
        type: 'adjustment',
        amountCents: -5_000,
        description: 'Balance moved to the new unit',
        invoiceId,
      },
      {
        facilityId,
        leaseId: to.leaseId,
        type: 'adjustment',
        amountCents: 5_000,
        description: 'Balance carried from the old unit',
        invoiceId,
      },
    ],
  })
  return from
}

describeDb('B-303 — repairing a ledger that cannot be repaired any other way', () => {
  beforeAll(async () => {
    const facility = await prisma.facility.create({
      data: {
        name: `Ledger Corrections ${suffix}`,
        slug: `ledger-corrections-${suffix}`,
        addressLine1: '1 Storage Way',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704',
        timezone: 'America/Chicago',
      },
    })
    facilityId = facility.id
    const staffUser = await prisma.staffUser.create({
      data: { email: `lc-staff-${suffix}@example.com`, firstName: 'Cass', lastName: 'Manager' },
    })
    staffId = staffUser.id
    const unitType = await prisma.unitType.create({
      data: { facilityId, name: `10x10 ${suffix}`, widthFt: 10, lengthFt: 10 },
    })
    unitTypeId = unitType.id
  })

  afterAll(async () => {
    if (!hasDatabase) return
    await prisma.task.deleteMany({ where: { facilityId } })
    await prisma.ledgerExceptionAcknowledgement.deleteMany({ where: { facilityId } })
    // The facility and the staff user stay: `audit_log` carries a RESTRICT key
    // to both and refuses its own deletion by trigger (B-185), and this suite
    // writes audit rows on purpose. `db:reset-test` is what reclaims them.
    await prisma.paymentAllocation.deleteMany({ where: { payment: { facilityId } } })
    await prisma.ledgerEntry.deleteMany({ where: { facilityId } })
    await prisma.payment.deleteMany({ where: { facilityId } })
    await prisma.invoiceLineItem.deleteMany({ where: { invoice: { facilityId } } })
    await prisma.invoice.deleteMany({ where: { facilityId } })
    await prisma.lease.deleteMany({ where: { facilityId } })
    await prisma.unit.deleteMany({ where: { facilityId } })
    await prisma.unitType.deleteMany({ where: { facilityId } })
    await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } })
    await prisma.$disconnect()
  })

  it('clears the split-payment shape, and the tenant stops owing money they paid', async () => {
    const q = await splitPaymentShape()
    expect(await differenceFor(q.leaseId)).toBe(10_000)

    // The balance is what is wrong here: the ledger says $100 is owed by
    // somebody who paid it.
    const result = await postLedgerAdjustment(manager(null), {
      leaseId: q.leaseId,
      balanceChangeCents: -10_000,
      reasonCode: 'multi_unit_payment',
    })
    expect(result).toMatchObject({ ok: true, balanceChangeCents: -10_000 })

    const ledger = await leaseLedger(manager(null), q.leaseId)
    expect(ledger!.reconciliation).toMatchObject({ reconciles: true, differenceCents: 0 })
    expect(ledger!.totals.balanceCents).toBe(0)

    const exceptions = await ledgerExceptions([facilityId])
    expect(exceptions.some((row) => row.leaseId === q.leaseId)).toBe(false)
  })

  it('clears the transfer-residue shape WITHOUT inventing a credit', async () => {
    const from = await transferResidueShape()
    expect(await differenceFor(from.leaseId)).toBe(5_000)

    const before = await leaseLedger(manager(null), from.leaseId)
    expect(before!.totals.balanceCents).toBe(0)

    // Nothing is wrong with the balance — the invoice moved. A mechanism that
    // could only change the balance would leave this lease showing a $50 credit
    // the tenant does not have, and the delinquency engine cures on that
    // balance.
    const result = await postLedgerAdjustment(manager(null), {
      leaseId: from.leaseId,
      balanceChangeCents: 0,
      reasonCode: 'transfer_residue',
    })
    expect(result).toMatchObject({ ok: true, balanceChangeCents: 0 })

    const ledger = await leaseLedger(manager(null), from.leaseId)
    expect(ledger!.reconciliation).toMatchObject({ reconciles: true, differenceCents: 0 })
    expect(ledger!.totals.balanceCents).toBe(0)
    expect(ledger!.lines.at(-1)!.balanceCents).toBe(0)
  })

  it('lets a lien notice be generated once the lease reconciles', async () => {
    const q = await splitPaymentShape()
    // A month that really is owed, so the claim has something to state.
    await openRent(q.leaseId, 12_900)

    const refused = await claimForLease(q.leaseId)
    expect(refused.ok).toBe(false)
    if (refused.ok) throw new Error('unreachable')
    expect(refused.problem.kind).toBe('ledger_does_not_reconcile')

    await postLedgerAdjustment(manager(null), {
      leaseId: q.leaseId,
      balanceChangeCents: -10_000,
      reasonCode: 'multi_unit_payment',
    })

    const claim = await claimForLease(q.leaseId)
    expect(claim.ok).toBe(true)
    if (!claim.ok) throw new Error('unreachable')
    expect(claim.claim.totalCents).toBe(12_900)
  })

  it('refuses a staffer over their limit, and writes nothing', async () => {
    const q = await splitPaymentShape()
    const entriesBefore = await prisma.ledgerEntry.count({ where: { leaseId: q.leaseId } })

    const result = await postLedgerAdjustment(manager(5_000), {
      leaseId: q.leaseId,
      balanceChangeCents: -10_000,
      reasonCode: 'multi_unit_payment',
    })
    expect(result).toMatchObject({ ok: false, reason: 'over_limit', limitCents: 5_000 })

    expect(await prisma.ledgerEntry.count({ where: { leaseId: q.leaseId } })).toBe(entriesBefore)
    expect(await differenceFor(q.leaseId)).toBe(10_000)
  })

  it('refuses a staffer without manual-credit authority, and refuses an unreasoned post', async () => {
    const q = await splitPaymentShape()

    expect(
      await postLedgerAdjustment(counterStaff(), {
        leaseId: q.leaseId,
        balanceChangeCents: -10_000,
        reasonCode: 'multi_unit_payment',
      }),
    ).toMatchObject({ ok: false, reason: 'forbidden' })

    expect(
      await postLedgerAdjustment(manager(null), {
        leaseId: q.leaseId,
        balanceChangeCents: -10_000,
        reasonCode: '  ',
      }),
    ).toMatchObject({ ok: false, reason: 'missing_reason' })

    expect(await prisma.ledgerEntry.count({ where: { leaseId: q.leaseId, isCorrection: true } })).toBe(0)
  })

  it('records every correction in the audit log with actor, lease, amount and reason', async () => {
    const q = await splitPaymentShape()
    await postLedgerAdjustment(manager(null), {
      leaseId: q.leaseId,
      balanceChangeCents: -10_000,
      reasonCode: 'multi_unit_payment',
      note: 'Cheque 4471 covered both units.',
    })

    const row = await prisma.auditLog.findFirst({
      where: { action: 'ledger.adjusted', entityId: q.leaseId },
      orderBy: { occurredAt: 'desc' },
    })
    expect(row).toMatchObject({
      entityType: 'Lease',
      facilityId,
      actorStaffId: staffId,
      reasonCode: 'multi_unit_payment',
    })
    expect(row!.after).toMatchObject({ balanceChangeCents: -10_000, differenceCents: 10_000 })
  })

  it('writes off an open lease and leaves it reconciled, invoices marked uncollectible', async () => {
    const lease = await makeLease('WRITEOFF')
    const invoiceId = await openRent(lease.leaseId, 12_900)

    const result = await writeOffOpenLeaseBalance(manager(null), {
      leaseId: lease.leaseId,
      reasonCode: 'uncollectible',
    })
    expect(result).toMatchObject({ ok: true, amountCents: 12_900, invoicesMarked: 1 })

    const ledger = await leaseLedger(manager(null), lease.leaseId)
    expect(ledger!.totals.balanceCents).toBe(0)
    expect(ledger!.totals.writtenOffCents).toBe(12_900)
    // The lease stays OPEN — this is bad debt on a live tenancy, not a move-out.
    expect(ledger!.reconciliation.reconciles).toBe(true)

    const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } })
    expect(invoice.status).toBe('uncollectible')
    expect(await prisma.lease.findUniqueOrThrow({ where: { id: lease.leaseId } })).toMatchObject({
      status: 'active',
    })
  })

  it('voids a rent invoice, leaves the lease reconciled, and refuses a fee invoice', async () => {
    const lease = await makeLease('VOID')
    const invoiceId = await openRent(lease.leaseId, 12_900)

    const result = await voidRentInvoice(manager(null), {
      invoiceId,
      reasonCode: 'wrong_period',
    })
    expect(result).toMatchObject({ ok: true, amountCents: 12_900 })

    const ledger = await leaseLedger(manager(null), lease.leaseId)
    expect(ledger!.totals.balanceCents).toBe(0)
    expect(ledger!.reconciliation.reconciles).toBe(true)
    expect(
      (await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } })).status,
    ).toBe('void')

    // A fee invoice is `waiveFeeInvoice`'s, with its own permission and its own
    // limit. This must not become a second way in.
    const feeLease = await makeLease('VOID-FEE')
    const feeInvoiceId = await openRent(feeLease.leaseId, 2_500)
    await prisma.invoice.update({ where: { id: feeInvoiceId }, data: { kind: 'fee' } })
    expect(await voidRentInvoice(manager(null), { invoiceId: feeInvoiceId, reasonCode: 'duplicate' })).toMatchObject(
      { ok: false, reason: 'not_found' },
    )
  })

  it('B-346 — a preview runs every refusal and returns what it would post, writing nothing', async () => {
    const lease = await makeLease('PREVIEW')
    const invoiceId = await openRent(lease.leaseId, 12_900)
    const before = await prisma.ledgerEntry.count({ where: { leaseId: lease.leaseId } })
    const audited = () => prisma.auditLog.count({ where: { entityId: { in: [lease.leaseId, invoiceId] } } })
    const auditBefore = await audited()

    expect(
      await postLedgerAdjustment(manager(null), {
        leaseId: lease.leaseId,
        balanceChangeCents: -4_000,
        reasonCode: 'billing_error',
        preview: true,
      }),
    ).toMatchObject({ ok: true, balanceChangeCents: -4_000 })
    expect(
      await writeOffOpenLeaseBalance(manager(null), { leaseId: lease.leaseId, reasonCode: 'uncollectible', preview: true }),
    ).toMatchObject({ ok: true, amountCents: 12_900, invoicesMarked: 1 })
    expect(
      await voidRentInvoice(manager(null), { invoiceId, reasonCode: 'wrong_period', preview: true }),
    ).toMatchObject({ ok: true, amountCents: 12_900, leaseId: lease.leaseId })
    // The refusals still run: the confirm step is never offered for a post
    // that would then be refused.
    expect(
      await writeOffOpenLeaseBalance(manager(null), { leaseId: lease.leaseId, reasonCode: '', preview: true }),
    ).toMatchObject({ ok: false, reason: 'missing_reason' })

    expect(await prisma.ledgerEntry.count({ where: { leaseId: lease.leaseId } })).toBe(before)
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } })).status).toBe('open')
    expect(await audited()).toBe(auditBefore)
  })

  it('leaves a healthy lease healthy when a plain adjustment is posted', async () => {
    const lease = await makeLease('PLAIN')
    await openRent(lease.leaseId, 12_900)
    expect(await differenceFor(lease.leaseId)).toBe(0)

    const result = await postLedgerAdjustment(manager(null), {
      leaseId: lease.leaseId,
      balanceChangeCents: -2_000,
      reasonCode: 'management_approval',
    })
    expect(result).toMatchObject({ ok: true, entries: 1 })

    const ledger = await leaseLedger(manager(null), lease.leaseId)
    expect(ledger!.totals.balanceCents).toBe(10_900)
    expect(ledger!.reconciliation.reconciles).toBe(true)
  })

  it('B-304 — stops the daily task naming an acknowledged lease, and names the other', async () => {
    const acknowledged = await splitPaymentShape()
    const untouched = await splitPaymentShape()
    const now = new Date()

    expect(
      await acknowledgeLedgerException(manager(null), acknowledged.leaseId, {
        note: 'Cheque 4471 paid both units before B-257. Cannot be repaired.',
      }),
    ).toMatchObject({ ok: true, differenceCents: 10_000 })

    const listed = await ledgerExceptions([facilityId])
    // It is still an exception. Acknowledging is not repairing.
    expect(listed.some((row) => row.leaseId === acknowledged.leaseId)).toBe(true)
    expect(listed.find((row) => row.leaseId === acknowledged.leaseId)!.acknowledgement).toMatchObject({
      by: 'Cass Manager',
    })
    expect(listed.find((row) => row.leaseId === untouched.leaseId)!.acknowledgement).toBeNull()

    const swept = await raiseLedgerExceptionTasks(now, [facilityId])
    expect(swept.total).toBe(listed.length)
    expect(swept.unacknowledged).toBe(listed.length - 1)
    const task = await prisma.task.findFirstOrThrow({
      where: { facilityId, type: 'ledger_does_not_reconcile' },
    })
    expect(task.detail).toContain(`${swept.unacknowledged} lease`)
  })

  it('B-304 — brings the lease back the moment the difference changes', async () => {
    const lease = await splitPaymentShape()
    await acknowledgeLedgerException(manager(null), lease.leaseId, { note: 'Known.' })
    expect(
      (await ledgerExceptions([facilityId])).find((row) => row.leaseId === lease.leaseId)!
        .acknowledgement,
    ).not.toBeNull()

    // A new unpaid month moves the discrepancy — nothing about it, so the
    // judgement no longer applies. An acknowledgement is about a KNOWN
    // difference, not a permanent mute.
    await openRent(lease.leaseId, 12_900)
    await prisma.invoice.updateMany({
      where: { leaseId: lease.leaseId, status: 'open' },
      data: { amountPaidCents: 12_900, status: 'paid' },
    })

    const row = (await ledgerExceptions([facilityId])).find((one) => one.leaseId === lease.leaseId)!
    expect(row.reconciliation.differenceCents).toBe(22_900)
    expect(row.acknowledgement).toBeNull()
  })

  it('B-304 — refuses an unreasoned acknowledgement, a reconciled lease, and a bookkeeper', async () => {
    const lease = await splitPaymentShape()

    expect(
      await acknowledgeLedgerException(manager(null), lease.leaseId, { note: '   ' }),
    ).toMatchObject({ ok: false, reason: 'missing_note' })
    expect(
      await acknowledgeLedgerException(counterStaff(), lease.leaseId, { note: 'Known.' }),
    ).toMatchObject({ ok: false, reason: 'forbidden' })

    const healthy = await makeLease('ACK-OK')
    await openRent(healthy.leaseId, 12_900)
    expect(
      await acknowledgeLedgerException(manager(null), healthy.leaseId, { note: 'Known.' }),
    ).toMatchObject({ ok: false, reason: 'reconciles' })

    expect(await prisma.ledgerExceptionAcknowledgement.count({ where: { leaseId: lease.leaseId } })).toBe(0)
  })

  it('B-304 — an acknowledged lease is still refused a lien notice', async () => {
    const lease = await splitPaymentShape()
    await openRent(lease.leaseId, 12_900)
    await acknowledgeLedgerException(manager(null), lease.leaseId, { note: 'Known.' })

    const claim = await claimForLease(lease.leaseId)
    expect(claim.ok).toBe(false)
    if (claim.ok) throw new Error('unreachable')
    expect(claim.problem.kind).toBe('ledger_does_not_reconcile')
  })
})
