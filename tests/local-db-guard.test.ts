import { describe, expect, it } from 'vitest'
import { assertLocalTestDatabase } from '../scripts/local-db-guard.mts'

// K12 / INV-18. vitest.config.ts and playwright.config.ts call this at load.

const neonDirect = 'postgresql://u:p@ep-holy-block-123.us-east-2.aws.neon.tech/neondb'
const neonPooled = 'postgresql://u:p@ep-holy-block-123-pooler.us-east-2.aws.neon.tech/neondb'
const local = 'postgresql://postgres:postgres@localhost:5432/storage_test'

describe('K12: the test-database guard', () => {
  it('refuses a cloud DATABASE_URL or DIRECT_URL', () => {
    expect(() => assertLocalTestDatabase({ DATABASE_URL: neonPooled })).toThrow(/Refusing.*DATABASE_URL/)
    expect(() => assertLocalTestDatabase({ DATABASE_URL: local, DIRECT_URL: neonDirect })).toThrow(/DIRECT_URL/)
  })

  it('never echoes the credentials', () => {
    expect(() => assertLocalTestDatabase({ DATABASE_URL: neonPooled })).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining('u:p@') }),
    )
  })

  it('allows local Postgres, CI containers and an unset database', () => {
    expect(() => assertLocalTestDatabase({ DATABASE_URL: local, DIRECT_URL: local })).not.toThrow()
    expect(() => assertLocalTestDatabase({ DATABASE_URL: 'postgresql://ci:ci@localhost:5432/ci' })).not.toThrow()
    expect(() => assertLocalTestDatabase({})).not.toThrow()
  })

  it('lets ALLOW_CLOUD_DB=1 reach one deliberately', () => {
    expect(() => assertLocalTestDatabase({ DATABASE_URL: neonDirect, ALLOW_CLOUD_DB: '1' })).not.toThrow()
  })
})
