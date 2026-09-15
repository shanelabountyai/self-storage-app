import { afterEach, describe, expect, it } from 'vitest'
import { testDatabaseUrl, toTestUrl } from '../scripts/test-db.mts'

// The suite's own connection string. Four parameters have to survive the
// rewrite and each was a defect when it did not:
//
//   * `schema=` scopes the ORM, `options=-c search_path=` scopes raw SQL — the
//     pair the file's own comment explains, measured at 46 facilities against
//     3,901.
//   * `connection_limit` and `pool_timeout` are the per-project cap the global
//     conventions require. `DIRECT_URL` carries no parameters by design, so
//     rebuilding from it dropped both and every worker took Prisma's default of
//     `cpus × 2 + 1`. It surfaces as a `marketplace` spec timing out on the
//     pool, which reads as flakiness and is a cap that was never applied.

const saved = { ...process.env }

afterEach(() => {
  process.env = { ...saved }
})

describe('the test suite’s connection string', () => {
  it('scopes both the ORM and raw SQL to the test schema', () => {
    const url = new URL(toTestUrl('postgresql://u:p@localhost:5432/storage_test', 'storage_test'))
    expect(url.searchParams.get('schema')).toBe('storage_test')
    expect(url.searchParams.get('options')).toBe('-c search_path=storage_test')
  })

  it('carries the connection cap across from DATABASE_URL', () => {
    delete process.env.CI
    process.env.DIRECT_URL = 'postgresql://u:p@localhost:5432/storage_test'
    process.env.DATABASE_URL =
      'postgresql://u:p@localhost:5432/storage_test?connection_limit=10&pool_timeout=20'

    const url = new URL(testDatabaseUrl()!)
    expect(url.searchParams.get('connection_limit')).toBe('10')
    expect(url.searchParams.get('pool_timeout')).toBe('20')
    expect(url.searchParams.get('schema')).toBe('storage_test')
  })

  it('leaves the URL alone in CI, where the whole database is a throwaway', () => {
    process.env.CI = 'true'
    process.env.DIRECT_URL = 'postgresql://u:p@localhost:5432/ci'
    expect(testDatabaseUrl()).toBeNull()
  })
})
