'use client'

import { useEffect, useState } from 'react'
import { AdminForm } from '@/components/admin/form'
import { extendLockAction } from '@/app/(public)/checkout/actions'
import { useT } from '@/components/i18n/locale-provider'

// 2.2.1 Timing Adjustable. The T-5-minute warning on the 30-minute unit lock.
//
// This was computed on the server at render time, which meant it appeared only
// if the renter happened to submit a step inside the last five minutes. On the
// lease step — the longest read in the flow, and the one with no reason to
// submit anything until the signature — that is never: the page renders once at
// T-30 and the next thing that touches the server is the sign. The renter was
// warned by the lock lapsing.
//
// A client timer is the only thing that can see the clock move on a page nobody
// is submitting. The server's own verdict is the initial state, so the warning
// still renders with the bundle disabled, and hydration has nothing to disagree
// about.
//
// The extension stays an explicit control rather than a silent heartbeat: a
// screen-reader user reading a long lease generates no interaction events, and
// an idle-based renewal would drop precisely them.

function minutesLeft(expiresAt: number): number {
  return Math.max(0, Math.round((expiresAt - Date.now()) / 60_000))
}

export function LockWarning({
  token,
  lockExpiresAt,
  warningMinutes,
  initialRemaining,
}: {
  token: string
  lockExpiresAt: string
  warningMinutes: number
  /// The server's own count at render time. Being the initial state is what
  /// keeps the no-JavaScript render and the hydrated one identical.
  initialRemaining: number
}) {
  const t = useT()
  const [remaining, setRemaining] = useState(initialRemaining)
  const due = remaining <= warningMinutes

  useEffect(() => {
    const expiresAt = new Date(lockExpiresAt).getTime()
    const tick = () => setRemaining(minutesLeft(expiresAt))
    tick()
    const timer = setInterval(tick, 15_000)
    return () => clearInterval(timer)
  }, [lockExpiresAt])

  // Derived from `due` alone, deliberately, so it is written once when the
  // warning becomes due and NOT rewritten as the count falls. A live region
  // that restates itself every minute is a screen reader interrupting a renter
  // mid-lease, over and over — which is why the minutes live in the ordinary
  // paragraph below and this sentence does not name them.
  const announcement = due ? t('lock.announcement') : ''

  return (
    <>
      {/* Pre-mounted and empty so the warning arriving is a mutation the screen
          reader announces, not a node inserted with its text already inside. */}
      <p role="status" className="sr-only">
        {announcement}
      </p>

      {due && (
        <section aria-labelledby="lock" className="border-input mt-6 rounded-lg border p-4">
          <h2 id="lock" className="text-base font-medium">
            {t('lock.stillThere')}
          </h2>
          {/* Not a live region: the sr-only paragraph above says this once, and
              this one changes every minute. */}
          <p className="mt-1 text-sm text-pretty">
            {remaining > 0
              ? t(remaining === 1 ? 'lock.holdingOne' : 'lock.holdingOther', {
                  count: remaining,
                })
              : t('lock.underAMinute')}{' '}
            {t('lock.reassurance')}
          </p>
          <AdminForm action={extendLockAction} label={t('lock.keepFormLabel')} className="mt-3">
            <input type="hidden" name="token" value={token} />
            <button
              type="submit"
              className="border-input hover:bg-accent inline-flex min-h-11 items-center rounded-md border px-4 text-sm font-medium"
            >
              {t('lock.keepAnother30')}
            </button>
          </AdminForm>
        </section>
      )}
    </>
  )
}
