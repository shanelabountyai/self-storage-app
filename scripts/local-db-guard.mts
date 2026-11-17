// K12 / INV-18. The unit and e2e suites run on a LOCAL Postgres, never a cloud
// one. `npm test` and `npm run test:e2e` load `.env.test` then `.env.local`,
// and `.env.local` is the Neon dev branch: a missing or incomplete `.env.test`
// silently points two and a half thousand destructive tests at shared cloud
// infrastructure. This refuses that at config load, before anything connects.
//
// Kept dependency-free: both `vitest.config.ts` and `playwright.config.ts`
// import it. `ALLOW_CLOUD_DB=1` is the deliberate escape hatch (for example the
// live integration suite); `scripts/assert-dev-database.mts` still pins the
// destructive scripts to the expected Neon endpoint.

const CLOUD = /neon\.tech|rds\.amazonaws\.com|supabase\.co|supabase\.com|aivencloud\.com|render\.com|railway\.app/i

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname
  } catch {
    return null
  }
}

/// Throws when a test run would reach a cloud database. Names the variable and
/// the host, never the credentials.
export function assertLocalTestDatabase(env: Record<string, string | undefined> = process.env): void {
  if (env.ALLOW_CLOUD_DB === '1') return
  for (const name of ['DATABASE_URL', 'DIRECT_URL'] as const) {
    const url = env[name]
    if (!url) continue
    const host = hostOf(url)
    if (host && CLOUD.test(host)) {
      throw new Error(
        `Refusing to run tests against a cloud database: ${name} points at ${host}. ` +
          'Point .env.test at local Postgres, or set ALLOW_CLOUD_DB=1 to do this deliberately (K12, INV-18).',
      )
    }
  }
}
