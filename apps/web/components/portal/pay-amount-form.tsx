'use client'

import { useEffect, useState } from 'react'
import { restoreShortfallCents } from '@storage/core/access'
import { formatCents } from '@/lib/format'
import { useT } from '@/components/i18n/locale-provider'

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
  subject,
  amountValue,
  problemId,
  facilityBalanceCents,
  restoreAtOrBelowCents,
  accessSuspended,
}: {
  /// B-256. What is being paid, as the query parameter the page reads back:
  /// one lease, or a whole business account. It was a bare `leaseId`, which
  /// re-submitted an account payment as a payment for its anchor unit — a
  /// different and much smaller bill than the one on the screen.
  subject: { field: 'lease' | 'account'; id: string }
  /// B-302. The dollars string the field starts on, decided by the page: the
  /// accepted amount, or — when the amount was refused — what was typed,
  /// unchanged. It used to be the cents figure the page had already fallen back
  /// to, so a refusal replaced the tenant's number with the whole balance.
  amountValue: string
  /// B-302. The id of the paragraph refusing this amount, or `undefined` when
  /// nothing was refused. Present means the field is invalid and is described
  /// by that paragraph — the refusal renders outside this form, so a reader
  /// arriving at the control by form navigation was told nothing (SC 3.3.1,
  /// PRD 01 §6.8: "a summary block alone is not enough").
  problemId?: string
  facilityBalanceCents: number
  restoreAtOrBelowCents: number
  accessSuspended: boolean
}) {
  const t = useT()
  const [typed, setTyped] = useState(amountValue)

  const shortfallCents = restoreShortfallCents({ facilityBalanceCents, restoreAtOrBelowCents })
  // Lenient, like `PaymentPlanBuilder`'s: a half-typed "43." contributes
  // nothing and the note reads as it did, rather than flashing at somebody
  // mid-keystroke. The server validates the real figure.
  const parsed = Number.parseFloat(typed)
  const payingCents = Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) : 0

  // B-302. While the box still holds the figure the SERVER refused, nothing is
  // going to be charged — so the note must not price it. Echoing the refused
  // amount back (3.3.3) without this made `?amount=999999` render "paying
  // $999,999.00 reopens your gate" beside a paragraph refusing that very
  // amount, which `e2e/portal.spec.ts`'s fat-finger test caught. It returns the
  // moment the tenant edits the field, which is the moment there is a new
  // number to price.
  const refusedAsTyped = problemId !== undefined && typed === amountValue

  const note = !accessSuspended || refusedAsTyped
    ? ''
    : payingCents >= shortfallCents
      ? t('amtform.reopens', { amount: formatCents(payingCents) })
      : t('amtform.willNotReopen', {
          amount: formatCents(payingCents),
          needed: formatCents(shortfallCents),
        })

  // B-248's delay, for B-248's reason: typing "437.50" mutates `note` six
  // times, and a polite region does not coalesce those — NVDA queues each text
  // change and JAWS speaks them. One field edit, one announcement.
  const [settled, setSettled] = useState(note)
  useEffect(() => {
    const timer = setTimeout(() => setSettled(note), 700)
    return () => clearTimeout(timer)
  }, [note])

  // B-299. The `action` is a BARE FRAGMENT, which resolves to this page: a GET
  // submit replaces the URL's query with the form data and keeps the fragment,
  // so a refused amount lands on `#amount-problem` and the browser's own
  // fragment navigation focuses the refusal (2.4.3). Relative, so this
  // component does not hard-code the route it is mounted on, and it needs no
  // JavaScript — which is the point, because this form is the one §6.2 wants
  // working without any.
  return (
    <form method="GET" action="#amount-problem" className="mt-3 flex flex-col gap-3">
      <input type="hidden" name={subject.field} value={subject.id} />
      <label className="flex flex-col gap-1 text-sm">
        {t('amtform.label')}
        <input
          name="amount"
          type="text"
          inputMode="decimal"
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          aria-invalid={problemId ? true : undefined}
          aria-describedby={problemId}
          className="border-input bg-background h-(--control-h,2.75rem) rounded-md border px-2"
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
        {t('amtform.update')}
      </button>
    </form>
  )
}
