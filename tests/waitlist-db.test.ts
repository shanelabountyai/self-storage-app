import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import { CLAIM_WINDOW_HOURS } from '../packages/core/waitlist'
import { cancelWaitlist, joinWaitlist, sweepWaitlists, waitlistPosition } from '../apps/web/lib/waitlist/service'
import { waitlistDemand } from '../apps/web/lib/waitlist/admin'

// PRD 01 §9 Phase 3 (B-090 part 1). The waitlist against real rows — the join
// race, and the sweep that decides who gets told.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip

const suffix = randomUUID().slice(0, 8)
const state: { facilityId: string; unitTypeId: string; otherTypeId: string } = {
  facilityId: '',
  unitTypeId: '',
  otherTypeId: '',
}

/// Units are created `occupied` so the size is genuinely full, which is the
/// only state the form appears in. `freeUnits` is what a move-out looks like.
async function makeType(name: string, count: number) {
  const unitType = await prisma.unitType.create({
    data: { facilityId: state.facilityId, name: `${name} ${suffix}`, widthFt: 10, lengthFt: 20 },
  })
  await prisma.unitTypeRate.create({
    data: {
      facilityId: state.facilityId,
      unitTypeId: unitType.id,
      streetRateCents: 24_900,
      webRateCents: 22_900,
      effectiveFrom: new Date('2020-01-01T00:00:00Z'),
    },
  })
  await prisma.unit.createMany({
    data: Array.from({ length: count }, (_, index) => ({
      facilityId: state.facilityId,
      unitTypeId: unitType.id,
      number: `${name}-${suffix}-${index}`,
      status: 'occupied' as const,
    })),
  })
  return unitType.id
}

async function freeUnits(unitTypeId: string, count: number) {
  const units = await prisma.unit.findMany({
    where: { unitTypeId, status: 'occupied' },
    select: { id: true },
    take: count,
  })
  await prisma.unit.updateMany({
    where: { id: { in: units.map((unit) => unit.id) } },
    data: { status: 'available' },
  })
}

async function join(email: string, unitTypeId = state.unitTypeId) {
  return joinWaitlist({ facilityId: state.facilityId, unitTypeId, email })
}

/// Scoped to one unit type on purpose. `sweepWaitlists` is global — it is a
/// cron sweep, not a per-facility call — so its RETURN counts include whatever
/// other suites in this file left outstanding. Asserting on the global number
/// is the shared-state trap this repo documents; the meaningful claim is
/// always about a specific queue.
async function notifiedIn(unitTypeId: string): Promise<number> {
  return prisma.waitlistEntry.count({ where: { unitTypeId, status: 'notified' } })
}

async function sentCount(): Promise<number> {
  return prisma.message.count({
    where: { templateKey: 'waitlist_unit_available', facilityId: state.facilityId },
  })
}

beforeAll(async () => {
  if (!hasDatabase) return
  const facility = await prisma.facility.create({
    data: {
      name: `Waitlist ${suffix}`,
      slug: `waitlist-${suffix}`,
      status: 'active',
      addressLine1: '1 Storage Way',
      city: `Waitville ${suffix}`,
      state: 'TX',
      postalCode: '78704',
      timezone: 'America/Chicago',
    },
  })
  state.facilityId = facility.id
  state.unitTypeId = await makeType('big', 4)
  state.otherTypeId = await makeType('small', 2)
})

afterAll(async () => {
  if (!hasDatabase || !state.facilityId) return
  await prisma.message.deleteMany({ where: { facilityId: state.facilityId } })
  await prisma.facility.delete({ where: { id: state.facilityId } })
})

