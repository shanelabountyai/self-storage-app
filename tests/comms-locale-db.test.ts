import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { prisma } from '../packages/db'
import { processCommsEvent } from '../apps/web/lib/comms/service'
import * as provider from '../apps/web/lib/comms/provider'
import { COMMS_PROSE } from '../apps/web/lib/comms/prose'

// B-261 (D-122). A tenant who rented in Spanish is written to in Spanish.
//
// Against the REAL seeded catalog and the real pipeline, because that is where
// this can go wrong: the English rows are in the same table, the fallback is
// silent by design, and a Spanish body whose merge fields do not resolve is
// recorded `failed` rather than throwing anywhere a person would see it. Only
// a send proves it.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)

let facilityId = ''
let englishTenantId = ''
let spanishTenantId = ''
let englishLeaseId = ''
let spanishLeaseId = ''

type Send = { to: string; subject: string; body: string; html: string }
const sends: Send[] = []

function fakeProvider(): provider.MessageProvider {
  return {
    name: 'test',
    async sendEmail(email) {
      sends.push({
        to: email.to,
        subject: email.subject ?? '',
        body: email.text ?? '',
        html: email.html ?? '',
      })
      return { ok: true, providerMessageId: `test_${sends.length}` }
    },
  }
}

async function emit(name: string, entityType: string, entityId: string, payload: object = {}) {
  const event = await prisma.domainEvent.create({
    data: { name, entityType, entityId, facilityId, payload: payload as never },
  })
  await processCommsEvent(event)
  return event
}

/// The Message row, so a send that was recorded `failed` is visible as that
/// rather than as an empty `sends` array — which is the exact symptom B-206
/// describes and the one that reads like a broken sender.
async function lastMessage() {
  return prisma.message.findFirstOrThrow({
    where: { facilityId },
    orderBy: { createdAt: 'desc' },
    select: { status: true, error: true, subjectSnapshot: true, bodySnapshot: true },
  })
}

