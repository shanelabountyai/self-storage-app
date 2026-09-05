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
      disabled={pending}
      className="bg-primary text-primary-foreground inline-flex min-h-11 items-center justify-center rounded-md px-4 text-sm font-medium disabled:opacity-70"
    >
      {pending ? t('unlock.opening') : label}
    </button>
  )
}