describeDb('joining a waitlist', () => {
  it('refuses an address nothing could be delivered to', async () => {
    const result = await join('not-an-address')
    expect(result.ok).toBe(false)
  })

  it('refuses a unit type that is not at the facility named', async () => {
    // Both ids come from a form, so neither is trusted. Without the check a
    // crafted post puts somebody on a list for another site, and the mail they
    // eventually get names a facility they never asked about.
    const other = await prisma.facility.create({
      data: {
        name: `Elsewhere ${suffix}`,
        slug: `elsewhere-${suffix}`,
        status: 'active',
        addressLine1: '2 Storage Way',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704',
        timezone: 'America/Chicago',
      },
    })
    const result = await joinWaitlist({
      facilityId: other.id,
      unitTypeId: state.unitTypeId,
      email: `crafted-${suffix}@example.com`,
    })
    expect(result.ok).toBe(false)
    await prisma.facility.delete({ where: { id: other.id } })
  })

  it('treats a double submit as already-on rather than a second entry', async () => {
    const email = `ada-${suffix}@example.com`
    expect(await join(email)).toMatchObject({ ok: true, alreadyOn: false })
    // The partial unique index is the real guard — the service has no
    // read-then-write fast path in front of it, precisely so this is the code
    // path a double-clicked form takes.
    expect(await join(email)).toMatchObject({ ok: true, alreadyOn: true })
    // And the same address spelled differently is the same person.
    expect(await join(`ADA-${suffix}@Example.com`)).toMatchObject({ ok: true, alreadyOn: true, email })

    expect(
      await prisma.waitlistEntry.count({ where: { unitTypeId: state.unitTypeId, email } }),
    ).toBe(1)
  })

  it('lets the same person wait for two different sizes', async () => {
    const email = `two-sizes-${suffix}@example.com`
    expect((await join(email, state.unitTypeId)).ok).toBe(true)
    expect(await join(email, state.otherTypeId)).toMatchObject({ ok: true, alreadyOn: false })
  })
})

describeDb('the sweep', () => {
  it('tells nobody while the size is still full', async () => {
    const before = await sentCount()
    await sweepWaitlists(new Date())
    expect(await notifiedIn(state.unitTypeId)).toBe(0)
    expect(await sentCount()).toBe(before)
  })

  it('tells one person per free unit, oldest first, and only once', async () => {
    // A fresh size so the counts are absolute rather than "at least".
    const unitTypeId = await makeType('fifo', 3)
    const emails = ['first', 'second', 'third', 'fourth'].map((n) => `${n}-${suffix}@example.com`)
    for (const email of emails) {
      expect((await join(email, unitTypeId)).ok).toBe(true)
      // Distinct createdAt values, so "oldest first" is a real ordering rather
      // than whatever Postgres returned for four identical timestamps.
      await new Promise((resolve) => setTimeout(resolve, 5))
    }

    await freeUnits(unitTypeId, 2)
    await sweepWaitlists(new Date())
    expect(await notifiedIn(unitTypeId)).toBe(2)

    const notified = await prisma.waitlistEntry.findMany({
      where: { unitTypeId, status: 'notified' },
      select: { email: true },
    })
    expect(notified.map((row) => row.email).sort()).toEqual([emails[0], emails[1]].sort())

    // Running again changes nothing: the two outstanding claims account for
    // both free units, so there is nothing left to offer the other two.
    await sweepWaitlists(new Date())
    expect(await notifiedIn(unitTypeId)).toBe(2)
    expect(
      await prisma.waitlistEntry.count({ where: { unitTypeId, status: 'waiting' } }),
    ).toBe(2)
  })

  it('gives the next person a turn once a claim window elapses', async () => {
    const unitTypeId = await makeType('expiry', 2)
    const early = `early-${suffix}@example.com`
    const late = `late-${suffix}@example.com`
    expect((await join(early, unitTypeId)).ok).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect((await join(late, unitTypeId)).ok).toBe(true)

    await freeUnits(unitTypeId, 1)
    const firstSweep = new Date()
    await sweepWaitlists(firstSweep)
    expect(await notifiedIn(unitTypeId)).toBe(1)

    // Still inside the window: nobody else is told about the same unit.
    const stillInside = new Date(firstSweep.getTime() + (CLAIM_WINDOW_HOURS - 1) * 3_600_000)
    await sweepWaitlists(stillInside)
    expect(await notifiedIn(unitTypeId)).toBe(1)

    const afterWindow = new Date(firstSweep.getTime() + (CLAIM_WINDOW_HOURS + 1) * 3_600_000)
    const swept = await sweepWaitlists(afterWindow)
    expect(swept.expired).toBeGreaterThanOrEqual(1)
    // The first claim expired and the second person took the slot — one live
    // claim on this queue either way, but a different person holding it.
    expect(await notifiedIn(unitTypeId)).toBe(1)

    const laterEntry = await prisma.waitlistEntry.findFirstOrThrow({
      where: { unitTypeId, email: late },
      select: { status: true },
    })
    expect(laterEntry.status).toBe('notified')
  })

  it('sends exactly one mail per notification', async () => {
    const unitTypeId = await makeType('once', 1)
    const email = `once-${suffix}@example.com`
    expect((await join(email, unitTypeId)).ok).toBe(true)
    await freeUnits(unitTypeId, 1)

    const before = await sentCount()
    await sweepWaitlists(new Date())
    expect(await sentCount()).toBe(before + 1)

    // `sendDirectEmail` is keyed on the entry, so even a sweep that somehow ran
    // the same row twice cannot produce a second message.
    await sweepWaitlists(new Date())
    expect(await sentCount()).toBe(before + 1)
  })

  it('skips a cancelled entry entirely', async () => {
    const unitTypeId = await makeType('cancelled', 1)
    const email = `gone-${suffix}@example.com`
    expect((await join(email, unitTypeId)).ok).toBe(true)

    const entry = await prisma.waitlistEntry.findFirstOrThrow({
      where: { unitTypeId, email },
      select: { cancelToken: true },
    })
    expect(await cancelWaitlist(entry.cancelToken)).toEqual({ ok: true, alreadyClosed: false })
    // Clicking the link twice is not a failure.
    expect(await cancelWaitlist(entry.cancelToken)).toEqual({ ok: true, alreadyClosed: true })

    await freeUnits(unitTypeId, 1)
    await sweepWaitlists(new Date())
    expect(await notifiedIn(unitTypeId)).toBe(0)
  })

  it('reports nothing for a token that is not ours', async () => {
    expect(await cancelWaitlist('not-a-real-token')).toEqual({ ok: false, alreadyClosed: false })
  })
})

