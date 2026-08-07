import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import {
  recordFacilityMove,
  recordFacilityRetirement,
  recordRedirect,
  redirectFor,
} from '../apps/web/lib/marketing/redirects'

// B-066 / PRD 04 FR-SEO-2, US-3 AC4. The 301 map, against real rows.
//
// The failure this exists to prevent is the expensive kind: invisible. A slug
// or city edit that 404s every inbound link looks like nothing at all on the
// day it happens, and shows up weeks later as traffic that stopped.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)

const OLD = { state: 'TX', city: 'Austin', slug: `old-${suffix}` }
const NEW = { state: 'TX', city: 'Austin', slug: `new-${suffix}` }

describeDb('the redirect map', () => {
  beforeAll(async () => {
    if (!hasDatabase) return
    await prisma.urlRedirect.deleteMany({ where: { fromPath: { contains: suffix } } })
  })

  afterAll(async () => {
    if (!hasDatabase) return
    await prisma.urlRedirect.deleteMany({ where: { fromPath: { contains: suffix } } })
    await prisma.$disconnect()
  })

  it('records a move and resolves the old path', async () => {
    await recordFacilityMove(OLD, NEW)

    const hit = await redirectFor(`/storage/tx/austin/old-${suffix}`)
    expect(hit).toEqual({ toPath: `/storage/tx/austin/new-${suffix}`, permanent: true })
  })

  it('moves the sub-pages too', async () => {
    // A renter with `/…/reserve` bookmarked is further along than one on the
    // landing page; dropping them at a 404 is the more expensive failure.
    expect(await redirectFor(`/storage/tx/austin/old-${suffix}/reserve`)).toMatchObject({
      toPath: `/storage/tx/austin/new-${suffix}/reserve`,
    })
    expect(await redirectFor(`/storage/tx/austin/old-${suffix}/rent`)).toMatchObject({
      toPath: `/storage/tx/austin/new-${suffix}/rent`,
    })
  })

  it('resolves a non-canonical spelling of the old path', async () => {
    // Whoever links the old URL will not have used the canonical casing.
    expect(await redirectFor(`/Storage/TX/Austin/old-${suffix}/`)).toMatchObject({
      toPath: `/storage/tx/austin/new-${suffix}`,
    })
  })

  it('catches a city rename, which moves the URL just as surely', async () => {
    // The edit an operator actually makes — fixing a typo in the city — with no
    // idea they have just moved every page under it.
    const before = { state: 'TX', city: 'Austn', slug: `typo-${suffix}` }
    const after = { state: 'TX', city: 'Austin', slug: `typo-${suffix}` }
    await recordFacilityMove(before, after)

    expect(await redirectFor(`/storage/tx/austn/typo-${suffix}`)).toMatchObject({
      toPath: `/storage/tx/austin/typo-${suffix}`,
    })
  })

  it('never rewrites an existing entry when a slug moves twice', async () => {
    // a → b, then b → c. Rewriting `a → b` into `a → c` is what turns a rename
    // cycle into a redirect loop; two hops is fine.
    const c = { state: 'TX', city: 'Austin', slug: `newer-${suffix}` }
    await recordFacilityMove(NEW, c)

    expect(await redirectFor(`/storage/tx/austin/old-${suffix}`)).toMatchObject({
      toPath: `/storage/tx/austin/new-${suffix}`,
    })
    expect(await redirectFor(`/storage/tx/austin/new-${suffix}`)).toMatchObject({
      toPath: `/storage/tx/austin/newer-${suffix}`,
    })
  })

  it('sends a retired facility to its city page — US-3 AC4', async () => {
    const retired = { state: 'TX', city: 'San Antonio', slug: `gone-${suffix}` }
    await recordFacilityRetirement(retired)

    expect(await redirectFor(`/storage/tx/san-antonio/gone-${suffix}`)).toMatchObject({
      toPath: '/storage/tx/san-antonio',
    })
    // Its sub-pages land on the city page too — there is no reservation form
    // to send them to.
    expect(await redirectFor(`/storage/tx/san-antonio/gone-${suffix}/reserve`)).toMatchObject({
      toPath: '/storage/tx/san-antonio',
    })
  })

  it('refuses to record a self-redirect', async () => {
    await recordRedirect({
      fromPath: `/storage/tx/austin/self-${suffix}`,
      toPath: `/storage/tx/austin/self-${suffix}`,
      reason: 'test',
    })
    // A loop that would take the page off the index entirely.
    expect(await redirectFor(`/storage/tx/austin/self-${suffix}`)).toBeNull()
  })

  it('is a no-op when nothing actually moved', async () => {
    await recordFacilityMove(NEW, NEW)
    expect(
      await prisma.urlRedirect.count({ where: { fromPath: `/storage/tx/austin/new-${suffix}` } }),
    ).toBe(1)
  })

  it('returns null for a path nobody has moved', async () => {
    expect(await redirectFor(`/storage/tx/austin/never-existed-${suffix}`)).toBeNull()
  })
})
