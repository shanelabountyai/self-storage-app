import { AdminForm } from '@/components/admin/form'
import { goBackAction } from '@/app/(public)/checkout/actions'
import { STEPS, type Step } from '@/lib/checkout/session'
import { translate, type Dictionary, type MessageKey } from '@/lib/i18n'

// PRD 01 §6.4 and §6.8.1. The progress indicator.

// B-090 part 6: keys, not words. `stepAnnouncement` and the indicator both
// resolve them from the same dictionary, so the spoken announcement and the
// visible step name still cannot drift — which is the reason this map exists.
const STEP_LABELS: Record<Step, MessageKey> = {
  details: 'step.details',
  unit_assign: 'step.unit_assign',
  insurance: 'step.insurance',
  lease: 'step.lease',
  payment: 'step.payment',
  provisioned: 'step.provisioned',
}

/// What a renter is told when a step changes: where they now are, in the same
/// words the indicator below already uses. Lives here so the announcement and
/// the indicator cannot drift apart, and so `CheckoutAnnouncer` — a client
/// component — never has to import `lib/checkout/session` and drag Prisma and
/// `node:crypto` into the browser bundle for the sake of a label.
export function stepAnnouncement(step: Step, dict: Dictionary): string {
  return translate(dict, 'step.announcement', {
    label: translate(dict, STEP_LABELS[step]),
    index: STEPS.indexOf(step) + 1,
    total: STEPS.length,
  })
}

export function labelForStep(step: Step, dict: Dictionary): string {
  return translate(dict, STEP_LABELS[step])
}

export function Stepper({
  current,
  token,
  dict,
}: {
  current: Step
  token?: string
  dict: Dictionary
}) {
  const t = (key: MessageKey, vars?: Record<string, string | number>) =>
    translate(dict, key, vars)
  const currentIndex = STEPS.indexOf(current)
  // Nothing is navigable once the move-in is done: there is no step behind
  // `provisioned` that means anything, and the session is closed anyway.
  const navigable = Boolean(token) && current !== 'provisioned'

  // B-367 (D-146): the kit's `StepIndicator` is a row of numbered circles
  // joined by a line, current one filled. Purely the visible cue — the state
  // a screen reader gets is still the words in the `sr-only` spans below,
  // untouched, and the badge is `aria-hidden` for the same reason the ✓/number
  // always was.
  const badgeClass = (done: boolean, isCurrent: boolean) =>
    `inline-flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-medium ${
      done || isCurrent
        ? 'bg-primary text-primary-foreground'
        : 'bg-secondary text-secondary-foreground'
    }`

  const list = (
    <ol className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
      {STEPS.map((step, index) => {
        const done = index < currentIndex
        const isCurrent = index === currentIndex
        return (
          <li key={step} className="flex items-center gap-3">
            {index > 0 && <span aria-hidden="true" className="bg-border h-px w-4 sm:w-8" />}
            <span className="flex items-center gap-1.5">
              {/* §6.4 / 1.4.1: the state is carried in words, not by colour or
                  position alone. "Step 3 of 6, current" is what a screen reader
                  should hear, and a sighted user with no colour perception gets
                  the same information from the ✓ and the weight. */}
              <span aria-hidden="true" className={badgeClass(done, isCurrent)}>
                {done ? '✓' : index + 1}
              </span>
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
                  {t(STEP_LABELS[step])}
                  <span className="sr-only">
                    {t('step.completedGoBack', { index: index + 1, total: STEPS.length })}
                  </span>
                </button>
              ) : (
                <span
                  aria-current={isCurrent ? 'step' : undefined}
                  className={isCurrent ? 'font-medium' : 'text-muted-foreground'}
                >
                  {t(STEP_LABELS[step])}
                  <span className="sr-only">
                    {t('step.ofTotal', { index: index + 1, total: STEPS.length })}
                    {done
                      ? t('step.completed')
                      : isCurrent
                        ? t('step.current')
                        : t('step.notStarted')}
                  </span>
                </span>
              )}
            </span>
          </li>
        )
      })}
    </ol>
  )

  return (
    <nav aria-label={t('step.progressNav')}>
      {navigable ? (
        // One form around the whole list, with each button carrying its own
        // `to`. Six forms would be six landmarks in a row for no gain.
        <AdminForm action={goBackAction} label={t('step.goBackForm')}>
          <input type="hidden" name="token" value={token} />
          {list}
        </AdminForm>
      ) : (
        list
      )}
    </nav>
  )
}