describeDb('what an operator sees', () => {
  it('counts waiting and claiming separately, longest queue first', async () => {
    const rows = await waitlistDemand(state.facilityId)
    expect(rows.length).toBeGreaterThan(0)
    for (let i = 1; i < rows.length; i += 1) {
      expect(rows[i - 1]!.waiting).toBeGreaterThanOrEqual(rows[i]!.waiting)
    }
    // A notified person is work in progress, not demand — mixing them would
    // overstate the case for building more of a size.
    const totals = rows.reduce((sum, row) => sum + row.waiting + row.claiming, 0)
    expect(totals).toBe(
      await prisma.waitlistEntry.count({
        where: { facilityId: state.facilityId, status: { in: ['waiting', 'notified'] } },
      }),
    )
  })

  it('places somebody in the queue they can be told about', async () => {
    const unitTypeId = await makeType('position', 2)
    const first = `pos-first-${suffix}@example.com`
    await join(first, unitTypeId)
    await new Promise((resolve) => setTimeout(resolve, 5))
    await join(`pos-second-${suffix}@example.com`, unitTypeId)

    const entry = await prisma.waitlistEntry.findFirstOrThrow({
      where: { unitTypeId, email: first },
      select: { id: true },
    })
    expect(await waitlistPosition(entry.id)).toEqual({ position: 1, total: 2 })
  })

  it('names who is waiting, not just how many (B-154)', async () => {
    const unitTypeId = await makeType('contacts', 1)
    const email = `contact-${suffix}@example.com`
    await joinWaitlist({ facilityId: state.facilityId, unitTypeId, email, phone: '512-555-0199', firstName: 'Ada' })

    const rows = await waitlistDemand(state.facilityId)
    const row = rows.find((one) => one.unitTypeId === unitTypeId)
    expect(row?.contacts).toMatchObject([{ name: 'Ada', email, phone: '512-555-0199', status: 'waiting' }])
  })
})

describeDb('the sweep email (D-87)', () => {
  it('never tells a prospect we are holding the unit for them', async () => {
    const unitTypeId = await makeType('honest', 1)
    const email = `honest-${suffix}@example.com`
    await join(email, unitTypeId)
    await freeUnits(unitTypeId, 1)
    await sweepWaitlists(new Date())

    const message = await prisma.message.findFirstOrThrow({
      where: { templateKey: 'waitlist_unit_available', facilityId: state.facilityId, toAddress: email },
    })
    // D-87 (owner, 2026-08-21): no unit hold — the sweep stays a race, and the
    // copy has to say so rather than implying a claim that does not exist.
    expect(message.bodySnapshot.toLowerCase()).not.toContain('holding your place')
    expect(message.bodySnapshot).toContain('first person to complete a rental gets it')
  })
})
