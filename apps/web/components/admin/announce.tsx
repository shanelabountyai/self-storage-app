'use client'

import { createContext, useContext, useEffect, useRef, useState } from 'react'

// B-170 / PRD 02 §5.5 FR-20. A live region that outlives the row it reports on.
//
// `AdminForm` announces into a `role="status"` INSIDE the form. That is right
// wherever the form survives its own success, and wrong in every queue here:
// completing a task revalidates the list in the same commit that writes the
// message, so React unmounts the `<li>` holding the region at the moment it is
// populated. The text never exists long enough to be an observable mutation —
// nothing is announced — and focus, which was on the submit inside that `<li>`,
// falls to `<body>`, so the next Tab starts from the sidebar (4.1.3, 2.4.3).
//
// The structural move is the one `components/marketing/form-result.tsx` already
// makes: put the region somewhere the outcome cannot remove. Here that is the
// PAGE, above the list. The message is pushed up from the form's action rather
// than rendered by it, which is also why this survives — the push happens while
// the form is still mounted, and the state it lands in belongs to a component
// the revalidation does not touch.
const AnnounceContext = createContext<((message: string) => void) | null>(null)

export function useAnnounceOutside() {
  return useContext(AnnounceContext)
}

export function AnnounceRegion({
  children,
  className,
}: {
  children: React.ReactNode
  /// Layout only, and applied only once there is a message.
  className?: string
}) {
  const [message, setMessage] = useState('')
  const ref = useRef<HTMLParagraphElement>(null)

  useEffect(() => {
    // Focus follows the announcement because the control that was focused has
    // just been unmounted. The choice is this region or `<body>`.
    if (message) ref.current?.focus()
  }, [message])

  return (
    <AnnounceContext.Provider value={setMessage}>
      {/* Mounted unconditionally and empty at idle, for the reason `AdminForm`'s
          own comment gives at length: a region inserted already carrying its
          message is unreliably announced by VoiceOver and routinely missed by
          NVDA, and `empty:hidden`/`display:none` reintroduce that one layer
          down by keeping it out of the accessibility tree until it has text. */}
      <p
        ref={ref}
        tabIndex={-1}
        role="status"
        // `sr-only` at idle, never `hidden` and never `empty:hidden`. Both of
        // those are `display: none`, which takes the element out of the
        // accessibility tree until the moment it has text — the same
        // "region that appears with the event" failure this exists to avoid.
        // `sr-only` is `position: absolute`, so the empty region contributes
        // no height AND no `gap` in the flex column every one of these pages
        // lays its sections out with, while staying in the tree throughout.
        className={
          message
            ? `text-sm font-medium text-pretty text-green-700 ${className ?? ''}`
            : 'sr-only'
        }
      >
        {message}
      </p>
      {children}
    </AnnounceContext.Provider>
  )
}
