import { afterEach, describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import { demoGate } from '../apps/web/lib/demo-gate'

// The gate is the only thing standing between a not-yet-public deployment and
// the open internet, so the two ways it could fail silently — letting everyone
// through, or locking out the cron and the webhooks — both get an assertion.

/// `demoGate` returns a response to send INSTEAD of handling the request, or
/// null to carry on — so "let through" is null here, not a 200.
function get(path: string, password?: string) {
  return demoGate(
    new NextRequest(`https://example.com${path}`, {
      headers: password ? { authorization: `Basic ${btoa(`x:${password}`)}` } : {},
    }),
  )
}

const PASSWORD = 'correct horse battery staple'

afterEach(() => {
  delete process.env.DEMO_ACCESS_PASSWORD
})

describe('demo access gate', () => {
  it('is inert when no password is configured', () => {
    expect(get('/storage/search')).toBeNull()
  })

  describe('with a password set', () => {
    // Set inside the describe body rather than a beforeEach so the inert case
    // above cannot be affected by ordering.
    const withPassword = <T>(run: () => T): T => {
      process.env.DEMO_ACCESS_PASSWORD = PASSWORD
      return run()
    }

    it('refuses an anonymous request and asks for the password', () => {
      withPassword(() => {
        const response = get('/storage/search')
        expect(response?.status).toBe(401)
        expect(response?.headers.get('www-authenticate')).toContain('Basic')
      })
    })

    // Same length as the real one, deliberately: a short guess is rejected by
    // the length check before the comparison runs, so it proves nothing about
    // the comparison. This is the case that fails if `matches` ever returns
    // true unconditionally.
    it('refuses a wrong password of the same length', () => {
      withPassword(() => {
        const wrong = 'x'.repeat(PASSWORD.length)
        expect(wrong).toHaveLength(PASSWORD.length)
        expect(get('/storage/search', wrong)?.status).toBe(401)
      })
    })

    it('refuses a wrong password of a different length', () => {
      withPassword(() => {
        expect(get('/storage/search', 'wrong')?.status).toBe(401)
      })
    })

    it('lets the right password through', () => {
      withPassword(() => {
        expect(get('/storage/search', PASSWORD)).toBeNull()
      })
    })

    // The failure that would be invisible until the next billing run: the gate
    // silently swallowing the hourly tick and every provider callback. Each of
    // these authenticates itself and must never be behind the password.
    it.each([
      '/api/cron',
      '/api/stripe/webhook',
      '/api/comms/sms-webhook',
      '/api/comms/webhook',
      '/api/hardware/webhook',
      '/api/auth/callback/credentials',
    ])('never gates %s', (path) => {
      withPassword(() => {
        expect(get(path)).toBeNull()
      })
    })

    it('gates the rest of the API, including the public read endpoints', () => {
      withPassword(() => {
        expect(get('/api/public/facilities/austin-south/inventory')?.status).toBe(401)
      })
    })

    // A prefix match instead of a path match would exempt this, and the name is
    // close enough to a real exempt route that nobody would spot it had.
    it('does not exempt a path that merely starts like an exempt one', () => {
      withPassword(() => {
        expect(get('/api/cronjobs-admin')?.status).toBe(401)
      })
    })

    // The challenge is served on every gated path. Without this header, a
    // crawler that reaches one indexes the 401 itself.
    it('tells crawlers not to index the challenge', () => {
      withPassword(() => {
        expect(get('/storage/search')?.headers.get('x-robots-tag')).toBe('noindex, nofollow')
      })
    })

    it('treats a malformed header as a failed attempt rather than a crash', () => {
      withPassword(() => {
        const response = demoGate(
          new NextRequest('https://example.com/storage/search', {
            headers: { authorization: 'Basic !!!not-base64!!!' },
          }),
        )
        expect(response?.status).toBe(401)
      })
    })
  })
})
