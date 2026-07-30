import NextAuth, { type DefaultSession } from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import type { AuthAudience } from '@storage/db'
import { authenticateWithPassword, loadSubject, LoginThrottledError } from '@/lib/auth/accounts'
import { consumeToken } from '@/lib/auth/tokens'

declare module 'next-auth' {
  interface Session {
    user: { id: string; audience: AuthAudience } & DefaultSession['user']
  }
}

function audienceOf(value: unknown): AuthAudience {
  return value === 'staff' ? 'staff' : 'tenant'
}

function clientIp(request: Request | undefined): string | null {
  const forwarded = request?.headers.get('x-forwarded-for')
  return forwarded ? forwarded.split(',')[0].trim() : null
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  // JWT rather than database sessions: the Credentials provider requires it,
  // and it keeps every request off the database for session lookup.
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
      name: 'storage.session',
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
  providers: [
    Credentials({
      id: 'password',
      name: 'Email and password',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
        audience: { label: 'Audience', type: 'text' },
      },
      async authorize(credentials, request) {
        const email = String(credentials?.email ?? '')
        const password = String(credentials?.password ?? '')
        if (!email || !password) return null

        try {
          const subject = await authenticateWithPassword(
            email,
            password,
            audienceOf(credentials?.audience),
            clientIp(request),
          )
          return subject ? { ...subject, name: subject.name } : null
        } catch (error) {
          if (error instanceof LoginThrottledError) {
            // Surfaces to the client as a distinct error so the UI can say
            // "try again later" instead of "wrong password".
            throw error
          }
          throw error
        }
      },
    }),

    Credentials({
      id: 'magic-link',
      name: 'Magic link',
      credentials: { token: { label: 'Token', type: 'text' } },
      async authorize(credentials) {
        const token = String(credentials?.token ?? '')
        if (!token) return null

        // Single-use and expiry are enforced inside consumeToken.
        const consumed = await consumeToken(token, 'magic_link')
        if (!consumed) return null

        const subject = await loadSubject(consumed.subjectId, consumed.audience)
        return subject ? { ...subject, name: subject.name } : null
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id
        token.audience = (user as { audience?: AuthAudience }).audience ?? 'tenant'
      }
      return token
    },
    async session({ session, token }) {
      session.user.id = String(token.id)
      session.user.audience = audienceOf(token.audience)
      return session
    },
  },
})
