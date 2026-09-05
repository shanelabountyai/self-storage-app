'use client'

import { useEffect, useRef, useState } from 'react'
import { useT } from '@/components/i18n/locale-provider'

// PRD 01 §6.8.1 / 4.1.3, 2.4.3. What tells a renter that a step changed.
//
// Every step's own form used to carry its own success message, inside the
// `<section>` the step renders into. `revalidatePath('/checkout')` unmounts
// that section on the same render that would have announced it, so the message
// was returned by the action, rendered by nobody, and heard by nobody — five
// times over, once per step. The heading was prepared for focus (`tabIndex={-1}`)
// and never given it either, so a renter who pressed Continue was left at a
// submit button that no longer existed, on a page whose content had silently
// swapped underneath them.
//
// So the region lives HERE: above the step, outside everything conditional, on
// a component that survives the transition it is reporting. It is driven by the
// server's own props rather than by a form result, which is what makes it work
// across the unmount — the previous values are client state, the new ones
// arrive with the re-render.

export function CheckoutAnnouncer({
  step,
  stepLabel,
  lockExpiresAt,
  lapsed,
  sizeLabel,
}: {
  step: string
  /// The destination, in the words the progress indicator uses: "Your unit —
  /// step 2 of 6". Where they are, not that something happened.
  stepLabel: string
  lockExpiresAt: string
  lapsed: boolean
  /// B-172. The size the session is on, in SPOKEN form ("10 foot by 15 foot
  /// Large") — this lands in an announcement, where "10 × 15" is read as
  /// "10 times 15". Recovering from a lost unit can now change it, so the
  /// sentence below has to be able to tell which recovery happened.
  sizeLabel: string
}) {
  const t = useT()
  const [message, setMessage] = useState('')
  const region = useRef<HTMLParagraphElement>(null)
  const previous = useRef<{
    step: string
    lockExpiresAt: string
    lapsed: boolean
    sizeLabel: string
  } | null>(null)

  useEffect(() => {
    // Marks the region live, and it is not decoration. Until this component has
    // hydrated, Continue submits as a plain HTML form post — Next's progressive
    // enhancement, which is why the flow works with the bundle disabled at all
    // — and that is a full document load, so nothing here announces and nothing
    // moves focus. That degrades acceptably (the browser loads a new page and a
    // screen reader reads it), but it means "the announcer is attached" and
    // "the announcer will announce" are different facts, and a test that cannot
    // tell them apart passes on a warm server and fails on a cold one.
    region.current?.setAttribute('data-live', 'true')

    const prior = previous.current
    previous.current = { step, lockExpiresAt, lapsed, sizeLabel }

    // The first render is the page arriving, not a transition. Announcing here
    // would talk over the heading and the progress indicator, and moving focus
    // would drop a renter who followed a resume link past both of them.
    if (!prior) return

    if (prior.lapsed && !lapsed) {
      // B-172. Two different recoveries reach here now, and saying "the same
      // size" after `relockAtSize` has moved somebody onto a 10×15 would be the
      // announcement contradicting the screen — on the branch whose whole
      // problem was copy that did not match what the product could do.
      setMessage(
        prior.sizeLabel !== sizeLabel
          ? t('announce.movedToSize', { size: sizeLabel })
          : t('announce.foundSameSize'),
      )
    } else if (prior.step !== step) {
      setMessage(stepLabel)
    } else if (prior.lockExpiresAt !== lockExpiresAt) {
      // The hold was extended. The renter never left the step, so nothing moves
      // their focus — they are mid-lease and reading.
      setMessage(t('announce.heldAnother30'))
      return
    } else {
      return
    }

    // 2.4.3: focus follows the change it announced, so the next Tab is into the
    // new step rather than back at the top of the document.
    document.getElementById('step')?.focus()
    // `t` is stable for the life of a render tree — the dictionary only
    // changes when the language does, which is a full navigation — so it is
    // deliberately not a dependency: adding it would re-run this effect on
    // every render and re-announce a step the renter is already on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, stepLabel, lockExpiresAt, lapsed, sizeLabel])

  // Rendered unconditionally and empty, then written into. A live region
  // inserted already populated is unreliably announced by VoiceOver and
  // routinely missed by NVDA. Visually silent because the change is already
  // obvious on screen — the heading, the progress indicator and the summary all
  // moved.
  return (
    <p ref={region} role="status" className="sr-only">
      {message}
    </p>
  )
}
