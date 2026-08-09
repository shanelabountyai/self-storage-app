import { execFileSync } from 'node:child_process'
import { TEST_SCHEMA, testDirectUrl } from './test-db.mts'

// Creates the test schema and applies every migration into it.
//
// Run once, and again after a new migration lands: `npm run db:migrate:test`.
// Deliberately NOT run before every `npm test` — applying ~30 migrations
// against a remote database takes long enough that it would tax every run to
// cover the handful where anything changed.

const direct = testDirectUrl()
if (!direct) {
  console.error('No DATABASE_URL configured — nothing to migrate.')
  process.exit(1)
}

// `migrate deploy` creates tables INSIDE the schema named on the URL, but will
// not create the schema itself. Done through `prisma db execute` rather than a
// Postgres client so this needs no dependency of its own.
const plain = new URL(direct)
plain.searchParams.delete('schema')
plain.searchParams.delete('options')
const withoutSchema = plain.toString()
execFileSync('npx', ['prisma', 'db', 'execute', '--url', withoutSchema, '--stdin'], {
  input: `CREATE SCHEMA IF NOT EXISTS "${TEST_SCHEMA}";`,
  stdio: ['pipe', 'inherit', 'inherit'],
})

console.log(`Applying migrations into schema "${TEST_SCHEMA}"…`)
execFileSync(
  'npx',
  ['prisma', 'migrate', 'deploy', '--schema', 'packages/db/prisma/schema.prisma'],
  { stdio: 'inherit', env: { ...process.env, DATABASE_URL: direct, DIRECT_URL: direct } },
)

// Roles and permissions are reference data, not fixtures — authorization does
// not work without them, and every RBAC assertion in the suite would fail on an
// empty schema in a way that looks like a permissions bug. Same reasoning the
// CI workflow states for doing this after its own migrate step.
console.log('Seeding roles and permissions…')
execFileSync('node', ['packages/db/prisma/seed.mts'], {
  stdio: 'inherit',
  env: { ...process.env, DATABASE_URL: direct, DIRECT_URL: direct },
})

console.log(`\nDone. The suite runs against "${TEST_SCHEMA}"; dev keeps "public".`)
