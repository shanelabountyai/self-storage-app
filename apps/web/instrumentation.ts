// K11. Next runs `register()` once when a server instance boots. Validating the
// environment here makes a missing DATABASE_URL or AUTH_SECRET, or a malformed
// value, fail the boot with the key named, rather than the first request that
// happens to read it.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  const { parseEnv } = await import('./lib/env')
  parseEnv(process.env)
}
