import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { prisma } from '../packages/db'
import { processCommsEvent } from '../apps/web/lib/comms/service'
import * as provider from '../apps/web/lib/comms/provider'
import { checkPayLink } from '../apps/web/lib/portal/pay-links'
import {
  nominatePayer,
  nominatedPayerFor,
  removeNominatedPayer,
  stopNominatedPayer,
} from '../apps/web/lib/portal/nominated-payer'
import { verifyUnsubscribeToken } from '../apps/web/lib/comms/unsubscribe-token'

// B-437 (PRD 01 US-703, "someone else can pay"). A tenant's nominated payer is
// sent the bill reminder with a working pay link and nothing else, and stops
// being sent it when the tenant removes them or they stop it themselves.
// Against the real seeded catalog, as `comms-billing-account-db` is: the line
// between "the bill" and "everything else" is drawn by event name.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)
const DAY = 86_400_000
const PAYER_EMAIL = `payer-sam-${suffix}@example.com`

let facilityId = ''
let tenantId = ''
let leaseId = ''
let invoiceId = ''

const sent: { to: string; text: string }[] = []

async function dispatch(name: string, entityType: string, entityId: string, payload: object = {}) {
  const event = await prisma.domainEvent.create({
    data: { name, entityType, entityId, facilityId, payload },
  })
  sent.length = 0
  await processCommsEvent(event)
  return prisma.message.findMany({ where: { eventId: event.id } })
}

const toPayer = <T extends { toAddress: string }>(messages: T[]) =>
  messages.filter((message) => message.toAddress === PAYER_EMAIL)

function nominate() {
  return nominatePayer(tenantId, {
    name: 'Sam Daughter',
    email: ` ${PAYER_EMAIL.toUpperCase()} `,
    phone: '',
    consent: true,
    locale: 'en',
  })
}

