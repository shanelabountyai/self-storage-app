'use client'

import { useFormStatus } from 'react-dom'
import { useT } from '@/components/i18n/locale-provider'

// PRD 03 US-8 AC4's accessibility criteria (B-086 part 2). The submit control
// for a phone unlock, and the only reason it is a component of its own.
//
// The default build of an unlock control is an icon button that changes colour
// and pops a toast, which fails four success criteria at once. What this does
// instead:
//
//   * **4.1.2 A** — the in-flight state is `aria-busy`, exposed programmatically
//     rather than implied by a spinner. `aria-pressed` is deliberately NOT used:
//     the AC offers either, and this is a momentary action, not a toggle — a
//     button reported as "pressed" would tell a screen-reader user the gate is
//     currently held open, which is a different and wrong fact.
//   * **1.4.1 A** — the label changes in TEXT while it works, so nothing about
//     the state is carried by colour alone.
//   * **2.1.1 A** — a real <button type="submit">. Nothing here is a div with a
//     click handler.
//   * **2.4.3 A (contested — B-285)** — `aria-busy` and NOT `disabled`.
//     Disabling the element that has focus blurs it to <body> in Chromium, so
//     the tenant who pressed "Open gate" had their next Tab restart from the
//     portal nav — the failure `use-my-location.tsx` and `payment-element.tsx`
//     both document. A second press while the first is in flight is refused
//     by the click handler instead. It reads `pending` rather than a ref: a
//     ref set on click has to be cleared when the submit ends, and a click
//     that never became a submit would leave it set and the button dead.
//     `disabled:opacity-70` went with `disabled` — an enabled button gets no
//     1.4.3 inactive-component exemption.
//
// The outcome is announced from the `AdminForm`'s own pre-existing
// `role="status"` region (4.1.3 AA) rather than one this button inserts — see
// that file's note on why a region has to exist before the event it reports.
// It also means the message is TEXT, which is what a tenant standing outside a
// gate at night actually needs.

export function UnlockButton({ label }: { label: string }) {
  const t = useT()
  const { pending } = useFormStatus()

  return (
    <button
      type="submit"
      aria-busy={pending}
      onClick={(event) => {
        if (pending) event.preventDefault()
      }}
      className="bg-primary text-primary-foreground inline-flex min-h-11 items-center justify-center rounded-md px-4 text-sm font-medium"
    >
      {pending ? t('unlock.opening') : label}
    </button>
  )
}
