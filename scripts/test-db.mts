// Where the unit/DB test suite points, and how it gets there.
//
// Dev and the test suite shared one database — one Neon database, one `public`
// schema, both writing at once. That is what leaked a live owner account out of
// an interrupted `bootstrap-owner` run and broke every subsequent run of it; it
// is why `CLAUDE.md` carries the "run the suite twice before calling it green"
// rule; and it is why twenty suites suffix every fixture name.
//
// The fix is a separate SCHEMA rather than a separate database, deliberately:
// Postgres schemas are free, need no second credential, and there is no Docker
// or local Postgres on this machine to host an alternative. `public` stays
// dev's; `storage_test` is the suite's. Nothing else changes — Prisma takes the
// schema from the connection string.
//
// NOTE: CI does not use any of this. It runs against a throwaway Postgres
// service container and always has (.github/workflows/ci.yml), so it was never
// part of the contention this solves.

export const TEST_SCHEMA = process.env.TEST_DB_SCHEMA ?? 'storage_test'

/// Rewrites a connection string to point at the test schema.
///
/// TWO parameters, and both are needed — this was measured, not assumed:
///
///   * `schema=` scopes the ORM. Prisma qualifies its own generated SQL with
///     it, so `prisma.facility.count()` reads the test schema.
///   * `options=-c search_path=` scopes RAW SQL. Prisma does **not** set the
///     connection's `search_path` from `schema=`, so `$queryRaw` with an
///     unqualified table name silently reads `public` instead.
///
/// With only the first, the suite splits itself across two schemas: the ORM
/// writes fixtures into `storage_test` while `claimUnit`'s
/// `FOR UPDATE SKIP LOCKED`, the gapless invoice and receipt numbering, and the
/// promo-cap `UPDATE` all operate on dev's data. Measured directly: ORM saw 46
/// facilities, raw SQL saw 3,901. That is worse than sharing one schema,
/// because it looks like it works.
export function toTestUrl(url: string, schema: string = TEST_SCHEMA): string {
  const parsed = new URL(url)
  parsed.searchParams.set('schema', schema)
  parsed.searchParams.set('options', `-c search_path=${schema}`)
  return parsed.toString()
}

/// Whether the suite should be redirected onto its own schema at all.
///
/// It should NOT be in CI. CI already runs against a throwaway Postgres service
/// container whose entire database is disposable and whose migrations land in
/// `public` — redirecting there points the suite at a schema nothing created,
/// which is exactly how this broke a build ("The table `storage_test.message`
/// does not exist"). The separation solves a LOCAL problem: dev and the suite
/// sharing one long-lived Neon database.
function shouldRedirect(): boolean {
  return !process.env.CI
}

/// The URL the suite should use, or null when there is no database configured —
/// in which case every `*-db` suite skips itself, which is existing behaviour.
///
/// Built from `DIRECT_URL`, the UNPOOLED endpoint, and that is not a
/// preference: Neon's pooler rejects `search_path` as a startup parameter
/// outright ("unsupported startup parameter in options"), so the pooled URL
/// cannot carry the half of this that scopes raw SQL. A test run is one process
/// and has no use for a connection pool anyway.
export function testDatabaseUrl(): string | null {
  if (!shouldRedirect()) return null
  const base = process.env.DIRECT_URL ?? process.env.DATABASE_URL
  return base ? withPoolLimitsFrom(toTestUrl(base), process.env.DATABASE_URL) : null
}

/// Carries `connection_limit` and `pool_timeout` across from `DATABASE_URL`.
///
/// **Without this the suite ignores the per-project connection cap entirely**,
/// and the cap is a machine-wide resource the same way a port is (CLAUDE.md →
/// *Cap the connection pool per project*). `.env.test` sets
/// `?connection_limit=10&pool_timeout=20` on `DATABASE_URL`; `DIRECT_URL`
/// carries no parameters, because the whole point of it is an unpooled
/// endpoint — so rebuilding the suite's URL from it silently dropped both, and
/// every worker fell back to Prisma's default of `cpus × 2 + 1`.
///
/// Found by the symptom the convention names: a `marketplace` spec failing with
/// *"Timed out fetching a new connection from the connection pool … connection
/// limit: 21"* — 21, not 10 — while `pg_stat_activity` showed 32 connections on
/// `storage_test` from this suite alone. It reads exactly like a flaky test and
/// is a configuration that was never applied.
function withPoolLimitsFrom(url: string, source: string | undefined): string {
  if (!source) return url
  const from = new URL(source).searchParams
  const parsed = new URL(url)
  for (const key of ['connection_limit', 'pool_timeout']) {
    const value = from.get(key)
    if (value !== null) parsed.searchParams.set(key, value)
  }
  return parsed.toString()
}

/// Migrations need the same unpooled connection: `migrate deploy` takes an
/// advisory lock the pooler cannot hold, and DDL through a pooler is the kind
/// of thing that half-applies.
export function testDirectUrl(): string | null {
  return testDatabaseUrl()
}