describeDb('nominated payer (B-437)', () => {
  beforeAll(async () => {
    vi.spyOn(provider, 'selectProvider').mockImplementation(() => ({
      name: 'test',
      async sendEmail(email) {
        sent.push({ to: email.to, text: email.text })
        return { ok: true, providerMessageId: `test_${randomUUID()}` }
      },
    }))
    vi.spyOn(provider, 'commsEnabled').mockReturnValue(true)
    vi.spyOn(provider, 'effectiveRecipient').mockImplementation((address: string) => address)

    const facility = await prisma.facility.create({
      data: {
        name: `Nominated Payer ${suffix}`,
        slug: `nominated-payer-${suffix}`,
        addressLine1: '1 Storage Way',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704',
        timezone: 'America/Chicago',
        phone: '512-555-0100',
      },
    })
    facilityId = facility.id
    const tenant = await prisma.tenant.create({
      data: { email: `payer-parent-${suffix}@example.com`, firstName: 'Ada', lastName: 'Parent' },
    })
    tenantId = tenant.id
    const unitType = await prisma.unitType.create({
      data: { facilityId, name: `10x10 ${suffix}`, widthFt: 10, lengthFt: 10 },
    })
    const unit = await prisma.unit.create({ data: { facilityId, unitTypeId: unitType.id, number: `NP-1-${suffix}` } })
    const lease = await prisma.lease.create({
      data: {
        facilityId,
        tenantId,
        unitId: unit.id,
        status: 'active',
        startDate: new Date('2026-06-01T00:00:00Z'),
        billingDay: 1,
        monthlyRateCents: 12_900,
      },
    })
    leaseId = lease.id
    const dueDate = new Date(Date.now() + 3 * DAY)
    const invoice = await prisma.invoice.create({
      data: {
        facilityId,
        leaseId,
        number: `NP1-${suffix}`,
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
    invoiceId = invoice.id
  })

  afterAll(async () => {
    if (!hasDatabase) return
    vi.restoreAllMocks()
    await prisma.message.deleteMany({ where: { facilityId } })
    await prisma.payLink.deleteMany({ where: { lease: { facilityId } } })
    await prisma.nominatedPayer.deleteMany({ where: { tenantId } })
    await prisma.domainEvent.deleteMany({ where: { facilityId } })
    await prisma.invoice.deleteMany({ where: { facilityId } })
    await prisma.$disconnect()
  })

  it('refuses a nomination with no consent, no name or no usable email, and writes nothing', async () => {
    const result = await nominatePayer(tenantId, {
      name: ' ',
      email: 'sam-at-example',
      phone: '555',
      consent: false,
      locale: 'en',
    })
    expect(result).toEqual({
      ok: false,
      problems: {
        name: 'payer.problem.name',
        email: 'payer.problem.email',
        phone: 'payer.problem.phone',
        consent: 'payer.problem.consent',
      },
    })
    expect(await nominatedPayerFor(tenantId)).toBeNull()
  })

  it('sends the tenant the bill alone while nobody is nominated', async () => {
    const messages = await dispatch('invoice.due_soon', 'Invoice', invoiceId)
    expect(messages).toHaveLength(1)
    expect(messages[0].recipientTenantId).toBe(tenantId)
  })

  it('records the consent the tenant gave, by version and language', async () => {
    const result = await nominate()
    expect(result.ok).toBe(true)
    const row = await prisma.nominatedPayer.findFirstOrThrow({ where: { tenantId, removedAt: null } })
    expect(row).toMatchObject({ email: PAYER_EMAIL, disclosureVersion: 'v1-draft', locale: 'en', phone: null })
  })

  it('sends the payer ONE reminder with a pay link that works, and the tenant theirs', async () => {
    const messages = await dispatch('invoice.due_soon', 'Invoice', invoiceId)
    expect(messages).toHaveLength(2)

    const [mine] = toPayer(messages)
    expect(toPayer(messages)).toHaveLength(1)
    expect(mine.status).toBe('sent')
    // Not a tenant, so not on anybody's tenant timeline or preferences.
    expect(mine.recipientTenantId).toBeNull()
    expect(mine.bodySnapshot).toContain('Hi Sam Daughter,')

    const email = sent.find((message) => message.to === PAYER_EMAIL)!
    expect(email.text).toContain('because Ada Parent asked')
    const token = /\/pay\/([\w-]+)/.exec(email.text)?.[1] ?? ''
    expect(await checkPayLink(token)).toMatchObject({ ok: true, tenantId, leaseId, forPayer: true })

    // The tenant's own link from the same event is a different one and is the
    // tenant's: minting the payer's must not have revoked it.
    const theirs = sent.find((message) => message.to !== PAYER_EMAIL)!
    const tenantToken = /\/pay\/([\w-]+)/.exec(theirs.text)?.[1] ?? ''
    expect(tenantToken).not.toBe(token)
    expect(await checkPayLink(tenantToken)).toMatchObject({ ok: true, forPayer: false })
    expect(theirs.text).not.toContain('Stop these emails')
  })

  it('sends the payer nothing that is not the bill', async () => {
    for (const [name, payload] of [
      ['lease.activated', {}],
      ['access.suspended', {}],
      ['notice.generated', { noticeId: `n-${suffix}`, type: 'lien', claimTotalCents: 12_900, deadlineDate: '2026-12-01' }],
    ] as const) {
      const messages = await dispatch(name, 'Lease', leaseId, payload)
      expect(toPayer(messages), name).toEqual([])
      expect(sent.filter((message) => message.to === PAYER_EMAIL), name).toEqual([])
    }
  })

  it("stops on the payer's own link, kills their pay link, and tells the tenant's screen", async () => {
    await dispatch('invoice.due_today', 'Invoice', invoiceId)
    const email = sent.find((message) => message.to === PAYER_EMAIL)!
    const payToken = /\/pay\/([\w-]+)/.exec(email.text)?.[1] ?? ''
    const stopToken = /\/unsubscribe\/(\S+)/.exec(email.text)?.[1] ?? ''
    const verdict = verifyUnsubscribeToken(stopToken)
    const payer = await nominatedPayerFor(tenantId)
    expect(verdict).toMatchObject({ valid: true, address: PAYER_EMAIL, payerId: payer!.id })

    await stopNominatedPayer(payer!.id)

    expect(await checkPayLink(payToken)).toEqual({ ok: false })
    expect((await nominatedPayerFor(tenantId))?.stoppedAt).toBeInstanceOf(Date)
    // A stop is not an unsubscribe: the address is on no suppression list.
    expect(await prisma.suppression.findFirst({ where: { address: PAYER_EMAIL } })).toBeNull()
    expect(toPayer(await dispatch('invoice.due_soon', 'Invoice', invoiceId))).toEqual([])
  })

  it('stops when the tenant removes the payer, and a new nomination starts again', async () => {
    // Remove the stopped payer, name them again: a fresh row, sent to again.
    expect(await removeNominatedPayer(tenantId)).toBe(true)
    await nominate()
    const before = await dispatch('invoice.due_today', 'Invoice', invoiceId)
    // `invoice.due_today` already settled for the first payer row; this is a new
    // recipient key, so it is a new message.
    expect(toPayer(before)).toHaveLength(1)
    const payToken = /\/pay\/([\w-]+)/.exec(sent.find((message) => message.to === PAYER_EMAIL)!.text)?.[1] ?? ''

    expect(await removeNominatedPayer(tenantId)).toBe(true)
    expect(await removeNominatedPayer(tenantId)).toBe(false)

    expect(await nominatedPayerFor(tenantId)).toBeNull()
    expect(await checkPayLink(payToken)).toEqual({ ok: false })
    const after = await dispatch('invoice.due_soon', 'Invoice', invoiceId)
    expect(toPayer(after)).toEqual([])
    expect(after).toHaveLength(1)
    // Both rows are kept: the consent each was named under stays on record.
    expect(await prisma.nominatedPayer.count({ where: { tenantId } })).toBe(2)
  })
})
