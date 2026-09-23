import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { prisma } from '../packages/db'
import { counterReceipt, receiptRows, recordCounterPayment } from '../apps/web/lib/admin/pos'
import { portalAccountsFor } from '../apps/web/lib/billing/accounts'
import { processCommsEvent } from '../apps/web/lib/comms/service'
import * as provider from '../apps/web/lib/comms/provider'
import { dictionaryFor, translate, type MessageKey } from '../apps/web/lib/i18n'
import { paymentReceipt, receiptBalanceLabel } from '../apps/web/lib/portal/payment'
import type { Actor } from '../apps/web/lib/rbac/actor'
import type { PermissionKey } from '@storage/db/rbac-catalog'

// B-331. Every receipt quoted the balance across the CREDITED units and called
// it the account's: a partial payment that settled two of three units read
// "$0.00" beside an account card still owing the third. Now the figure is the
// account's when every credited unit is on one account, and otherwise the line
// names the units it covers.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)

let facilityId = ''
let staffId = ''
let unitTypeId = ''
let accountId = ''
const tenantIds: string[] = []
let counter = 0

const sends: { subject: string; body: string; html: string }[] = []

const t = (key: MessageKey, vars?: Record<string, string | number>) =>
  translate(dictionaryFor('en'), key, vars)

function staff(): Actor {
  return {
    kind: 'staff',
    staffUserId: staffId,
    assignments: [
      {
        facilityId,
        roleKey: 'counter',
        rank: 10,
        permissions: new Set<PermissionKey>(['payments:take', 'tenants:view']),
        limits: { maxFeeWaiverCents: 0, maxRefundCents: 0, maxCreditCents: 0 },
      },
    ],
  }
}

async function tenant(name: string) {
  const id = (
    await prisma.tenant.create({
      data: { email: `rbs-${name}-${suffix}@example.com`, firstName: name, lastName: 'Fixture' },
    })
  ).id
  tenantIds.push(id)
  return id
}

async function makeLease(tenantId: string, number: string, billingAccountId: string | null = null) {
  const unit = await prisma.unit.create({ data: { facilityId, unitTypeId, number } })
  return (
    await prisma.lease.create({
      data: {
        facilityId,
        tenantId,
        unitId: unit.id,
        billingAccountId,
        status: 'active',
        startDate: new Date('2026-01-01T00:00:00Z'),
        billingDay: 1,
        monthlyRateCents: 10_000,
      },
    })
  ).id
}

