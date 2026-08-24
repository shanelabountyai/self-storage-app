'use client'

import { useEffect, useRef } from 'react'
import type { FormState } from '@/lib/admin/form-state'

// B-148 / PRD 01 §6.8.1, PRD 04 US-8. The announcement wrapper the two public
// marketing forms share.
//
// Both had the same two defects, and they are the ones `AdminForm` documents at
// length and B-111 fixed product-wide — these two surfaces are simply where the
// fix never reached, because neither is built on `AdminForm`.
//
// 1. **4.1.3.** Each rendered its `role="status"` paragraph only in the success
//    branch, so the region was INSERTED already populated. A live region that
//    appears carrying its own message is unreliably announced by VoiceOver and
//    routinely missed by NVDA: the region has to pre-exist the event it
//    reports. Here it is mounted at page load and empty, and success writes
//    into it — a mutation, which is what a screen reader watches for.
//
// 2. **2.4.3.** On success both replaced the whole form, which unmounts the
//    submit button the user was standing on and drops focus to `<body>`. A
//    keyboard user is then at the top of the document with no idea anything
//    happened, and their next Tab starts from the site header.
//
// The focus move is why this is a wrapper rather than a bare paragraph. It is
// deliberately NOT what `AdminForm` does — that one never steals focus after a
// success, and is right not to, because its form stays mounted and focus stays
// somewhere meaningful. These two replace themselves, so there is no focus left
// to preserve; the choice is the region or the body.
//
// B-171 fixed the half B-148 left: the region was written into on SUCCESS only
// (`{success ? state.message : ''}`), so a refusal discarded its summary and
// left the region EMPTY while focus stayed on the submit. The only evidence of
// a refusal was a `<span>` beside the field, reachable by swiping backwards —
// so a screen-reader user could not tell "we refused this" from "we accepted it
// and said nothing", on every error path of both forms. The region is written
// into on both branches now, focus follows it either way, and error text is red
// rather than the hardcoded green that rendered a refusal in the colour of a
// confirmation (1.4.1).
export function FormResult({
  state,
  className,
  children,
}: {
  state: FormState
  /// Layout only — margin from the surrounding block, applied ONLY once there
  /// is a message. At idle the region must occupy no space: an empty <p> has no
  /// height, but a margin on it still pushes the form down, which would be a
  /// visible gap above every sold-out size card. A class that toggles is safe
  /// here in a way `empty:hidden` is not — the element stays attached and stays
  /// in the accessibility tree either way, only its margin changes.
  className?: string
  children: React.ReactNode
}) {
  const ref = useRef<HTMLParagraphElement>(null)
  const success = state.status === 'success'
  const error = state.status === 'error'
  const message = state.status === 'idle' ? '' : state.message

  useEffect(() => {
    // On `state`, not on `success`: a second refusal is a new state object but
    // the same boolean, and a keyboard user who fixes one field and is refused
    // for another must be taken to the message again rather than left standing
    // on the submit.
    if (message) ref.current?.focus()
  }, [state, message])

  return (
    <>
      {/* Unconditional and empty at idle, exactly as `AdminForm`'s is, and for
          the reason its comment gives: no `empty:hidden` and no `display:none`,
          which would take the element out of the accessibility tree right up
          until the moment it has text and reintroduce the same failure one
          layer down. An empty <p> has no visible footprint anyway. */}
      <p
        ref={ref}
        tabIndex={-1}
        role="status"
        className={`text-sm font-medium text-pretty ${error ? 'text-red-700' : 'text-green-700'} ${message ? (className ?? '') : ''}`}
      >
        {message}
      </p>
      {!success && children}
    </>
  )
}
