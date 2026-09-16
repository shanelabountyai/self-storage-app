import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { prisma } from '../packages/db'
import { processCommsEvent } from '../apps/web/lib/comms/service'
import * as provider from '../apps/web/lib/comms/provider'
import { accountDetail } from '../apps/web/lib/billing/accounts'
import type { Actor } from '../apps/web/lib/rbac/actor'
import type { PermissionKey } from '@storage/db/rbac-catalog'

// B-279 (D-136). A business account's payer is sent the bill and the past-due
// ladder beside the lease's own tenant, and never the lien-notice supplement
// (D-118). Against the real seeded catalog, because the line is drawn by event
// name and a test rule on a made-up event would not cross it.
//
// B-309. And ONCE, whatever the unit count: the payer's copy consolidates on
// (account, business date, event class) and renders the `_account` template
// against the account's own total and pay screen, where the lease's own tenant
// still gets the per-unit message unchanged.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)
const DAY = 86_400_000

let facilityId = ''
let staffId = ''
/// The employee whose goods are in the unit. No stated language: English.
let tenantId = ''
/// Accounts payable, who reads Spanish.
let payerId = ''
/// A neighbour on nobody's account.
let neighbourId = ''
let accountId = ''
let accountLeaseId = ''
let accountInvoiceId = ''
let plainInvoiceId = ''
/// B-309. A three-unit account of its own, so the consolidation is measured
/// without depending on which test ran first — the payer's copy is keyed on the
/// account and the business date, so two tests sharing an account would be
/// asserting each other's leftovers.
let manyAccountId = ''
const manyInvoiceIds: string[] = []

const sent: string[] = []

function manager(): Actor {
  return {
    kind: 'staff',
    staffUserId: staffId,
    assignments: [
      {
        facilityId,
        roleKey: 'manager',
        rank: 20,
        permissions: new Set<PermissionKey>(['billing_accounts:manage']),
        limits: { maxFeeWaiverCents: 0, maxRefundCents: 0, maxCreditCents: 0 },
      },
    ],
  }
}

async function dispatch(name: string, entityType: string, entityId: string, payload: object = {}) {
  const event = await prisma.domainEvent.create({
    data: { name, entityType, entityId, facilityId, payload },
  })
  await processCommsEvent(event)
  return prisma.message.findMany({ where: { eventId: event.id } })
}

function recipientsOf(messages: { recipientTenantId: string | null }[]) {
  return messages.map((message) => message.recipientTenantId).sort()
}

async function makeLease(tenant: string, unitTypeId: string, unitNumber: string, billingAccountId?: string) {
  const unit = await prisma.unit.create({ data: { facilityId, unitTypeId, number: unitNumber } })
  const lease = await prisma.lease.create({
    data: {
      facilityId,
      tenantId: tenant,
      unitId: unit.id,
      status: 'active',
      startDate: new Date('2026-06-01T00:00:00Z'),
      billingDay: 1,
      monthlyRateCents: 12_900,
      billingAccountId,
    },
  })
  return lease.id
}

/// An open rent invoice AND the charge it puts on the ledger. `accountBill`
/// reads the ledger, not the invoice table — the same aggregate the account
/// card and the account pay screen add up — so an invoice with no charge
/// behind it is an account that owes nothing and is correctly told nothing.
async function openRent(leaseId: string, number: string, dueDate: Date) {
  const invoice = await prisma.invoice.create({
    data: {
      facilityId,
      leaseId,
      number: `${number}-${suffix}`,
      kind: 'rent',
      status: 'open',
      issueDate: dueDate,
      dueDate,
      periodStart: dueDate,
      periodEnd: new Date(dueDate.getTime() + 30 * DAY),
      subtotalCents: 12_900,
      totalCents: 12_900,
    },
  })
  await prisma.ledgerEntry.create({
    data: {
      facilityId,
      leaseId,
      type: 'charge',
      amountCents: 12_900,
      description: `Rent ${number}`,
      invoiceId: invoice.id,
      occurredAt: dueDate,
    },
  })
  return invoice.id
}

