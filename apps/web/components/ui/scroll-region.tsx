import * as React from 'react'

import { cn } from '@/lib/utils'

// B-249 / SC 4.1.2. Fifty-six horizontally-scrolling wrappers in this product
// were `<div tabIndex={0} className="overflow-x-auto">` and nothing else.
// B-217 gave every one of them a visible scrollbar and a `:focus-visible`
// outline, which is the sighted half; what none of them had was a role or a
// name. Tabbing through `/admin/reports`, focus landed on a bare <div> —
// VoiceOver announced the group's first text and no role, NVDA typically said
// nothing at all. The user had arrived at a control whose entire purpose
// ("arrow keys scroll this") was conveyed by no announcement.
//
// **No scan will ever raise this.** axe's `scrollable-region-focusable` only
// checks that a scroll container IS focusable; a focusable one with no name
// passes it. That is why fifty-six of them accumulated.
//
// The conformance call is carried as the reviewer wrote it and NOT upgraded:
// whether a scroll container is a "user interface component" under 4.1.2 is
// genuinely contested. What is not contested is that each one is a focus stop
// that announces nothing.
export function ScrollRegion({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  /// Required, and required as a STRING rather than defaulted — the whole
  /// defect is fifty-six regions nobody named, so a fifty-seventh must not
  /// compile without one. Deliberately a short noun phrase ("Gate attempts",
  /// "Rent roll") rather than the table's full <caption>, even though the
  /// caption is where the wording comes from: this name is what appears in the
  /// landmark rotor, and a rotor listing four one-line sentences is harder to
  /// scan than the table was. The caption still says the long version on
  /// entering the table, so nothing is lost and nothing is said twice.
  'aria-label': string
}) {
  return (
    // `overflow-x-auto` and `tabIndex={0}` in this order and on this element on
    // purpose: `globals.css` keys B-217's scrollbar rule on the
    // `[tabindex="0"].overflow-x-auto` pair, so both have to stay on the same
    // node for the visible affordance to keep matching.
    <div role="region" tabIndex={0} className={cn('overflow-x-auto', className)} {...props}>
      {children}
    </div>
  )
}
