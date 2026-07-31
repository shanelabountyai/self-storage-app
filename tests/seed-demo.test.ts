import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DEMO_LEASE_STATES, DEMO_PRE_LEASE_STATES } from '../apps/web/scripts/seed-demo.mts'

// PRD 03 US-7 AC4: "demo tenants in every lifecycle state across >= 2
// facilities." CI runs the test suite but never runs the seed script, so this
// is the only thing that notices when a new lifecycle state is added to the
// schema and the demo data stops being representative.
describe('demo seed lifecycle coverage', () => {
  it('covers every LeaseStatus the schema defines', () => {
    // Read from the schema rather than a hand-copied list, so adding a status
    // to Prisma is what fails this test.
    const schema = readFileSync(
      new URL('../packages/db/prisma/schema.prisma', import.meta.url),
      'utf8',
    )
    const block = schema.match(/enum LeaseStatus \{([\s\S]*?)\}/)![1]
    const statuses = block
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '' && !line.startsWith('/'))

    expect([...DEMO_LEASE_STATES].sort()).toEqual(statuses.sort())
  })

  it('also covers the states that exist before a lease', () => {
    expect(DEMO_PRE_LEASE_STATES).toContain('lead')
    expect(DEMO_PRE_LEASE_STATES).toContain('reserved')
  })
})
