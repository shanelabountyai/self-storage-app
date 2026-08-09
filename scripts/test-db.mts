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

/// The URL the suite should use, or null when there is no database configured —
/// in which case every `*-db` suite skips itself, which is existing behaviour.
///
/// Built from `DIRECT_URL`, the UNPOOLED endpoint, and that is not a
/// preference: Neon's pooler rejects `search_path` as a startup parameter
/// outright ("unsupported startup parameter in options"), so the pooled URL
/// cannot carry the half of this that scopes raw SQL. A test run is one process
/// and has no use for a connection pool anyway.
export function testDatabaseUrl(): string | null {
  const base = process.env.DIRECT_URL ?? process.env.DATABASE_URL
  return base ? toTestUrl(base) : null
}

/// Migrations need the same unpooled connection: `migrate deploy` takes an
/// advisory lock the pooler cannot hold, and DDL through a pooler is the kind
/// of thing that half-applies.
export function testDirectUrl(): string | null {
  return testDatabaseUrl()
}
