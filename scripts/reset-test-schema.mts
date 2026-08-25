import { execFileSync } from 'node:child_process'
import { assertDevDatabase } from './assert-dev-database.mts'
import { TEST_SCHEMA, testDirectUrl } from './test-db.mts'

// B-185. `storage_test` accumulated 13,106 facilities and 8,276 units over
// weeks with nothing to reclaim them: `audit_log`'s append-only migration
// (20260730174727) gives it a RESTRICT foreign key to `facility` and
// `staff_user`, and a trigger that refuses UPDATE, DELETE, *and* TRUNCATE on
// itself outright — "deliberately no in-band escape hatch," per that
// migration's own comment. Any fixture a suite ever audit-logged against
// (`access-service-db.test.ts` already carries a comment naming this: "Not
// the facility: revealCode's audit entries hold a Restrict FK to it") cannot
// be cleaned up by `deleteMany`, however disciplined the suite is. Per-suite
// cleanup can only ever clear what audit_log hasn't pinned.
//
// Dropping and recreating the schema is the one thing that works — it is
// what actually fixed the 2026-08-24 incident (PROGRESS.md, B-185) — and
// until now it was a manual recipe nobody was told about. This wraps it as
// one command.
//
// Deliberately NOT wired into `npm test`: replaying every migration against a
// remote database is the same cost `db:migrate:test`'s own comment already
// rules out for that reason. Run it by hand when the suite is slow, or a
// `marketplaceFeed`/`searchTenants`-shaped assertion fails for no code
// reason — or periodically, before it gets that far.

assertDevDatabase('reset the test schema')

const direct = testDirectUrl()
if (!direct) {
  console.error('No DATABASE_URL configured — nothing to reset.')
  process.exit(1)
}

const plain = new URL(direct)
plain.searchParams.delete('schema')
plain.searchParams.delete('options')

console.log(`Dropping schema "${TEST_SCHEMA}"…`)
execFileSync('npx', ['prisma', 'db', 'execute', '--url', plain.toString(), '--stdin'], {
  input: `DROP SCHEMA IF EXISTS "${TEST_SCHEMA}" CASCADE;`,
  stdio: ['pipe', 'inherit', 'inherit'],
})

// Recreates it and applies every migration + the roles/permissions/comms seed
// — the same steps `db:migrate:test` already does for a schema that doesn't
// exist yet.
execFileSync('npm', ['run', 'db:migrate:test'], { stdio: 'inherit' })
