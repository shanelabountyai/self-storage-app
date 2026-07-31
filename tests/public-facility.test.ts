import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import { CLOSED_ALL_WEEK, type WeeklySchedule } from '../packages/core/facility-settings'
import {
  citySlug,
  directionsUrl,
  facilityPath,
  formatAddress,
  formatTimeOfDay,
  mapEmbedUrl,
  publicFacilityBySlug,
  type PublicFacility,
} from '../apps/web/lib/facility/public-facility'

// B-016 / PRD 01 US-103.

describe('facility URL scheme', () => {
  it('slugifies cities into a single URL segment', () => {
    expect(citySlug('Austin')).toBe('austin')
    expect(citySlug('Round Rock')).toBe('round-rock')
    // Punctuation and doubled separators must not produce empty segments or a
    // trailing dash — either would make two spellings of the same city page.
    expect(citySlug('St. Louis')).toBe('st-louis')
    expect(citySlug("Coeur d'Alene")).toBe('coeur-d-alene')
    expect(citySlug('  Fort  Worth  ')).toBe('fort-worth')
  })

  it('builds the canonical path US-103 specifies', () => {
    expect(facilityPath({ state: 'TX', city: 'Round Rock', slug: 'north-side' })).toBe(
      '/storage/tx/round-rock/north-side',
    )
  })

  it('is idempotent — the canonical path re-derives to itself', () => {
    // The page redirects anything that isn't canonical, so a path that changed
    // on a second pass would be an infinite redirect.
    const facility = { state: 'TX', city: 'Round Rock', slug: 'north-side' }
    const once = facilityPath(facility)
    expect(facilityPath({ ...facility, state: 'tx', city: 'round-rock' })).toBe(once)
  })
})

describe('hours display', () => {
  it('renders stored 24h wall-clock times as 12h', () => {
    expect(formatTimeOfDay('09:00')).toBe('9:00 AM')
    expect(formatTimeOfDay('18:30')).toBe('6:30 PM')
    // The two that a naive `% 12` gets wrong.
    expect(formatTimeOfDay('00:00')).toBe('12:00 AM')
    expect(formatTimeOfDay('12:00')).toBe('12:00 PM')
    expect(formatTimeOfDay('23:59')).toBe('11:59 PM')
  })
})

describe('address and map links', () => {
  const base: PublicFacility = {
    id: 'f1',
    slug: 'austin-south',
    name: 'Austin South',
    addressLine1: '2400 South Congress Ave',
    addressLine2: null,
    city: 'Austin',
    state: 'TX',
    postalCode: '78704',
    phone: '512-555-0100',
    latitude: 30.2456,
    longitude: -97.7583,
    timezone: 'America/Chicago',
    amenities: [],
    officeHours: null,
    gateHours: null,
  }

  it('formats one-line addresses with and without a second line', () => {
    expect(formatAddress(base)).toBe('2400 South Congress Ave, Austin, TX 78704')
    expect(formatAddress({ ...base, addressLine2: 'Suite B' })).toBe(
      '2400 South Congress Ave, Suite B, Austin, TX 78704',
    )
  })

  it('prefers coordinates for directions and falls back to the address', () => {
    expect(directionsUrl(base)).toContain('destination=30.2456%2C-97.7583')
    const noCoords = { ...base, latitude: null, longitude: null }
    expect(directionsUrl(noCoords)).toContain(encodeURIComponent(formatAddress(noCoords)))
  })

  it('has no map embed without coordinates', () => {
    expect(mapEmbedUrl({ ...base, latitude: null, longitude: null })).toBeNull()
    expect(mapEmbedUrl(base)).toContain('marker=30.2456,-97.7583')
  })
})

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip

const suffix = randomUUID().slice(0, 8)
const activeSlug = `facility-page-${suffix}`
const inactiveSlug = `facility-page-off-${suffix}`
const noHoursSlug = `facility-page-nohours-${suffix}`

const officeHours: WeeklySchedule = {
  ...CLOSED_ALL_WEEK,
  monday: { closed: false, open: '09:00', close: '18:00' },
}

describeDb('publicFacilityBySlug', () => {
  beforeAll(async () => {
    // Plain Prisma rather than the admin libs, so this suite can delete what it
    // created — an audited facility can never be hard-deleted (AuditLog.facility
    // is Restrict). Same reasoning as tests/public-inventory-db.test.ts.
    const common = {
      addressLine1: '1 Storage Way',
      city: 'Round Rock',
      state: 'TX',
      postalCode: '78664',
      timezone: 'America/Chicago',
    }
    await prisma.facility.createMany({
      data: [
        {
          ...common,
          name: 'Facility Page Test',
          slug: activeSlug,
          status: 'active',
          phone: '512-555-0100',
          email: 'manager@example.com',
          latitude: 30.5083,
          longitude: -97.6789,
          amenities: ['Gated access'],
          officeHours,
          gateHours: { ...CLOSED_ALL_WEEK, sunday: { closed: false, open: '06:00', close: '22:00' } },
        },
        { ...common, name: 'Closed Site', slug: inactiveSlug, status: 'inactive' },
        // Hours left unset, plus a malformed pair, to prove both read as null
        // rather than throwing or rendering as "open 24 hours".
        {
          ...common,
          name: 'No Hours Yet',
          slug: noHoursSlug,
          status: 'active',
          gateHours: { monday: 'all day' },
        },
      ],
    })
  })

  afterAll(async () => {
    if (!hasDatabase) return
    await prisma.facility.deleteMany({
      where: { slug: { in: [activeSlug, inactiveSlug, noHoursSlug] } },
    })
    await prisma.$disconnect()
  })

  it('returns the public profile with parsed hours', async () => {
    const facility = await publicFacilityBySlug(activeSlug)
    expect(facility).not.toBeNull()
    expect(facility!.name).toBe('Facility Page Test')
    expect(facility!.officeHours?.monday).toEqual({ closed: false, open: '09:00', close: '18:00' })
    expect(facility!.officeHours?.tuesday).toEqual({ closed: true })
    expect(facility!.gateHours?.sunday).toEqual({ closed: false, open: '06:00', close: '22:00' })
    expect(facility!.amenities).toEqual(['Gated access'])
    // The canonical path is derivable from what the page gets back.
    expect(facilityPath(facility!)).toBe(`/storage/tx/round-rock/${activeSlug}`)
  })

  it('never exposes the manager mailbox', async () => {
    const facility = await publicFacilityBySlug(activeSlug)
    // The select is field-by-field precisely so a later column cannot leak; this
    // asserts the one field that already exists on the row and must not ship.
    expect(Object.keys(facility!)).not.toContain('email')
  })

  it('treats unset and malformed hours as unknown, not as open', async () => {
    const facility = await publicFacilityBySlug(noHoursSlug)
    expect(facility!.officeHours).toBeNull()
    expect(facility!.gateHours).toBeNull()
  })

  it('404s inactive and unknown facilities', async () => {
    expect(await publicFacilityBySlug(inactiveSlug)).toBeNull()
    expect(await publicFacilityBySlug(`missing-${suffix}`)).toBeNull()
  })
})
