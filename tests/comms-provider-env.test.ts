import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectiveRecipient, selectProvider } from '../apps/web/lib/comms/provider'

// The safety net `.env.example` and PROGRESS.md both promise: outside
// production a real Resend key is used only alongside a sandbox inbox, and
// every recipient is rewritten to it. Vercel builds previews with
// NODE_ENV=production, so NODE_ENV alone could not tell a preview from
// production and the promise was false on the only platform this deploys to.
//
// `vi.stubEnv` rather than assignment: NODE_ENV is a read-only property on
// ProcessEnv, and `npm run typecheck` covers this directory.

beforeEach(() => {
  vi.stubEnv('RESEND_API_KEY', 'test-key')
  vi.stubEnv('COMMS_SANDBOX_INBOX', 'catch-all@sandbox.test')
  // Vercel sets this on every deployment, previews included — the whole trap.
  vi.stubEnv('NODE_ENV', 'production')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('production detection', () => {
  it('treats a Vercel preview as non-production even though NODE_ENV says otherwise', () => {
    vi.stubEnv('VERCEL_ENV', 'preview')
    expect(effectiveRecipient('tenant@real.example')).toBe('catch-all@sandbox.test')
  })

  it('falls back to log-only on a preview with a key but no sandbox inbox', () => {
    vi.stubEnv('VERCEL_ENV', 'preview')
    vi.stubEnv('COMMS_SANDBOX_INBOX', undefined)
    expect(selectProvider().name).toBe('log_only')
  })

  it('sends to the real address on a Vercel production deployment', () => {
    vi.stubEnv('VERCEL_ENV', 'production')
    expect(effectiveRecipient('tenant@real.example')).toBe('tenant@real.example')
  })

  it('still uses NODE_ENV off Vercel, where VERCEL_ENV is unset', () => {
    vi.stubEnv('VERCEL_ENV', undefined)
    expect(effectiveRecipient('tenant@real.example')).toBe('tenant@real.example')
  })
})
