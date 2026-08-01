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

export function Stepper({ current }: { current: Step }) {
  const currentIndex = STEPS.indexOf(current)

  return (
    <nav aria-label="Checkout progress">
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
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
