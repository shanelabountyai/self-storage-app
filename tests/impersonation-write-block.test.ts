import { describe, expect, it } from 'vitest'
import {
  IMPERSONATION_COOKIE,
  isImpersonationWriteBlocked,
} from '../apps/web/lib/impersonation/request'

// PRD 09 FR-11/FR-13, SR-2 (B-091 part 2). The read-only control.
//
// It is enforced by METHOD at the edge rather than by a list of blocked
// actions, so what this suite has to pin is the shape of that decision: every
// write refused, every read allowed, and exactly two exempt prefixes — the way
// out, and the way to sign out.

describe('isImpersonationWriteBlocked', () => {
  it('blocks every mutating method while a session cookie is present', () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(isImpersonationWriteBlocked(method, '/portal/methods', true), method).toBe(true)
    }
  })

  it('blocks a server action POST to an admin page, not just an obvious API route', () => {
    // Every server action in this app POSTs to the page that rendered it —
    // which is why the rule is about the method and not about the path.
    expect(isImpersonationWriteBlocked('POST', '/admin/tenants/abc123', true)).toBe(true)
  })

  it('allows reads, which is the entire point of the feature', () => {
    for (const method of ['GET', 'HEAD', 'OPTIONS']) {
      expect(isImpersonationWriteBlocked(method, '/portal', true), method).toBe(false)
    }
  })

  it('does nothing at all when no session is running', () => {
    expect(isImpersonationWriteBlocked('POST', '/portal/methods', false)).toBe(false)
  })

  it('exempts the way out — otherwise the session blocks the thing that ends it', () => {
    expect(isImpersonationWriteBlocked('POST', '/api/impersonation/end', true)).toBe(false)
    expect(isImpersonationWriteBlocked('GET', '/api/impersonation/end', true)).toBe(false)
  })

  it('exempts sign-out, because being unable to sign out is worse than the block', () => {
    expect(isImpersonationWriteBlocked('POST', '/api/auth/signout', true)).toBe(false)
    expect(isImpersonationWriteBlocked('POST', '/api/auth/callback/password', true)).toBe(false)
  })

  it('does not exempt a path that merely starts similarly', () => {
    // A prefix test is only safe while the prefixes end in a slash. Without the
    // trailing slash `/api/authorized-access` would be exempt, and it is a real
    // shape in this codebase (lib/portal/authorized-access.ts).
    expect(isImpersonationWriteBlocked('POST', '/api/authorized-access', true)).toBe(true)
    expect(isImpersonationWriteBlocked('POST', '/api/impersonation-report', true)).toBe(true)
  })

  it('names the cookie the proxy and the start action agree on', () => {
    // Three files read this constant and one writes it; a rename in one place
    // would silently stop blocking writes rather than fail loudly.
    expect(IMPERSONATION_COOKIE).toBe('storage.impersonation')
  })
})