/// Each call is a month later, so the first invoice opened is the oldest.
async function openRent(leaseId: string, cents: number) {
  counter += 1
  const start = new Date(Date.UTC(2026, counter, 1))
  const invoice = await prisma.invoice.create({
    data: {
      facilityId,
      leaseId,
      number: `RBS${counter}-${suffix}`,
      kind: 'rent',
      status: 'open',
      issueDate: start,
      dueDate: start,
      periodStart: start,
      periodEnd: new Date(Date.UTC(2026, counter + 1, 1)),
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
}

async function emailReceipt(paymentId: string): Promise<string> {
  return (await emailReceiptParts(paymentId)).body
}

async function emailReceiptParts(paymentId: string) {
  sends.length = 0
  const event = await prisma.domainEvent.create({
    data: { name: 'payment.succeeded', entityType: 'Payment', entityId: paymentId, facilityId, payload: {} },
  })
  await processCommsEvent(event)
  expect(sends).toHaveLength(1)
  return sends[0]
}

async function counterBalanceRow(paymentId: string) {
  const receipt = await counterReceipt(staff(), paymentId)
  return receiptRows(receipt!).find((row) => /^(Balance|Credit) on /.test(row.label))
}

describeDb('receipt balance scope (B-331)', () => {
  beforeAll(async () => {
    vi.spyOn(provider, 'selectProvider').mockImplementation(() => ({
      name: 'test',
      async sendEmail(email) {
        sends.push({ subject: email.subject ?? '', body: email.text ?? '', html: email.html ?? '' })
        return { ok: true, providerMessageId: `test_${sends.length}` }
      },
    }))
    vi.spyOn(provider, 'commsEnabled').mockReturnValue(true)
    vi.spyOn(provider, 'effectiveRecipient').mockImplementation((address: string) => address)

    facilityId = (
      await prisma.facility.create({
        data: {
          name: `Receipt Scope ${suffix}`,
          slug: `receipt-scope-${suffix}`,
          addressLine1: '1 Storage Way',
          city: 'Austin',
          state: 'TX',
          postalCode: '78704',
          timezone: 'America/Chicago',
          // The receipt template requires it.
          phone: '512-555-0100',
        },
      })
    ).id
    staffId = (
      await prisma.staffUser.create({
        data: { email: `rbs-staff-${suffix}@example.com`, firstName: 'Cam', lastName: 'Counter' },
      })
    ).id
    unitTypeId = (
      await prisma.unitType.create({
        data: { facilityId, name: `10x10 ${suffix}`, widthFt: 10, lengthFt: 10 },
      })
    ).id
  })

  afterAll(async () => {
    if (!hasDatabase) return
    vi.restoreAllMocks()
    await prisma.message.deleteMany({ where: { facilityId } })
    await prisma.domainEvent.deleteMany({ where: { facilityId } })
    await prisma.paymentAllocation.deleteMany({ where: { payment: { facilityId } } })
    await prisma.ledgerEntry.deleteMany({ where: { facilityId } })
    await prisma.payment.deleteMany({ where: { facilityId } })
    await prisma.invoiceLineItem.deleteMany({ where: { invoice: { facilityId } } })
    await prisma.invoice.deleteMany({ where: { facilityId } })
    await prisma.lease.updateMany({ where: { facilityId }, data: { billingAccountId: null } })
    await prisma.billingAccount.deleteMany({ where: { facilityId } })
    await prisma.lease.deleteMany({ where: { facilityId } })
    await prisma.unit.deleteMany({ where: { facilityId } })
    await prisma.unitType.deleteMany({ where: { facilityId } })
    await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } })
    await prisma.$disconnect()
  })

  it('quotes the account’s balance, named, on every receipt of a partial account payment', async () => {
    const payerId = await tenant('payer')
    const name = `Acme Crews ${suffix}`
    accountId = (
      await prisma.billingAccount.create({ data: { facilityId, name, payerTenantId: payerId } })
    ).id
    const [a, b, c] = [await tenant('ed'), await tenant('fay'), await tenant('gus')]
    const leases = [
      await makeLease(a, 'A-1', accountId),
      await makeLease(b, 'A-2', accountId),
      await makeLease(c, 'A-3', accountId),
    ]
    for (const leaseId of leases) await openRent(leaseId, 10_000)

    // $200 of a $300 account: two units settled in full, one still owing.
    const result = await recordCounterPayment(staff(), {
      facilityId,
      tenantId: payerId,
      leaseId: '',
      accountId,
      method: 'check',
      checkNumber: '2001',
      amountCents: 20_000,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const card = (await portalAccountsFor(payerId)).find((account) => account.id === accountId)
    expect(card?.balanceCents).toBe(10_000)

    expect(await emailReceipt(result.paymentId)).toContain(
      `Balance on ${name} after this payment: $100.00.`,
    )

    const portal = await paymentReceipt(payerId, result.paymentId)
    expect(portal?.balanceCents).toBe(10_000)
    expect(receiptBalanceLabel(portal!, t, 'en-US')).toBe(`Balance on ${name}`)

    expect(await counterBalanceRow(result.paymentId)).toEqual({
      label: `Balance on ${name}`,
      value: '$100.00',
    })
  })

  // B-353. A member who is not the payer paying their own account unit saw the
  // company's whole balance, and its name, on every receipt.
  it('quotes only the unit when a non-payer member pays their own account unit', async () => {
    const payerId = await tenant('boss')
    const name = `Acme Members ${suffix}`
    const account = (
      await prisma.billingAccount.create({ data: { facilityId, name, payerTenantId: payerId } })
    ).id
    const dana = await tenant('dana')
    const hers = await makeLease(dana, 'C-5', account)
    await openRent(hers, 8_000)
    await openRent(await makeLease(await tenant('eli'), 'C-6', account), 50_000)

    const result = await recordCounterPayment(staff(), {
      facilityId,
      tenantId: dana,
      leaseId: hers,
      restrictToLease: true,
      method: 'cash',
      amountCents: 8_000,
      tenderedCents: 8_000,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const { body } = await emailReceiptParts(result.paymentId)
    expect(body).toContain('Balance on unit C-5 after this payment: $0.00.')
    expect(body).not.toContain(name)

    const portal = await paymentReceipt(dana, result.paymentId)
    expect(portal?.accountName).toBeNull()
    expect(portal?.balanceCents).toBe(0)
    expect(receiptBalanceLabel(portal!, t, 'en-US')).toBe('Balance on unit C-5')

    const receipt = (await counterReceipt(staff(), result.paymentId))!
    expect(receiptRows(receipt).some((row) => row.value === name)).toBe(false)
    expect(await counterBalanceRow(result.paymentId)).toEqual({
      label: 'Balance on unit C-5',
      value: '$0.00',
    })
  })

  it('names the one unit a directed payment on a two-unit personal tenant covered', async () => {
    const tenantId = await tenant('pat')
    const mine = await makeLease(tenantId, 'P-1')
    const other = await makeLease(tenantId, 'P-2')
    await openRent(mine, 10_000)
    await openRent(other, 10_000)

    const result = await recordCounterPayment(staff(), {
      facilityId,
      tenantId,
      leaseId: other,
      restrictToLease: true,
      method: 'cash',
      amountCents: 10_000,
      tenderedCents: 10_000,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const body = await emailReceipt(result.paymentId)
    expect(body).toContain('Balance on unit P-2 after this payment: $0.00.')

    const portal = await paymentReceipt(tenantId, result.paymentId)
    expect(portal?.accountName).toBeNull()
    expect(receiptBalanceLabel(portal!, t, 'en-US')).toBe('Balance on unit P-2')
    expect(
      receiptBalanceLabel(portal!, (key, vars) => translate(dictionaryFor('es'), key, vars), 'es'),
    ).toBe('Saldo de la unidad P-2')

    expect(await counterBalanceRow(result.paymentId)).toEqual({
      label: 'Balance on unit P-2',
      value: '$0.00',
    })
  })

  // B-343. The email carries what the paper receipt prints, from the same
  // columns `receiptRows` reads, so an AP department can match it to its check.
  it('carries the receipt number, check number and account the paper receipt prints', async () => {
    const payerId = await tenant('ap')
    const name = `Beta Hauling ${suffix}`
    const account = (
      await prisma.billingAccount.create({ data: { facilityId, name, payerTenantId: payerId } })
    ).id
    await openRent(await makeLease(await tenant('hal'), 'B-1', account), 10_000)

    const result = await recordCounterPayment(staff(), {
      facilityId,
      tenantId: payerId,
      leaseId: '',
      accountId: account,
      method: 'check',
      checkNumber: '4321',
      amountCents: 10_000,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const receipt = (await counterReceipt(staff(), result.paymentId))!
    const rows = receiptRows(receipt)
    expect(rows).toContainEqual({ label: 'Account', value: name })
    expect(rows).toContainEqual({ label: 'Paid by', value: 'Check #4321' })

    const { body, html } = await emailReceiptParts(result.paymentId)
    expect(body).toContain(`Receipt number: #${receipt.receiptNumber}`)
    expect(body).toContain(`Account: ${name}`)
    expect(body).toContain('Paid by: Check #4321')
    expect(html).toContain(`<th scope="row" align="left">Receipt number</th><td align="left">#${receipt.receiptNumber}</td>`)
    // B-361: no "Detail / Value" column-header row; caption and row headers remain.
    expect(html).not.toContain('Detail')
    expect(html).not.toContain('scope="col"')
    expect(html).toContain('Receipt details')
    expect(html).toContain(`<th scope="row" align="left">Account</th><td align="left">${name}</td>`)
    expect(html).toContain('<th scope="row" align="left">Paid by</th><td align="left">Check #4321</td>')
  })

  it('renders a card receipt with no receipt number', async () => {
    const tenantId = await tenant('cara')
    await makeLease(tenantId, 'C-1')
    const payment = await prisma.payment.create({
      data: { facilityId, tenantId, amountCents: 5_000, method: 'card', status: 'succeeded' },
    })

    const { body, html } = await emailReceiptParts(payment.id)
    expect(body).toContain('Paid by: Card')
    expect(body).not.toContain('Receipt number')
    expect(html).not.toContain('Receipt number')
  })
})
