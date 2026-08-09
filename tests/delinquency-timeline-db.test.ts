import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import {
  activeTimeline,
  exampleTimeline,
  saveTimeline,
  timelinesFor,
} from '../apps/web/lib/admin/delinquency-timeline'
import type { TimelineStep } from '../packages/core/delinquency'
import type { Actor } from '../apps/web/lib/rbac/actor'

// B-056 / PRD 02 §4.6 US-25, US-29, against real rows.
//
// The property worth a database is versioning: US-25's AC says "the lease
// records which timeline version governed it", which is only meaningful if a
// version survives being superseded.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)

let facilityId = ''
let staffId = ''
let leaseId = ''

function actor(permissions: string[] = ['facility:settings']): Actor {
  return {
    kind: 'staff',
    staffUserId: staffId,
    assignments: [
      {
        facilityId,
        roleKey: 'manager',
        rank: 20,
        permissions: new Set(permissions),
        limits: { maxFeeWaiverCents: 0, maxRefundCents: 0, maxCreditCents: 0 },
      },
    ],
  }
}

const step = (overrides: Partial<TimelineStep> = {}): TimelineStep => ({
  dayOffset: 15,
  label: 'Pre-lien notice',
  automatedActions: [],
  noticeTemplateKey: null,
  deliveryMethods: [],
  staffTaskLabel: null,
  requiredProofFields: [],
  ...overrides,
})

