'use client'

import { useEffect, useState } from 'react'
import { restoreShortfallCents } from '@storage/core/access'
import { formatCents } from '@/lib/format'

// PRD 01 US-703 / D-16 (B-232). "Pay a different amount", with the one
// consequence it never mentioned.
//
// The form said nothing about a partial payment leaving the gate shut — which
// is the wasted trip and the angriest call the office takes: somebody pays what
// they can, drives over, and finds their code still dead. The sentence beside
// the field is that fact, live, while they are choosing the number.
//
// Still a `method="GET"` form. §6.2 wants the portal usable with JavaScript
// off up to the Payment Element itself, so this component adds a sentence to a
// form that already worked rather than replacing it with an action — with
// JavaScript off the note renders for the server's amount and the form submits
// exactly as before.

export function PayAmountForm({
  leaseId,
  amountCents,
  facilityBalanceCents,
  restoreAtOrBelowCents,
  accessSuspended,
}: {
  leaseId: string
  amountCents: number
  facilityBalanceCents: number
  restoreAtOrBelowCents: number
  accessSuspended: boolean
}) {
  const [typed, setTyped] = useState((amountCents / 100).toFixed(2))

  const shortfallCents = restoreShortfallCents({ facilityBalanceCents, restoreAtOrBelowCents })
  // Lenient, like `PaymentPlanBuilder`'s: a half-typed "43." contributes
  // nothing and the note reads as it did, rather than flashing at somebody
  // mid-keystroke. The server validates the real figure.
  const parsed = Number.parseFloat(typed)
  const payingCents = Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) : 0

  const note = !accessSuspended
    ? ''
    : payingCents >= shortfallCents
      ? `${formatCents(payingCents)} reopens your gate, usually within a couple of minutes.`
      : `${formatCents(payingCents)} will not reopen your gate. ${formatCents(shortfallCents)} will.`

  // B-248's delay, for B-248's reason: typing "437.50" mutates `note` six
  // times, and a polite region does not coalesce those — NVDA queues each text
  // change and JAWS speaks them. One field edit, one announcement.
  const [settled, setSettled] = useState(note)
  useEffect(() => {
    const timer = setTimeout(() => setSettled(note), 700)
    return () => clearTimeout(timer)
  }, [note])

  return (
    <form method="GET" className="mt-3 flex flex-col gap-3">
      <input type="hidden" name="lease" value={leaseId} />
      <label className="flex flex-col gap-1 text-sm">
        Amount in dollars
        <input
          name="amount"
          type="text"
          inputMode="decimal"
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          className="border-input bg-background h-9 rounded-md border px-2"
        />
      </label>
      {/* Rendered unconditionally and empty when there is nothing to say. A
          live region inserted into the DOM already populated is unreliably
          announced by VoiceOver and routinely missed by NVDA — it has to
          pre-exist the event it reports (4.1.3, and the same rule `AdminForm`
          states for every admin form in the product). */}
      <p role="status" className="text-sm font-medium text-pretty">
        {settled}
      </p>
      <button
        type="submit"
        className="border-input hover:bg-accent inline-flex min-h-11 items-center justify-center rounded-md border px-4 text-sm font-medium"
      >
        Update amount
      </button>
    </form>
  )
}
