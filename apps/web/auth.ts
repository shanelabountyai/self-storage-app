import NextAuth from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import {
  authenticateWithPassword,
  loadSubject,
  LoginThrottledError,
  sessionStillValid,
} from '@/lib/auth/accounts'
import { consumeToken } from '@/lib/auth/tokens'
import { authConfig, audienceOf } from './auth.config'

function clientIp(request: Request | undefined): string | null {
  const forwarded = request?.headers.get('x-forwarded-for')
  return forwarded ? forwarded.split(',')[0].trim() : null
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  ...authConfig,
  callbacks: {
    ...authConfig.callbacks,
    // SEC-03. Returning null ends the session for every `auth()` caller at
    // once — currentActor, the portal layout, re-auth — rather than in the ones
    // somebody remembered. It lives here and not in auth.config.ts because it
    // reads the database, which the Edge proxy cannot; the proxy therefore
    // still lets a revoked cookie through to a page, and the page refuses it.
    async jwt(params) {
      const token = await authConfig.callbacks.jwt(params)
      const authenticatedAt =
        typeof token.authAt === 'number' ? token.authAt : Number(token.authTime ?? 0) * 1000
      const valid =
        typeof token.id === 'string' &&
        (await sessionStillValid(token.id, audienceOf(token.audience), authenticatedAt))
      return valid ? token : null
    },
  },
  providers: [
    Credentials({
      id: 'password',
      name: 'Email and password',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
        audience: { label: 'Audience', type: 'text' },
        // B-079. A TOTP code or a recovery code. Required for staff who have
        // enrolled; ignored for tenants and for staff who have not.
        code: { label: 'Authentication code', type: 'text' },
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
            credentials?.code == null ? null : String(credentials.code),
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

        // B-079. flows.ts refuses to MINT a staff magic link; this refuses to
        // spend one. Both, because a link minted before this shipped is still
        // sitting in somebody's inbox, and possession of an inbox is precisely
        // the second factor the password path now insists on.
        if (consumed.audience === 'staff') return null

        const subject = await loadSubject(consumed.subjectId, consumed.audience)
        return subject ? { ...subject, name: subject.name } : null
      },
    }),
  ],
})
