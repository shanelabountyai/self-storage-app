import type { DefaultSession, NextAuthConfig } from 'next-auth'
import type { AuthAudience } from '@storage/db'

declare module 'next-auth' {
  interface Session {
    user: { id: string; audience: AuthAudience; authTime: number } & DefaultSession['user']
  }
}

export function audienceOf(value: unknown): AuthAudience {
  return value === 'staff' ? 'staff' : 'tenant'
}

/// The session cookie's name. Exported so the e2e sign-in helper can assert it
/// was actually set rather than trusting a status code — the two disagreed, and
/// a rejected sign-in saved as a success cost one sweep 87 failures.
export const SESSION_COOKIE = 'storage.session'

/// Edge-safe subset of the Auth.js config: no providers, so nothing here pulls
/// in @storage/db's Prisma client, which needs the Node runtime and breaks the
/// Edge Middleware build. Middleware builds its own NextAuth instance from
/// this directly; auth.ts extends it with the providers that do the real
/// (Node-only, DB-backed) authentication work.
export const authConfig = {
  session: {
    strategy: 'jwt',
    // 30 days on trusted devices (PRD 01 US-701). Sensitive actions re-verify
    // separately; that check lands with the flows that need it.
    maxAge: 30 * 24 * 60 * 60,
  },
  // httpOnly + SameSite=Lax + Secure in production are Auth.js defaults and
  // satisfy PRD 01 FR-5.2; they are spelled out here so a future edit is visible.
  cookies: {
    sessionToken: {
      name: SESSION_COOKIE,
      options: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: process.env.NODE_ENV === 'production',
      },
    },
  },
  pages: {
    // The portal sign-in screen is B-033; until then Auth.js renders its own.
    signIn: '/login',
  },
  providers: [],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id
        token.audience = (user as { audience?: AuthAudience }).audience ?? 'tenant'
        // A custom jwt callback replaces Auth.js's default field copying, so
        // name/email must be carried onto the token explicitly or every admin
        // screen that displays "signed in as ___" sees undefined.
        token.name = user.name ?? null
        token.email = user.email ?? null
        // B-033's re-auth freshness check (lib/auth/reauth.ts) needs "when did
        // this person last actually authenticate" — which is NOT the JWT's own
        // `iat`. Auth.js silently re-issues the token (refreshing `iat`) as the
        // session rolls forward per `session.updateAge`, with no new sign-in
        // involved. This block only runs when `user` is present, which only
        // happens on a real `signIn()` call — a fresh password entry or a
        // freshly consumed magic link, never a background token refresh.
        token.authTime = Math.floor(Date.now() / 1000)
      }
      return token
    },
    async session({ session, token }) {
      session.user.id = String(token.id)
      session.user.audience = audienceOf(token.audience)
      session.user.name = (token.name as string | null) ?? null
      session.user.email = (token.email as string | null) ?? session.user.email
      session.user.authTime = typeof token.authTime === 'number' ? token.authTime : 0
      return session
    },
  },
} satisfies NextAuthConfig
