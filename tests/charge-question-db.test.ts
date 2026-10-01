import { randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { prisma } from '../packages/db'
import type { PermissionKey } from '@storage/db/rbac-catalog'
import { askAboutCharge, chargeQuestionsFor } from '../apps/web/lib/portal/charge-question'
import { waiveFeeInvoice } from '../apps/web/lib/billing/late-fees'
import { completeTask } from '../apps/web/lib/admin/tasks'
import { processCommsEvent } from '../apps/web/lib/comms/service'
import * as provider from '../apps/web/lib/comms/provider'
import type { Actor } from '../apps/web/lib/rbac/actor'

// PRD 01 US-705 "Ask about one charge" (B-421). One ask makes one task on the
// line; a second while it is open is refused; a waiver answers it with a credit
// and the line reads waived; a note answers it as kept. Each answer emits the
// one event the comms rule sends from.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)

let facilityId = ''
let tenantId = ''
let leaseId = ''
let staffId = ''
let counter = 0

const tenant = (): Extract<Actor, { kind: 'tenant' }> => ({ kind: 'tenant', tenantId })
const staff = (): Actor => ({
  kind: 'staff',
  staffUserId: staffId,
  assignments: [
    {
      facilityId,
      roleKey: 'manager',
      rank: 20,
      permissions: new Set<PermissionKey>(['fees:waive', 'tenants:edit']),
      limits: { maxFeeWaiverCents: 5_000, maxRefundCents: 0, maxCreditCents: 0 },
    },
  ],
})

/// One invoice with one line; a fee invoice when `kind` says so.
async function invoiceLine(kind: 'rent' | 'fee', amountCents: number): Promise<{ invoiceId: string; lineId: string }> {
  counter += 1
  // Rent invoices are unique per (lease, periodStart): one month per call.
  const on = new Date(Date.UTC(2026, counter, 1, 15))
  const invoice = await prisma.invoice.create({
    data: {
      facilityId,
      leaseId,
      number: `CQ-${suffix}-${counter}`,
      kind,
      status: 'open',
      issueDate: on,
      dueDate: on,
      periodStart: on,
      periodEnd: new Date(on.getTime() + 30 * 86_400_000),
      subtotalCents: amountCents,
      taxCents: 0,
      totalCents: amountCents,
      amountPaidCents: 0,
      lineItems: {
        create: {
          type: kind,
          description: kind === 'fee' ? 'Late fee (step 1) — 5+ days past due' : 'Rent, September',
          quantity: 1,
          unitAmountCents: amountCents,
          amountCents,
        },
      },
    },
    select: { id: true, lineItems: { select: { id: true } } },
  })
  await prisma.ledgerEntry.create({
    data: { facilityId, leaseId, type: 'charge', amountCents, description: `Invoice ${invoice.id}`, occurredAt: on, invoiceId: invoice.id },
  })
  return { invoiceId: invoice.id, lineId: invoice.lineItems[0].id }
}

describeDb('ask about one charge', () => {
  beforeAll(async () => {
    const facility = await prisma.facility.create({
      data: {
        name: `Charge Q ${suffix}`,
        slug: `charge-q-${suffix}`,
        addressLine1: '1 Storage Way',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704',
        timezone: 'America/Chicago',
        phone: '(512) 555-0100',
      },
    })
    facilityId = facility.id
    const renter = await prisma.tenant.create({
      data: { email: `cq-${suffix}@example.com`, firstName: 'Ada', lastName: 'Renter' },
    })
    tenantId = renter.id
    const staffUser = await prisma.staffUser.create({
      data: { email: `cq-staff-${suffix}@example.com`, firstName: 'Mo', lastName: 'Manager' },
    })
    staffId = staffUser.id
    const unitType = await prisma.unitType.create({
      data: { facilityId, name: `10x10 ${suffix}`, widthFt: 10, lengthFt: 10 },
    })
    const unit = await prisma.unit.create({ data: { facilityId, unitTypeId: unitType.id, number: `CQ-${suffix}` } })
    const lease = await prisma.lease.create({
      data: {
        facilityId,
        tenantId,
        unitId: unit.id,
        status: 'active',
        startDate: new Date('2026-07-01T00:00:00Z'),
        billingDay: 1,
        monthlyRateCents: 12_900,
      },
    })
    leaseId = lease.id
  })

  it('creates one task on the line, refuses a second ask while it is open', async () => {
    const { lineId } = await invoiceLine('rent', 12_900)

    const first = await askAboutCharge(tenant(), lineId, 'Why is this higher than last month?')
    expect(first.ok).toBe(true)

    const tasks = await prisma.task.findMany({ where: { type: 'charge_question', entityId: lineId } })
    expect(tasks).toHaveLength(1)
    expect(tasks[0].entityType).toBe('InvoiceLineItem')
    // D-83: the words live in the event the task points at.
    const event = await prisma.domainEvent.findUniqueOrThrow({ where: { id: tasks[0].sourceEventId! } })
    expect(event.name).toBe('charge.question_asked')
    expect((event.payload as { question: string }).question).toBe('Why is this higher than last month?')

    const second = await askAboutCharge(tenant(), lineId, 'Hello again')
    expect(second).toEqual({ ok: false, reason: 'already_open' })

    const [state] = await chargeQuestionsFor(leaseId)
    expect(state).toMatchObject({ lineItemId: lineId, status: 'open' })
  })

  it('refuses a line on somebody else’s lease as not found', async () => {
    const { lineId } = await invoiceLine('rent', 100)
    const other: Extract<Actor, { kind: 'tenant' }> = { kind: 'tenant', tenantId: 'nobody' }
    expect(await askAboutCharge(other, lineId, 'Mine?')).toEqual({ ok: false, reason: 'not_found' })
    expect(await askAboutCharge(tenant(), lineId, '   ')).toEqual({ ok: false, reason: 'empty' })
  })

  it('a waiver posts the credit, completes the task as waived and emits the answer', async () => {
    const { invoiceId, lineId } = await invoiceLine('fee', 2_000)
    await askAboutCharge(tenant(), lineId, 'I paid on the 3rd.')

    const waived = await waiveFeeInvoice(staff(), invoiceId, { reasonCode: 'customer_goodwill' })
    expect(waived).toEqual({ ok: true, amountCents: 2_000 })

    const credit = await prisma.ledgerEntry.findFirstOrThrow({ where: { invoiceId, type: 'credit' } })
    expect(credit.amountCents).toBe(-2_000)

    const task = await prisma.task.findFirstOrThrow({ where: { type: 'charge_question', entityId: lineId } })
    expect(task.status).toBe('completed')
    expect(task.proof).toMatchObject({ outcome: 'waived' })

    const line = (await chargeQuestionsFor(leaseId)).find((q) => q.lineItemId === lineId)
    expect(line?.status).toBe('waived')

    const answer = await prisma.domainEvent.findFirstOrThrow({
      where: { name: 'charge_question.answered', entityId: leaseId, payload: { path: ['lineItemId'], equals: lineId } },
    })
    expect(answer.payload).toMatchObject({ outcome: 'waived', amountCents: 2_000 })
  })

  it('a note keeps the charge and sends the note as the answer', async () => {
    const { lineId } = await invoiceLine('rent', 12_900)
    const asked = await askAboutCharge(tenant(), lineId, 'Is the tax right?')
    if (!asked.ok) throw new Error(asked.reason)

    const done = await completeTask(staff(), asked.taskId, { note: 'Travis County raised the rate in August.' })
    expect(done).toEqual({ ok: true })

    const line = (await chargeQuestionsFor(leaseId)).find((q) => q.lineItemId === lineId)
    expect(line).toMatchObject({ status: 'kept', note: 'Travis County raised the rate in August.' })

    const answer = await prisma.domainEvent.findFirstOrThrow({
      where: { name: 'charge_question.answered', entityId: leaseId, payload: { path: ['lineItemId'], equals: lineId } },
    })
    expect(answer.payload).toMatchObject({ outcome: 'kept', note: 'Travis County raised the rate in August.' })

    // The one message (D-78): the template renders from the payload, once.
    vi.spyOn(provider, 'selectProvider').mockImplementation(() => ({
      name: 'test',
      async sendEmail() {
        return { ok: true, providerMessageId: 'test_cq' }
      },
    }))
    vi.spyOn(provider, 'commsEnabled').mockReturnValue(true)
    vi.spyOn(provider, 'effectiveRecipient').mockImplementation((address: string) => address)
    await processCommsEvent(answer)
    await processCommsEvent(answer)
    const messages = await prisma.message.findMany({ where: { eventId: answer.id } })
    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({ templateKey: 'charge_question_answered', status: 'sent', error: null })
    expect(messages[0].bodySnapshot).toContain('Rent, September — $129.00')
    expect(messages[0].bodySnapshot).toContain('Travis County raised the rate in August.')
  })
})
