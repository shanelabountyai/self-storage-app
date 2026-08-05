import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import { recordConsent } from '../packages/core/consent'

// D-8 / B-032. The shared consent primitive: one function, for every module
// that needs to write a Consent row.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)

describeDb('recordConsent', () => {
  let tenantId = ''

  afterAll(async () => {
    if (!hasDatabase) return
    await prisma.consent.deleteMany({ where: { tenantId } })
    await prisma.tenant.deleteMany({ where: { id: tenantId } })
    await prisma.$disconnect()
  })

  it('writes a full record: channel, state, source, disclosure version, IP', async () => {
    const tenant = await prisma.tenant.create({
      data: { email: `consent-record-${suffix}@example.com`, firstName: 'Ada', lastName: 'Renter' },
    })
    tenantId = tenant.id

    const consent = await recordConsent({
      tenantId,
      channel: 'account_sms',
      state: 'granted',
      source: 'checkout_step_1',
      disclosureVersion: 'v1',
      ipAddress: '203.0.113.5',
    })

    expect(consent.tenantId).toBe(tenantId)
    expect(consent.channel).toBe('account_sms')
    expect(consent.state).toBe('granted')
    expect(consent.source).toBe('checkout_step_1')
    expect(consent.disclosureVersion).toBe('v1')
    expect(consent.ipAddress).toBe('203.0.113.5')
    expect(consent.capturedAt).toBeInstanceOf(Date)
  })

  it('appends rather than overwriting — a later state is a new row, and the history survives', async () => {
    await recordConsent({ tenantId, channel: 'account_sms', state: 'revoked', source: 'portal_preferences' })

    const rows = await prisma.consent.findMany({
      where: { tenantId, channel: 'account_sms' },
      orderBy: { capturedAt: 'asc' },
    })
    expect(rows).toHaveLength(2)
    expect(rows[0].state).toBe('granted')
    expect(rows[1].state).toBe('revoked')
  })

  it('refuses to write an orphaned record with neither a tenant nor a lead', async () => {
    await expect(
      recordConsent({ channel: 'account_sms', state: 'granted', source: 'test' }),
    ).rejects.toThrow(/tenantId or a leadId/)
  })

  it('accepts a lead instead of a tenant', async () => {
    const lead = await prisma.lead.create({
      data: { email: `consent-lead-${suffix}@example.com`, source: 'website' },
    })

    const consent = await recordConsent({
      leadId: lead.id,
      channel: 'marketing_email',
      state: 'granted',
      source: 'lead_form',
    })
    expect(consent.leadId).toBe(lead.id)
    expect(consent.tenantId).toBeNull()

    await prisma.consent.deleteMany({ where: { leadId: lead.id } })
    await prisma.lead.delete({ where: { id: lead.id } })
  })
})
