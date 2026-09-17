'use client'

import { AdminForm } from '@/components/admin/form'
import { printLetterAction } from '@/app/admin/messages/actions'

// B-318. One control, because printing and recording are one act.
//
// The task this closes says a tenant has not been told. A second button reading
// "mark it mailed", pressed separately, is the typed note the catalog now
// refuses wearing different clothes — so the browser's print dialog and the
// completion are the same press: `window.print()` runs on the click, the form
// submits behind it.
//
// The ceiling, and it is the browser's: nothing reports whether the dialog was
// dismissed or the paper actually came out, so cancelling the dialog still
// records the letter. That is the same standard as every other manual task in
// this queue — a staffer saying a physical thing happened — and it is strictly
// better than the note it replaces, which did not even require the reader to
// have opened the letter.
export function PrintLetterButton({
  messageId,
  tenantName,
  closesTask,
}: {
  messageId: string
  tenantName: string
  /// Whether an open `no_reachable_channel` task is waiting on this. The label
  /// says which act is about to happen — a reprint months later must not read
  /// as closing something.
  closesTask: boolean
}) {
  return (
    <AdminForm
      action={printLetterAction}
      label={`Print the letter for ${tenantName}`}
      className="flex flex-col gap-2 print:hidden"
    >
      <input type="hidden" name="messageId" value={messageId} />
      <button
        type="submit"
        onClick={() => window.print()}
        aria-label={
          closesTask
            ? `Print this letter for ${tenantName} and close the task`
            : `Print this letter for ${tenantName}`
        }
        className="border-input hover:bg-accent inline-flex min-h-11 w-fit items-center rounded-md border px-4 text-sm font-medium"
      >
        {closesTask ? 'Print it, and close the task' : 'Print this letter'}
      </button>
    </AdminForm>
  )
}
