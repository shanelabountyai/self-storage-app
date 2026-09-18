import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma, type MessageStatus } from '../packages/db'
import { planAccountAccessBackfill } from '../apps/web/scripts/backfill-account-access.mts'
import { accountAccessKey } from '../apps/web/lib/auth/flows'

// B-301. The backfill sends real mail to real people, so what is checked here
// is who it decides to email: once per membership, never somebody B-287 already
// told, never somebody with no address.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)

let facilityId = ''
let accountId = ''
const accountName = `Acme Holdings ${suffix}`

describeDb('account-access backfill', () => {
  beforeAll(async () => {
    const facility = await prisma.facility.create({
      data: {
        name: 'Access Backfill Test',
        slug: `access-bf-${suffix}`,
        addressLine1: '1 Storage Way',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704',
        timezone: 'America/Chicago',
      },
    })
    facilityId = facility.id
    const payer = await tenant('payer')
    accountId = (
      await prisma.billingAccount.create({
        data: { facilityId, name: accountName, payerTenantId: payer.id },
      })
    ).id
  })

  afterAll(async () => {
    if (!hasDatabase) return
    await prisma.message.deleteMany({ where: { toAddress: { contains: suffix } } })
    await prisma.billingAccount.deleteMany({ where: { facilityId } })
    await prisma.tenant.deleteMany({ where: { firstName: { endsWith: suffix } } })
    await prisma.facility.deleteMany({ where: { id: facilityId } })
    await prisma.$disconnect()
  })

  async function tenant(label: string, email: string | null = `ab-${label}-${suffix}@example.com`) {
    return prisma.tenant.create({ data: { email, firstName: `${label}-${suffix}`, lastName: 'Member' } })
  }

  async function member(label: string, email?: string | null) {
    const t = await tenant(label, email)
    const m = await prisma.billingAccountMember.create({ data: { accountId, tenantId: t.id } })
    return { tenantId: t.id, memberId: m.id }
  }

  async function message(tenantId: string, key: string, body: string, status: MessageStatus) {
    await prisma.message.create({
      data: {
        idempotencyKey: key,
        eventId: 'auth:password_reset',
        ruleId: 'direct',
        templateKey: 'auth_password_reset',
        templateVersion: 1,
        classification: 'transactional',
        channel: 'email',
        recipientTenantId: tenantId,
        toAddress: `ab-${suffix}@example.com`,
        subjectSnapshot: 'Set your password',
        bodySnapshot: body,
        status,
      },
    })
  }

  it('emails each untold member once, and says why it skips the rest', async () => {
    const fresh = await member('fresh')
    const noEmail = await member('noemail', null)

    const keyed = await member('keyed')
    await message(keyed.tenantId, accountAccessKey(keyed.memberId), accountName, 'sent')

    const keyedFailed = await member('failed')
    await message(keyedFailed.tenantId, accountAccessKey(keyedFailed.memberId), accountName, 'failed')

    // Told by B-287's own send, under a random key.
    const byB287 = await member('b287')
    await message(byB287.tenantId, `auth:password_reset:${randomUUID()}`, `You were added to ${accountName}.`, 'sent')

    // An ordinary reset names no account, so it told them nothing.
    const plainReset = await member('reset')
    await message(plainReset.tenantId, `auth:password_reset:${randomUUID()}`, 'Reset your password.', 'sent')

    const plans = new Map(
      (await planAccountAccessBackfill())
        .filter((plan) => plan.accountName === accountName)
        .map((plan) => [plan.memberId, plan.skip]),
    )

    expect(plans.get(fresh.memberId)).toBeNull()
    expect(plans.get(plainReset.memberId)).toBeNull()
    expect(plans.get(noEmail.memberId)).toBe('no_email')
    expect(plans.get(keyed.memberId)).toBe('already_told')
    expect(plans.get(byB287.memberId)).toBe('already_told')
    expect(plans.get(keyedFailed.memberId)).toBe('earlier_attempt_failed')
    expect(plans.size).toBe(6)
  })
})
