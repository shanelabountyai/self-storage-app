'use server'

import { AuthError } from 'next-auth'
import { signIn } from '@/auth'
import { checkLoginThrottle } from '@/lib/auth/rate-limit'
import { audienceFor, safeRedirectTarget } from '@/lib/auth/login-audience'
import { requestMetadata } from '@/lib/http/request-metadata'
import { fieldError, success, type FormState } from '@/lib/admin/form-state'

// PRD 01 US-701. One shared page, two audiences (lib/auth/login-audience.ts),
// on top of the auth endpoints B-003 already built.
//
// Split from magic-link-actions.ts (which handles requestMagicLinkAction) on
// purpose, not just by convention: anything that imports `signIn`/`auth` from
// `@/auth` — as this file does — cannot be imported at all under Vitest
// (next-auth@5.0.0-beta.32's internals reference `next/server` as a bare
// specifier, which Node's strict ESM resolution refuses even though Next's
// own bundler resolves it fine). Keeping the next-auth-free action in its own
// file is what lets it be unit-tested directly.

export async function signInWithPasswordAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const email = String(formData.get('email') ?? '').trim()
  const password = String(formData.get('password') ?? '')
  const from = String(formData.get('from') ?? '') || undefined
  const audience = audienceFor(from)
  const redirectTo = safeRedirectTarget(from, audience)

  if (!email || !password) {
    return fieldError({
      ...(email ? {} : { email: 'Enter your email address.' }),
      ...(password ? {} : { password: 'Enter your password.' }),
    })
  }

  // Checked here, ahead of signIn(): Auth.js sanitises everything an
  // authorize() throws or returns into one generic "CredentialsSignin" before
  // it reaches this action, which is right for "wrong password" (nothing to
  // enumerate) but wrong for a lockout — accounts.ts's own doc comment is
  // explicit that a throttled attempt "must be told", and that distinction
  // would be lost once it round-trips through Auth.js's error normalisation.
  const throttle = await checkLoginThrottle(email, audience, (await requestMetadata()).ipAddress)
  if (!throttle.allowed) {
    const minutes = Math.ceil(throttle.retryAfterMs / 60_000)
    return fieldError({
      password: `Too many attempts. Try again in about ${minutes} minute${minutes === 1 ? '' : 's'}.`,
    })
  }

  try {
    await signIn('password', { email, password, audience, redirectTo })
  } catch (error) {
    if (error instanceof AuthError) {
      // Deliberately generic: authenticateWithPassword() already returns null
      // (rather than distinguishing "no such account" from "wrong password")
      // specifically so there is nothing here to enumerate either.
      return fieldError({ password: 'Incorrect email or password.' })
    }
    throw error // includes Next's own redirect signal on success — must propagate
  }

  return success('Signed in.')
}
