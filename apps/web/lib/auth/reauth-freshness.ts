// Pure freshness math, deliberately split from reauth.ts: that file imports
// `auth` from the app's NextAuth instance, which is not resolvable outside a
// real Next.js build/runtime context — importing it at all (even for an
// unrelated export) breaks a plain Node test. This file has no such import, so
// it can be tested directly.

/// How long a sign-in counts as "fresh" before a sensitive action needs to
/// re-verify (PRD 01 US-701). 15 minutes: long enough to finish one task
/// without re-proving identity mid-flow, short enough that a laptop left
/// signed in on a 30-day session is not a standing bypass.
export const REAUTH_FRESH_SECONDS = 15 * 60

export function isFreshlyAuthenticated(authTimeSeconds: number, now: Date = new Date()): boolean {
  return now.getTime() / 1000 - authTimeSeconds < REAUTH_FRESH_SECONDS
}
