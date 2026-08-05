'use server'

import { AuthError } from 'next-auth'
import { auth, signIn } from '@/auth'
import { checkLoginThrottle } from '@/lib/auth/rate-limit'
import { requestMagicLink } from '@/lib/auth/flows'
import { safeRedirectTarget } from '@/lib/auth/login-audience'
import { requestMetadata } from '@/lib/http/request-metadata'
import { fieldError, success, type FormState } from '@/lib/admin/form-state'

// PRD 01 US-701's "sensitive actions... re-verify by fresh login or emailed
// code" — confirming a live sensitive-action page rather than the ordinary
// sign-in flow, so this reads the audience/email from the *current* session
// instead of inferring one from a redirect (lib/auth/login-audience.ts's job
// on /login) and refuses outright if there is no session to confirm.

export async function reauthWithPasswordAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await auth()
  if (!session?.user?.email) {
    return fieldError({ password: 'Your session has expired. Sign in again.' })
  }

  const password = String(formData.get('password') ?? '')
  const redirectTo = safeRedirectTarget(String(formData.get('redirect') ?? '') || undefined, session.user.audience)
  if (!password) return fieldError({ password: 'Enter your password.' })

  const throttle = await checkLoginThrottle(
    session.user.email,
    session.user.audience,
    (await requestMetadata()).ipAddress,
  )
  if (!throttle.allowed) {
    const minutes = Math.ceil(throttle.retryAfterMs / 60_000)
    return fieldError({
      password: `Too many attempts. Try again in about ${minutes} minute${minutes === 1 ? '' : 's'}.`,
    })
  }

  try {
    // A fresh signIn() re-runs the `jwt` callback's `user` branch, which is
    // exactly what stamps a new `authTime` (auth.config.ts) — the thing
    // `checkFreshAuth` (lib/auth/reauth.ts) actually reads.
    await signIn('password', {
      email: session.user.email,
      password,
      audience: session.user.audience,
      redirectTo,
    })
  } catch (error) {
    if (error instanceof AuthError) return fieldError({ password: 'Incorrect password.' })
    throw error
  }

  return success('Confirmed.')
}

// The redirect target that survives the password path (below, same page, no
// round trip) does not survive this one — `requestMagicLink` (lib/auth/
// flows.ts) does not thread a destination through the emailed link, so
// consuming it lands on the audience's default page, not back on the
// specific sensitive action that asked for re-auth (left behind, PROGRESS.md).
export async function reauthWithMagicLinkAction(): Promise<FormState> {
  const session = await auth()
  if (!session?.user?.email) {
    return fieldError({ password: 'Your session has expired. Sign in again.' })
  }

  await requestMagicLink(session.user.email, session.user.audience, (await requestMetadata()).ipAddress)

  return success('Check your email for a link. Opening it confirms it is you and signs you back in.')
}
