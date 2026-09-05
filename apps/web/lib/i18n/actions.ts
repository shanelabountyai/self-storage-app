'use server'

import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { isLocale, LOCALE_COOKIE, LOCALE_COOKIE_DAYS } from './index'

// B-090 part 6. The one write that changes a visitor's language.
//
// A server action rather than a route handler so the toggle is an ordinary
// form submit and works with JavaScript off — the same reason the checkout
// steps are forms. Anything unrecognised in the payload is dropped silently
// instead of setting a cookie that `getLocale()` would then have to fall back
// from on every subsequent request.

export async function setLocaleAction(formData: FormData): Promise<void> {
  const requested = formData.get('locale')
  if (!isLocale(requested)) return

  ;(await cookies()).set(LOCALE_COOKIE, requested, {
    path: '/',
    maxAge: LOCALE_COOKIE_DAYS * 24 * 60 * 60,
    sameSite: 'lax',
    // Deliberately readable by client script and not `secure`-only in dev:
    // this is a display preference, not a credential, and locking it down
    // buys nothing while breaking local HTTP.
    httpOnly: false,
  })

  // Every rendered page carries the language, so the whole layout tree is
  // stale — not just the route the toggle was pressed on. Without this the
  // client router serves the previously-rendered English page on a Back
  // navigation, which reads as the toggle having failed.
  revalidatePath('/', 'layout')
}
