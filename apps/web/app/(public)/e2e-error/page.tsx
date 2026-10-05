import { notFound } from 'next/navigation'
import { connection } from 'next/server'

// B-435. The one way a spec can reach `error.tsx` on a production build: the
// e2e server sets `E2E_FORCE_ERROR` (playwright.config.ts) and this throws.
// Anywhere else the variable is unset and the route is a 404.
export default async function E2eError() {
  // Read the variable per request, never at build time.
  await connection()
  if (process.env.E2E_FORCE_ERROR !== '1') notFound()
  throw new Error('forced by E2E_FORCE_ERROR')
}
