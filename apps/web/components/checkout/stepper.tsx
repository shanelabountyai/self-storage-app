import { AdminForm } from '@/components/admin/form'
import { goBackAction } from '@/app/(public)/checkout/actions'
import { STEPS, type Step } from '@/lib/checkout/session'

// PRD 01 §6.4 and §6.8.1. The progress indicator.

const STEP_LABELS: Record<Step, string> = {
  details: 'Your details',
  unit_assign: 'Your unit',
  insurance: 'Protection',
  lease: 'Lease',
  payment: 'Payment',
  provisioned: 'Done',
}

/// What a renter is told when a step changes: where they now are, in the same
/// words the indicator below already uses. Lives here so the announcement and
/// the indicator cannot drift apart, and so `CheckoutAnnouncer` — a client
/// component — never has to import `lib/checkout/session` and drag Prisma and
/// `node:crypto` into the browser bundle for the sake of a label.
export function stepAnnouncement(step: Step): string {
  return `${STEP_LABELS[step]} — step ${STEPS.indexOf(step) + 1} of ${STEPS.length}`
}

export function labelForStep(step: Step): string {
  return STEP_LABELS[step]
}

export function Stepper({ current, token }: { current: Step; token?: string }) {
  const currentIndex = STEPS.indexOf(current)
  // Nothing is navigable once the move-in is done: there is no step behind
  // `provisioned` that means anything, and the session is closed anyway.
  const navigable = Boolean(token) && current !== 'provisioned'

  const list = (
    <ol className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
      {STEPS.map((step, index) => {
        const done = index < currentIndex
        const isCurrent = index === currentIndex
        return (
          <li key={step} className="flex items-center gap-1">
            {/* §6.4 / 1.4.1: the state is carried in words, not by colour or
                position alone. "Step 3 of 6, current" is what a screen reader
                should hear, and a sighted user with no colour perception gets
                the same information from the ✓ and the weight. */}
            <span aria-hidden="true">{done ? '✓' : `${index + 1}.`}</span>
            {done && navigable ? (
              // A completed step is a state change on the server, so it is a
              // submit button and not an <a>. It is styled as a link because
              // that is what it behaves like to the renter, but a GET that
              // moves the machine backwards would be a mutation any prefetch,
              // crawler or middle-box could fire.
              <button
                type="submit"
                name="to"
                value={step}
                className="min-h-11 underline underline-offset-4"
              >
                {STEP_LABELS[step]}
                <span className="sr-only">
                  {' '}
                  — step {index + 1} of {STEPS.length}, completed. Go back to this step.
                </span>
              </button>
            ) : (
              <span
                aria-current={isCurrent ? 'step' : undefined}
                className={isCurrent ? 'font-medium' : 'text-muted-foreground'}
              >
                {STEP_LABELS[step]}
                <span className="sr-only">
                  {' '}
                  — step {index + 1} of {STEPS.length}
                  {done ? ', completed' : isCurrent ? ', current step' : ', not started'}
                </span>
              </span>
            )}
          </li>
        )
      })}
    </ol>
  )

  return (
    <nav aria-label="Checkout progress">
      {navigable ? (
        // One form around the whole list, with each button carrying its own
        // `to`. Six forms would be six landmarks in a row for no gain.
        <AdminForm action={goBackAction} label="Go back to a completed step">
          <input type="hidden" name="token" value={token} />
          {list}
        </AdminForm>
      ) : (
        list
      )}
    </nav>
  )
}