describeDb('the delinquency timeline', () => {
  beforeAll(async () => {
    const facility = await prisma.facility.create({
      data: {
        name: `Timeline ${suffix}`,
        slug: `timeline-${suffix}`,
        addressLine1: '1 Storage Way',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704',
        timezone: 'America/Chicago',
      },
    })
    facilityId = facility.id

    const staff = await prisma.staffUser.create({
      data: { email: `timeline-staff-${suffix}@example.com`, firstName: 'Mo', lastName: 'Manager' },
    })
    staffId = staff.id

    const tenant = await prisma.tenant.create({
      data: { email: `timeline-${suffix}@example.com`, firstName: 'Ada', lastName: 'Renter' },
    })
    const unitType = await prisma.unitType.create({
      data: { facilityId, name: `10x10 ${suffix}`, widthFt: 10, lengthFt: 10 },
    })
    const unit = await prisma.unit.create({
      data: { facilityId, unitTypeId: unitType.id, number: `T-${suffix.slice(0, 4)}` },
    })
    const lease = await prisma.lease.create({
      data: {
        facilityId,
        tenantId: tenant.id,
        unitId: unit.id,
        status: 'active',
        startDate: new Date('2026-07-01T00:00:00Z'),
        billingDay: 1,
        monthlyRateCents: 12_900,
      },
    })
    leaseId = lease.id
  })

  beforeEach(async () => {
    await prisma.lease.update({ where: { id: leaseId }, data: { delinquencyTimelineId: null } })
    await prisma.delinquencyTimeline.deleteMany({ where: { facilityId } })
  })

  afterAll(async () => {
    if (!hasDatabase) return
    await prisma.lease.update({ where: { id: leaseId }, data: { delinquencyTimelineId: null } })
    await prisma.delinquencyTimeline.deleteMany({ where: { facilityId } })
    await prisma.$disconnect()
  })

  it('starts with nothing configured, and says so rather than defaulting', async () => {
    // The most important behaviour here. Falling back to the example would run
    // a lien pipeline nobody configured, from a table in a PRD, against a real
    // tenant.
    expect(await activeTimeline(facilityId)).toBeNull()
    expect(await timelinesFor(actor(), facilityId)).toEqual([])
  })

  it('saves a version and makes it active', async () => {
    const result = await saveTimeline(actor(), facilityId, {
      label: 'First pass',
      qualifyingAmount: 'full_balance',
      steps: [step({ dayOffset: 1, label: 'Late', automatedActions: ['assess_late_fee'] })],
    })
    expect(result).toEqual({ ok: true, version: 1 })

    const active = await activeTimeline(facilityId)
    expect(active?.version).toBe(1)
    expect(active?.label).toBe('First pass')
    expect(active?.createdByName).toContain('Mo')
  })

  it('supersedes rather than edits — the old version survives intact', async () => {
    await saveTimeline(actor(), facilityId, {
      label: 'Before the review',
      qualifyingAmount: 'full_balance',
      steps: [step({ dayOffset: 15 })],
    })
    await saveTimeline(actor(), facilityId, {
      label: 'After the review',
      qualifyingAmount: 'rent_only',
      steps: [step({ dayOffset: 30 })],
    })

    const versions = await timelinesFor(actor(), facilityId)
    expect(versions).toHaveLength(2)
    expect(versions[0]).toMatchObject({ version: 2, active: true, label: 'After the review' })
    // A lien file whose timeline has been rewritten since cannot be defended,
    // so v1 keeps its own day and its own qualifying rule.
    expect(versions[1]).toMatchObject({ version: 1, active: false, qualifyingAmount: 'full_balance' })
    expect(versions[1].steps[0].dayOffset).toBe(15)
  })

  it('keeps exactly one version active', async () => {
    for (const label of ['one', 'two', 'three']) {
      await saveTimeline(actor(), facilityId, {
        label,
        qualifyingAmount: 'full_balance',
        steps: [step()],
      })
    }
    const versions = await timelinesFor(actor(), facilityId)
    expect(versions.filter((one) => one.active)).toHaveLength(1)
    expect(versions.find((one) => one.active)?.label).toBe('three')
  })

  it('records which version governed a lease, and reports it', async () => {
    // US-25's AC. B-057 does the pinning; this proves the link survives being
    // superseded, which is the whole reason it is a foreign key.
    await saveTimeline(actor(), facilityId, {
      label: 'Governing',
      qualifyingAmount: 'full_balance',
      steps: [step()],
    })
    const governing = await activeTimeline(facilityId)
    await prisma.lease.update({
      where: { id: leaseId },
      data: { delinquencyTimelineId: governing!.id },
    })

    await saveTimeline(actor(), facilityId, {
      label: 'Newer',
      qualifyingAmount: 'rent_only',
      steps: [step({ dayOffset: 45 })],
    })

    const lease = await prisma.lease.findUniqueOrThrow({
      where: { id: leaseId },
      include: { delinquencyTimeline: true },
    })
    expect(lease.delinquencyTimeline?.label).toBe('Governing')

    const versions = await timelinesFor(actor(), facilityId)
    expect(versions.find((one) => one.label === 'Governing')?.leaseCount).toBe(1)
  })

  it('refuses to save an invalid timeline and creates no version', async () => {
    const result = await saveTimeline(actor(), facilityId, {
      label: 'Broken',
      qualifyingAmount: 'full_balance',
      steps: [step({ automatedActions: ['send_notice'] })],
    })
    expect(result.ok).toBe(false)
    expect(await timelinesFor(actor(), facilityId)).toEqual([])
  })

  it('sorts steps by day however they were submitted', async () => {
    await saveTimeline(actor(), facilityId, {
      label: 'Out of order',
      qualifyingAmount: 'full_balance',
      steps: [step({ dayOffset: 30, label: 'Lien' }), step({ dayOffset: 1, label: 'Late' })],
    })
    const active = await activeTimeline(facilityId)
    expect(active?.steps.map((one) => one.label)).toEqual(['Late', 'Lien'])
  })

  it('accepts the example configuration as-is', async () => {
    // It is offered for editing, so it has to be savable without changes —
    // otherwise an operator hunts for a problem in a file they cannot edit.
    const example = exampleTimeline()
    const result = await saveTimeline(actor(), facilityId, {
      label: example.label,
      qualifyingAmount: 'full_balance',
      steps: example.steps,
    })
    expect(result).toMatchObject({ ok: true })
    expect((await activeTimeline(facilityId))?.label.toLowerCase()).toContain('example')
  })

  it('refuses a template key that does not exist at this facility', async () => {
    // The service always supplies the real key list, so a hand-edited form
    // cannot smuggle one past the picker.
    const result = await saveTimeline(actor(), facilityId, {
      label: 'Typo',
      qualifyingAmount: 'full_balance',
      steps: [
        step({
          automatedActions: ['send_notice'],
          noticeTemplateKey: 'pre_lien_notice',
          deliveryMethods: ['email'],
        }),
      ],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.problems[0].problem).toContain('no message template called')
    }
    expect(await timelinesFor(actor(), facilityId)).toEqual([])
  })

  it('accepts a template key that is really seeded', async () => {
    const result = await saveTimeline(actor(), facilityId, {
      label: 'Real template',
      qualifyingAmount: 'full_balance',
      steps: [
        step({
          dayOffset: 1,
          label: 'Late',
          automatedActions: ['send_notice'],
          noticeTemplateKey: 'dunning_step',
          deliveryMethods: ['email'],
        }),
      ],
    })
    expect(result).toMatchObject({ ok: true })
  })

  it('refuses a staffer without the settings permission', async () => {
    await expect(
      saveTimeline(actor(['tenants:view']), facilityId, {
        label: 'Nope',
        qualifyingAmount: 'full_balance',
        steps: [step()],
      }),
    ).rejects.toThrow()
  })
})