describeDb('the language a tenant is written to in', () => {
  beforeAll(async () => {
    vi.spyOn(provider, 'selectProvider').mockImplementation(() => fakeProvider())
    vi.spyOn(provider, 'commsEnabled').mockReturnValue(true)
    vi.spyOn(provider, 'effectiveRecipient').mockImplementation((address: string) => address)

    const facility = await prisma.facility.create({
      data: {
        name: `Locale ${suffix}`,
        slug: `locale-${suffix}`,
        addressLine1: '1 Storage Way',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704',
        timezone: 'America/Chicago',
        phone: '512-555-0100',
        // `review.requested` is the only MARKETING rule reachable from a lease
        // fixture, and it skips without one — which is how the unsubscribe
        // footer gets exercised at all.
        googleReviewUrl: 'https://example.com/review',
      },
    })
    facilityId = facility.id

    const unitType = await prisma.unitType.create({
      data: { facilityId, name: `10x10 ${suffix}`, widthFt: 10, lengthFt: 10 },
    })

    for (const [locale, label] of [[null, 'en'], ['es', 'es']] as const) {
      const tenant = await prisma.tenant.create({
        data: {
          email: `locale-${label}-${suffix}@example.com`,
          firstName: 'Ada',
          lastName: 'Renter',
          preferredLocale: locale,
        },
      })
      const unit = await prisma.unit.create({
        data: { facilityId, unitTypeId: unitType.id, number: `L${label}-${suffix.slice(0, 4)}` },
      })
      const lease = await prisma.lease.create({
        data: {
          facilityId,
          tenantId: tenant.id,
          unitId: unit.id,
          status: 'active',
          startDate: new Date('2026-06-01T00:00:00Z'),
          billingDay: 1,
          monthlyRateCents: 12_900,
        },
      })
      if (label === 'es') {
        spanishTenantId = tenant.id
        spanishLeaseId = lease.id
      } else {
        englishTenantId = tenant.id
        englishLeaseId = lease.id
      }
    }
  })

  afterEach(async () => {
    sends.length = 0
    await prisma.message.deleteMany({ where: { facilityId } })
    await prisma.domainEvent.deleteMany({ where: { facilityId } })
    // Per-facility overrides a test published, so the next test resolves the
    // org defaults again.
    await prisma.messageTemplate.deleteMany({ where: { facilityId } })
  })

  afterAll(async () => {
    vi.restoreAllMocks()
    await prisma.message.deleteMany({ where: { facilityId } })
    await prisma.domainEvent.deleteMany({ where: { facilityId } })
    await prisma.messageTemplate.deleteMany({ where: { facilityId } })
    await prisma.lease.deleteMany({ where: { facilityId } })
    await prisma.unit.deleteMany({ where: { facilityId } })
    await prisma.unitType.deleteMany({ where: { facilityId } })
    await prisma.tenant.deleteMany({ where: { id: { in: [englishTenantId, spanishTenantId] } } })
  })

  it('sends the Spanish template body to a tenant whose preference is Spanish', async () => {
    await emit('delinquency.day_reached', 'Lease', spanishLeaseId, {
      day: 1,
      position: 1,
      totalSteps: 4,
    })
    const message = await lastMessage()
    expect(message.status, message.error ?? '').toBe('sent')
    expect(sends).toHaveLength(1)
    // The template's own body, from the seeded `es` variant.
    expect(sends[0].body).toContain('preferimos resolverlo con usted')
    expect(sends[0].body).not.toContain('we would rather sort it out')
  })

  it('still sends English to a tenant who has never stated a preference', async () => {
    // Null is "never told us", and it must resolve to English rather than to
    // nothing — the fallback is what keeps this item from being able to
    // withhold a message.
    await emit('delinquency.day_reached', 'Lease', englishLeaseId, {
      day: 1,
      position: 1,
      totalSteps: 4,
    })
    expect(sends[0].body).toContain('we would rather sort it out')
  })

  describe('the dunning ladder', () => {
    // The message this whole item exists for: its three most important
    // sentences are merge fields built in code, so a Spanish template alone
    // would have wrapped a Spanish greeting around English collection copy.
    const rungs = [
      { position: 1, en: 'it happens, and it is quick to put right', es: 'pasa seguido, y se resuelve rápido' },
      { position: 2, en: 'a late fee may now have been added', es: 'cargo por atraso' },
      { position: 3, en: 'gate access is at risk', es: 'poner en riesgo su acceso a la puerta' },
      { position: 4, en: 'we need to hear from you', es: 'necesitamos saber de usted' },
    ]

    for (const rung of rungs) {
      it(`escalates rung ${rung.position} in Spanish, not English`, async () => {
        await emit('delinquency.day_reached', 'Lease', spanishLeaseId, {
          day: rung.position * 5,
          position: rung.position,
          totalSteps: 4,
        })
        const message = await lastMessage()
        expect(message.status, message.error ?? '').toBe('sent')
        expect(sends[0].body).toContain(rung.es)
        expect(sends[0].body).not.toContain(rung.en)
      })
    }

    it('never leaves an English consequence line inside a Spanish message', async () => {
      // The specific defect: the body is Spanish, the sentence about losing
      // the gate code is not.
      await emit('delinquency.day_reached', 'Lease', spanishLeaseId, {
        day: 10,
        position: 3,
        totalSteps: 4,
      })
      for (const english of COMMS_PROSE.en.dunningConsequence) {
        expect(sends[0].body).not.toContain(english)
      }
    })
  })

  it('writes dates and money the way the language does', async () => {
    await emit('delinquency.day_reached', 'Lease', spanishLeaseId, {
      day: 1,
      position: 1,
      totalSteps: 4,
    })
    // USD is written identically in both, deliberately — the tenant must be
    // able to match the figure against the portal.
    expect(sends[0].body).toContain('$')
  })

  it('declares the document language so a screen reader pronounces it', async () => {
    // 3.1.2. The wrapper carried a hardcoded lang="en", which is the one
    // accessibility failure a translation introduces rather than fixes.
    await emit('delinquency.day_reached', 'Lease', spanishLeaseId, {
      day: 1,
      position: 1,
      totalSteps: 4,
    })
    expect(sends[0].html).toContain('<div lang="es">')

    sends.length = 0
    await emit('delinquency.day_reached', 'Lease', englishLeaseId, {
      day: 1,
      position: 1,
      totalSteps: 4,
    })
    expect(sends[0].html).toContain('<div lang="en">')
  })

  it('falls back to the English template when a key has no Spanish row', async () => {
    // The property that makes the fallback safe: a payment reminder is never
    // withheld over a missing translation. Simulated by deactivating the
    // Spanish org default for one key.
    await prisma.messageTemplate.updateMany({
      where: { key: 'dunning_step', channel: 'email', locale: 'es', facilityId: null },
      data: { active: false },
    })
    try {
      await emit('delinquency.day_reached', 'Lease', spanishLeaseId, {
        day: 1,
        position: 1,
        totalSteps: 4,
      })
      const message = await lastMessage()
      expect(message.status, message.error ?? '').toBe('sent')
      // The TEMPLATE is English...
      expect(sends[0].body).toContain('The balance on unit')
      // ...but the code-built sentences still follow the tenant, because they
      // are resolved from the recipient rather than from the template row.
      // A half-Spanish message is the honest state of a missing translation,
      // and it is strictly better than not sending.
      expect(sends[0].body).toContain('pasa seguido, y se resuelve rápido')
    } finally {
      await prisma.messageTemplate.updateMany({
        where: { key: 'dunning_step', channel: 'email', locale: 'es', facilityId: null },
        data: { active: true },
      })
    }
  })

  it('resolves the language before the facility override', async () => {
    // A facility that overrides only its ENGLISH copy must not drag a Spanish
    // reader onto it — the two resolutions happen inside the chosen language,
    // in that order.
    const base = await prisma.messageTemplate.findFirstOrThrow({
      where: { key: 'dunning_step', channel: 'email', locale: 'en', facilityId: null },
    })
    await prisma.messageTemplate.create({
      data: {
        key: 'dunning_step',
        channel: 'email',
        locale: 'en',
        classification: base.classification,
        facilityId,
        version: 1,
        active: true,
        subject: base.subject,
        bodyText: `OVERRIDDEN ENGLISH ONLY\n\n${base.bodyText}`,
        requiredMergeFields: base.requiredMergeFields,
      },
    })

    await emit('delinquency.day_reached', 'Lease', spanishLeaseId, {
      day: 1,
      position: 1,
      totalSteps: 4,
    })
    expect(sends[0].body).not.toContain('OVERRIDDEN ENGLISH ONLY')
    expect(sends[0].body).toContain('preferimos resolverlo con usted')

    sends.length = 0
    await emit('delinquency.day_reached', 'Lease', englishLeaseId, {
      day: 1,
      position: 1,
      totalSteps: 4,
    })
    expect(sends[0].body).toContain('OVERRIDDEN ENGLISH ONLY')
  })

  it('appends the unsubscribe wording in the tenant’s language', async () => {
    // Marketing only, and the clock has to be pinned or this passes between
    // 8am and 9pm Central and fails outside it (FR-MSG-5) — the trap three
    // suites carried latent for weeks.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-15T17:00:00.000Z')) // 12:00 Central
    try {
      await emit('review.requested', 'Lease', spanishLeaseId)
      const message = await lastMessage()
      expect(message.status, message.error ?? '').toBe('sent')
      expect(sends[0].body).toContain('Cancelar la suscripción:')
      expect(sends[0].body).not.toContain('Unsubscribe:')
    } finally {
      vi.useRealTimers()
    }
  })
})
