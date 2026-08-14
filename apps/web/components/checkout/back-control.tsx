import { AdminForm } from '@/components/admin/form'
import { goBackAction } from '@/app/(public)/checkout/actions'

// PRD 01 §6.4: "back navigation never loses data".
//
// Rendered by the page beside each step rather than inside the step's own form,
// because a form cannot nest inside a form and every step's Continue already
// owns one. It sits directly below Continue, at the same height and the same
// full-width-on-mobile shape, and immediately after it in the tab order — the
// requirement is that going back is as reachable as going on, not that the two
// share a flex row.
//
// It says where it goes, not just "Back". A control whose accessible name is
// one word forces a screen-reader user to work out the destination from the
// step they are on, which is the information they are least likely to have.

export function BackControl({
  token,
  to,
  label,
  note,
}: {
  token: string
  to: string
  label: string
  /// The payment step's reassurance. §6.4's own example of a control that has
  /// to say what it does: at the screen holding a card form, "Back" without
  /// "nothing has been charged" reads as abandoning a payment in progress.
  note?: string
}) {
  return (
    <AdminForm action={goBackAction} label={label} className="mt-4">
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="to" value={to} />
      <button
        type="submit"
        className="border-input hover:bg-accent inline-flex min-h-11 w-full items-center justify-center rounded-md border px-4 text-base font-medium sm:w-auto"
      >
        {label}
      </button>
      {note && <p className="text-muted-foreground mt-2 text-sm text-pretty">{note}</p>}
    </AdminForm>
  )
}
