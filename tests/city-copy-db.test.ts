import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import type { PermissionKey } from '../packages/db/rbac-catalog'
import type { Actor } from '../apps/web/lib/rbac/actor'
import { ForbiddenError } from '../apps/web/lib/rbac/authorize'
import { cityCopyRows, saveCityCopy, CITY_INTRO_HARD_MAX } from '../apps/web/lib/admin/city-copy'
import { authoredCityIntro } from '../apps/web/lib/facility/city-facilities'
import { contentCorpus } from '../apps/web/lib/marketing/content-corpus'

// PRD 04 §3.2 US-4 AC1 (B-128, D-62). Writing a city page's own words.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip

const suffix = randomUUID().slice(0, 8)
/// A city nothing else in the suite or the demo seed touches, so a row written
/// here cannot be read by another suite's assertion — `city` is keyed on
/// (state, slug) and is not cleaned between tests any more than `audit_log` is.
const CITY = `Copytown ${suffix}`
const CITY_SLUG = `copytown-${suffix}`

let facilityId = ''
let staffId = ''

/// All-facilities assignment (`facilityId: null`), which is what makes an
/// org-wide check pass. The city-scoped negative below is the interesting one.
const orgActor = (): Actor => ({
  kind: 'staff',
  staffUserId: staffId,
  assignments: [
    {
      facilityId: null,
      roleKey: 'owner',
      rank: 40,
      permissions: new Set<PermissionKey>(['marketing:city_copy']),
      limits: { maxFeeWaiverCents: null, maxRefundCents: null, maxCreditCents: null },
    },
  ],
})

/// Holds the permission, but only AT one facility. A city page lists every
/// site in the city, so this must be refused — it is the whole reason the
/// permission is checked with a null facility rather than reusing
/// `facility:settings`.
const facilityScopedActor = (): Actor => ({
  kind: 'staff',
  staffUserId: staffId,
  assignments: [
    {
      facilityId,
      roleKey: 'regional',
      rank: 30,
      permissions: new Set<PermissionKey>(['marketing:city_copy']),
      limits: { maxFeeWaiverCents: null, maxRefundCents: null, maxCreditCents: null },
    },
  ],
})

/// What the duplicate-content report would call this city's intro. Asked of
/// the real corpus rather than of a stub, because the corpus deciding `origin`
/// from the wrong thing is exactly the bug this guards.
async function originOf(slug: string): Promise<string | undefined> {
  const corpus = await contentCorpus()
  return corpus.find((item) => item.url.endsWith(`/${slug}`))?.origin
}

describeDb('city page copy', () => {
  beforeAll(async () => {
    const staff = await prisma.staffUser.create({
      data: {
        email: `citycopy-${suffix}@example.com`,
        firstName: 'City',
        lastName: 'Editor',
      },
    })
    staffId = staff.id

    const facility = await prisma.facility.create({
      data: {
        name: `Copytown Storage ${suffix}`,
        slug: `copytown-storage-${suffix}`,
        status: 'active',
        addressLine1: '1 Storage Way',
        city: CITY,
        state: 'TX',
        postalCode: '78704',
        timezone: 'America/Chicago',
        amenities: ['Gated access'],
      },
    })
    facilityId = facility.id
  })

  afterAll(async () => {
    await prisma.city.deleteMany({ where: { slug: CITY_SLUG } })
    await prisma.facility.deleteMany({ where: { id: facilityId } })
    // The staff user deliberately stays: `audit_log` holds a foreign key to it
    // and is append-only, so deleting the author would mean deleting the audit
    // entries this suite just asserted on.
  })

  it('refuses somebody who holds the permission at one facility only', async () => {
    await expect(saveCityCopy(facilityScopedActor(), 'TX', CITY, 'Anything.')).rejects.toBeInstanceOf(
      ForbiddenError,
    )
    await expect(cityCopyRows(facilityScopedActor())).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('saves copy and hands it back to the public page', async () => {
    const result = await saveCityCopy(
      orgActor(),
      'TX',
      CITY,
      'Copytown is mostly warehouses, which is why our units are bigger here.',
    )
    expect(result.ok).toBe(true)

    // Read through the same function the city page calls, with the URL's
    // lower-cased state — that mismatch is the realistic way this lookup breaks.
    expect(await authoredCityIntro('tx', CITY)).toContain('mostly warehouses')
  })

  it('reports the city as written, with what is on the page now', async () => {
    const rows = await cityCopyRows(orgActor())
    const row = rows.find((candidate) => candidate.slug === CITY_SLUG)
    expect(row).toBeDefined()
    expect(row!.authored).toContain('mostly warehouses')
    expect(row!.facilityCount).toBe(1)
    // The editor claims this is what the page shows. If it ever showed the
    // generated text instead, the screen would be lying about the live page.
    expect(row!.rendered).toEqual([
      'Copytown is mostly warehouses, which is why our units are bigger here.',
    ])
  })

  it('clearing the box goes back to the generated copy rather than publishing nothing', async () => {
    expect((await saveCityCopy(orgActor(), 'TX', CITY, '   ')).ok).toBe(true)
    expect(await authoredCityIntro('TX', CITY)).toBeNull()

    const row = (await cityCopyRows(orgActor())).find((c) => c.slug === CITY_SLUG)
    expect(row!.authored).toBeNull()
    expect(row!.rendered.join(' ')).toContain('We have one storage facility')
  })

  it('refuses a city with no active facility, because that city has no page', async () => {
    // AC1's indexability rule from the other side: that URL 404s, so copy for
    // it would render nowhere and the row would be about a place we do not
    // operate in.
    const result = await saveCityCopy(orgActor(), 'TX', `Nowhere ${suffix}`, 'Words.')
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.problem).toContain('no active facilities')
  })

  it('refuses a paste that ran on rather than publishing it', async () => {
    const result = await saveCityCopy(orgActor(), 'TX', CITY, 'x'.repeat(CITY_INTRO_HARD_MAX + 1))
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.field).toBe('intro')
  })

  it('flips the duplicate-content report from "generated" to "authored"', async () => {
    // The load-bearing consequence of B-128. While a city is generated the
    // report tells the operator there is nothing to rewrite; once somebody has
    // written it, an identical pair is a real copy problem and has to be
    // reported as one. The report reads `origin` and nothing else, so this is
    // the line that decides which advice a flagged pair gets.
    expect(await authoredCityIntro('TX', CITY)).toBeNull()
    expect(await originOf(CITY_SLUG)).toBe('generated')

    await saveCityCopy(orgActor(), 'TX', CITY, 'Written by a person, on purpose.')
    expect(await originOf(CITY_SLUG)).toBe('authored')
  })

  it('records who changed the copy, and what it was before', async () => {
    await saveCityCopy(orgActor(), 'TX', CITY, 'A first version.')
    await saveCityCopy(orgActor(), 'TX', CITY, 'A second version.')

    // `audit_log` is append-only and shared, so this is scoped to this city's
    // own entity id and read newest-first.
    const entries = await prisma.auditLog.findMany({
      where: { action: 'city.copy_changed', entityId: `tx/${CITY_SLUG}` },
      orderBy: { occurredAt: 'desc' },
      take: 1,
    })
    expect(entries).toHaveLength(1)
    expect(entries[0].after).toMatchObject({ intro: 'A second version.' })
    expect(entries[0].before).toMatchObject({ intro: 'A first version.' })
  })
})
