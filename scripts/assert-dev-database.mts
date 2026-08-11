// A pin against running a destructive script at production.
//
// Everything that seeds, bootstraps or creates the test schema reads
// `DATABASE_URL`/`DIRECT_URL` from `.env.local`. Paste production credentials
// into that file — the obvious mistake once a deployment exists — and the very
// next `npm run db:migrate:test` creates a `storage_test` schema INSIDE the
// production database and runs two and a half thousand destructive tests
// against it, while `npm run db:seed` writes demo rows straight into `public`.
// Nothing about either command's name suggests that, which is what makes it
// worth a guard rather than a note.
//
// The pin is opt-in and lives in `.env.local`, which is the file that would be
// wrong. That sounds circular and is not: pasting a new connection string
// changes `DATABASE_URL` and `DIRECT_URL` and leaves `EXPECTED_DEV_DB_HOST`
// alone, so the mismatch is exactly the signal wanted. Unset, these scripts
// behave as they always have — a fresh clone and CI must not need it.

/// Hostname of a Postgres connection string, or null if it is unparseable.
function hostOf(url: string | undefined): string | null {
  if (!url) return null
  try {
    return new URL(url).hostname
  } catch {
    return null
  }
}

/// Neon gives the pooled and direct endpoints different hostnames for the same
/// database (`ep-x-pooler.…` and `ep-x.…`), so the pin is compared against the
/// endpoint id rather than the whole host — otherwise it would have to be set
/// twice and would still be wrong for one of them.
function endpointOf(host: string | null): string | null {
  if (!host) return null
  return host.split('.')[0]?.replace(/-pooler$/, '') ?? null
}

export function assertDevDatabase(what: string): void {
  // CI runs against a throwaway container; there is no production to protect
  // and no pin to compare against.
  if (process.env.CI) return

  const expected = process.env.EXPECTED_DEV_DB_HOST?.trim()
  if (!expected) return

  const expectedEndpoint = endpointOf(expected.includes('.') ? expected : `${expected}.x`)

  for (const [name, url] of [
    ['DATABASE_URL', process.env.DATABASE_URL],
    ['DIRECT_URL', process.env.DIRECT_URL],
  ] as const) {
    const actual = endpointOf(hostOf(url))
    if (!actual || actual === expectedEndpoint) continue

    console.error(
      [
        '',
        `REFUSING to ${what}.`,
        '',
        `  ${name} points at   ${actual}`,
        `  EXPECTED_DEV_DB_HOST is ${expectedEndpoint}`,
        '',
        'This script writes to whatever that connection string names, and the',
        'two do not match — which is what pasting production credentials into',
        '.env.local looks like from here.',
        '',
        'If the development database genuinely moved, update',
        'EXPECTED_DEV_DB_HOST in .env.local to the new endpoint.',
        '',
      ].join('\n'),
    )
    process.exit(1)
  }
}