describeDb('business account payer comms', () => {
  beforeAll(async () => {
    vi.spyOn(provider, 'selectProvider').mockImplementation(() => ({
      name: 'test',
      async sendEmail(email) {
        sent.push(email.to)
        return { ok: true, providerMessageId: `test_${sent.length}` }
      },
    }))
    vi.spyOn(provider, 'commsEnabled').mockReturnValue(true)
    vi.spyOn(provider, 'effectiveRecipient').mockImplementation((address: string) => address)

    const facility = await prisma.facility.create({
      data: {
        name: `Payer Comms ${suffix}`,
        slug: `payer-comms-${suffix}`,
        addressLine1: '1 Storage Way',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704',
        timezone: 'America/Chicago',
        phone: '512-555-0100',
      },
    })
    facilityId = facility.id

    const staff = await prisma.staffUser.create({
      data: { email: `payer-comms-staff-${suffix}@example.com`, firstName: 'Mo', lastName: 'Manager' },
    })
    staffId = staff.id

    const [tenant, payer, neighbour] = await Promise.all([
      prisma.tenant.create({
        data: { email: `payer-comms-tenant-${suffix}@example.com`, firstName: 'Ada', lastName: 'Renter' },
      }),
      prisma.tenant.create({
        data: {
          email: `payer-comms-payer-${suffix}@example.com`,
          firstName: 'Pat',
          lastName: 'Payables',
          preferredLocale: 'es',
        },
      }),
      prisma.tenant.create({
        data: { email: `payer-comms-neighbour-${suffix}@example.com`, firstName: 'Nia', lastName: 'Neighbour' },
      }),
    ])
    tenantId = tenant.id
    payerId = payer.id
    neighbourId = neighbour.id

    const account = await prisma.billingAccount.create({
      data: { facilityId, name: `Acme Contracting ${suffix}`, payerTenantId: payerId },
    })
    accountId = account.id

    const unitType = await prisma.unitType.create({
      data: { facilityId, name: `10x10 ${suffix}`, widthFt: 10, lengthFt: 10 },
    })
    accountLeaseId = await makeLease(tenantId, unitType.id, `PC-1-${suffix}`, accountId)
    const plainLeaseId = await makeLease(neighbourId, unitType.id, `PC-2-${suffix}`)

    const today = new Date()
    const midnight = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
    accountInvoiceId = await openRent(accountLeaseId, 'PC1', new Date(midnight - 20 * DAY))
    plainInvoiceId = await openRent(plainLeaseId, 'PC2', new Date(midnight + 3 * DAY))

    const manyAccount = await prisma.billingAccount.create({
      data: { facilityId, name: `Bulk Haulage ${suffix}`, payerTenantId: payerId },
    })
    manyAccountId = manyAccount.id
    for (const index of [1, 2, 3]) {
      const leaseId = await makeLease(tenantId, unitType.id, `PC-M${index}-${suffix}`, manyAccountId)
      manyInvoiceIds.push(
        await openRent(leaseId, `PCM${index}`, new Date(midnight + (index + 2) * DAY)),
      )
    }
  })

  afterAll(async () => {
    if (!hasDatabase) return
    vi.restoreAllMocks()
    await prisma.message.deleteMany({ where: { facilityId } })
    await prisma.ledgerEntry.deleteMany({ where: { facilityId } })
    await prisma.payLink.deleteMany({ where: { lease: { facilityId } } })
    await prisma.domainEvent.deleteMany({ where: { facilityId } })
    await prisma.delinquencyStepRun.deleteMany({ where: { facilityId } })
    await prisma.delinquencyTimeline.deleteMany({ where: { facilityId } })
    await prisma.invoice.deleteMany({ where: { facilityId } })
    await prisma.$disconnect()
  })

  it('sends a bill on an account lease to the tenant and the payer, each in their own language', async () => {
    const messages = await dispatch('invoice.due_soon', 'Invoice', accountInvoiceId)

    expect(recipientsOf(messages)).toEqual([tenantId, payerId].sort())
    const byRecipient = new Map(messages.map((message) => [message.recipientTenantId, message]))
    expect(byRecipient.get(tenantId)).toMatchObject({
      status: 'sent',
      templateKey: 'invoice_due_soon',
    })
    expect(byRecipient.get(tenantId)?.subjectSnapshot).toContain('Rent for unit')

    // B-309. The payer's copy is the account's, in the payer's own language:
    // the account template, the account's name in the subject rather than a
    // unit number, and a link that opens the account pay screen.
    const payerMessage = byRecipient.get(payerId)
    expect(payerMessage).toMatchObject({ status: 'sent', templateKey: 'invoice_due_soon_account' })
    expect(payerMessage?.subjectSnapshot).toContain(`Acme Contracting ${suffix}`)
    expect(payerMessage?.subjectSnapshot).not.toContain('unidad')
    expect(payerMessage?.bodySnapshot).toContain(`/portal/pay?account=${accountId}`)
    expect(payerMessage?.bodySnapshot).toContain('$129.00')
    // Spanish throughout, not a Spanish greeting around English sentences.
    expect(payerMessage?.bodySnapshot).toContain('debe')
    expect(payerMessage?.bodySnapshot).toContain('unidad')

    // The tenant's own one-tap link is still minted; the payer's is the
    // account URL, which needs no PayLink row at all.
    const links = await prisma.payLink.findMany({
      where: { eventId: messages[0].eventId, revokedAt: null },
      select: { tenantId: true },
    })
    expect(links.map((link) => link.tenantId)).toEqual([tenantId])
  })

  it('sends the payer ONE message for a three-unit account, and each tenant their own', async () => {
    // B-309. The defect: fifteen units raised fifteen payer messages, each
    // with a pay link opening a single-unit screen.
    const perEvent = await Promise.all(
      manyInvoiceIds.map((invoiceId) => dispatch('invoice.due_soon', 'Invoice', invoiceId)),
    )
    const all = perEvent.flat()

    expect(all.filter((message) => message.recipientTenantId === tenantId)).toHaveLength(3)

    const payerMessages = await prisma.message.findMany({
      where: { recipientTenantId: payerId, templateKey: 'invoice_due_soon_account' },
    })
    const forThisAccount = payerMessages.filter((message) =>
      message.bodySnapshot.includes(`/portal/pay?account=${manyAccountId}`),
    )
    expect(forThisAccount).toHaveLength(1)
    expect(forThisAccount[0].status).toBe('sent')
    // One figure, and it is the whole account's — not one unit's.
    expect(forThisAccount[0].bodySnapshot).toContain('$387.00')
    expect(forThisAccount[0].bodySnapshot).toContain('3 unidades')
  })

  it('sends a bill on a lease nobody else pays for to its tenant alone, as before', async () => {
    const messages = await dispatch('invoice.due_soon', 'Invoice', plainInvoiceId)
    expect(recipientsOf(messages)).toEqual([neighbourId])
  })

  it('sends a past-due ladder step to the payer as well', async () => {
    const messages = await dispatch('delinquency.day_reached', 'Lease', accountLeaseId, {
      invoiceId: accountInvoiceId,
      day: 20,
      position: 1,
      totalSteps: 4,
    })
    expect(recipientsOf(messages)).toEqual([tenantId, payerId].sort())
    expect(messages.every((message) => message.status === 'sent')).toBe(true)
  })

  it('serves the lien-notice supplement on the tenant and never on the payer (D-118)', async () => {
    const messages = await dispatch('notice.generated', 'Lease', accountLeaseId, {
      noticeId: `notice-${suffix}`,
      type: 'lien',
      claimTotalCents: 12_900,
      deadlineDate: '2026-10-01',
    })
    // Two rows, both the tenant's: the lien supplement sent, and the pre-lien
    // rule on the same event recording its own skip.
    expect(new Set(recipientsOf(messages))).toEqual(new Set([tenantId]))
    expect(messages.find((message) => message.templateKey === 'lien_notice_supplement')?.status).toBe('sent')
  })

  it('says on the account how late it is and how far the ladder has gone', async () => {
    const timeline = await prisma.delinquencyTimeline.create({
      data: { facilityId, version: 1, label: 'Test', steps: [] },
    })
    const run = { leaseId: accountLeaseId, facilityId, timelineId: timeline.id, businessDate: new Date() }
    await prisma.delinquencyStepRun.createMany({
      data: [
        { ...run, dayOffset: 5, label: 'Reminder' },
        { ...run, dayOffset: 15, label: 'Pre-lien notice' },
        // A cured episode's step is evidence, not position.
        { ...run, dayOffset: 45, label: 'Lien sale', supersededAt: new Date() },
      ],
    })

    const detail = await accountDetail(manager(), accountId)
    expect(detail).toMatchObject({ daysPastDue: 20, stage: 'Pre-lien notice' })
  })
})
