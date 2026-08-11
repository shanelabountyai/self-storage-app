import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import { testDatabaseUrl, TEST_SCHEMA } from './scripts/test-db.mts'

// The suite runs against its own Postgres SCHEMA, not against dev's.
//
// They shared `public` until now, which is what leaked a live owner account out
// of an interrupted run and broke every subsequent one — and it is the reason
// CLAUDE.md tells you to run the suite twice before believing it. Set here in
// the config rather than in a globalSetup because vitest spawns workers with
// the env this resolves, so every worker sees it before Prisma connects.
//
// Leaves DATABASE_URL alone when nothing is configured (the `*-db` suites skip
// themselves) and in CI, where the whole database is a throwaway container and
// redirecting would point at a schema nothing created.
const testUrl = testDatabaseUrl()

export default defineConfig({
  resolve: {
    alias: {
      // Mirrors apps/web/tsconfig.json's "@/*" so tests can import app modules
      // the same way the app itself does, without maintaining relative paths.
      '@': fileURLToPath(new URL('./apps/web', import.meta.url)),
    },
  },
  test: {
    env: {
      ...(testUrl ? { DATABASE_URL: testUrl, TEST_DB_SCHEMA: TEST_SCHEMA } : {}),
      // B-080. A fixed key so the ENCRYPTED paths are the ones under test.
      //
      // Without it, everything that stores a secret at rest — gate codes
      // (`unrevealable:` fallback) and B-080's webhook signing secrets —
      // silently takes its degraded branch, and six of the rotation assertions
      // skipped themselves both locally and in CI. A security feature whose
      // tests quietly opt out is worse than one with no tests, because the
      // green run says otherwise.
      //
      // Test-only, published deliberately, and scoped to a throwaway schema —
      // the same posture as the demo credentials. The tests that need the
      // UNconfigured behaviour (access-secret.test.ts) delete it themselves and
      // put it back.
      ACCESS_CODE_ENCRYPTION_KEY:
        process.env.ACCESS_CODE_ENCRYPTION_KEY ??
        '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff',
    },
    // Node by default — the tests the PRDs actually demand (billing/proration
    // math, per master §5) are pure functions. Add jsdom + the React plugin
    // when the first component test shows up.
    environment: 'node',
    // Vitest defaults to 5s, which is fine for the pure-function suites and too
    // tight for the `*-db` ones: those make dozens of sequential round-trips to
    // a REMOTE Postgres (Neon), and a multi-night billing walk can legitimately
    // take six or seven seconds. Under a full parallel run — more so with a dev
    // server and `stripe listen` holding connections — they tipped past 5s and
    // failed for latency rather than for anything they assert. Four did in one
    // afternoon, each passing on its own, which is the signature of a timeout
    // rather than a defect.
    //
    // 20s is headroom, not indulgence: it is still far below anything a genuine
    // hang would need, so a real deadlock still fails the run rather than
    // stalling it.
    testTimeout: 20_000,
    hookTimeout: 30_000,
    include: ['tests/**/*.test.ts', 'apps/**/*.test.ts', 'packages/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/.next/**', 'e2e/**'],
  },
})
