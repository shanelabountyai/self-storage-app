'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'

// PRD 01 §6.5/§6.8.1. Hidden behind a tap to reduce shoulder-surfing
// (§6.5), with the specific accessibility contract §6.8.1 names for this
// flow: the reveal control is a `<button aria-expanded>`, the code is
// announced character by character (a six-digit code read as one number is
// useless), and "Copied" is announced from a region that already exists in
// the DOM rather than one inserted by the click.
//
// Deliberately NOT `empty:hidden` the way `AdminForm`'s save-state region
// (components/admin/form.tsx) styles its own empty live region: `hidden` is
// `display:none`, which pulls the element out of the accessibility tree right
// up until the moment it has text — exactly the "region inserted only when
// the event fires" failure §6.8 calls unreliable, just moved from "not in the
// DOM" to "in the DOM but not exposed." An empty text node has no visible
// footprint on its own, so nothing is gained by hiding it.

export function GateCodePanel({ code }: { code: string }) {
  const [revealed, setRevealed] = useState(false)
  const [copyStatus, setCopyStatus] = useState('')

  async function handleCopy() {
    await navigator.clipboard.writeText(code)
    setCopyStatus('Copied')
  }

  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-expanded={revealed}
        onClick={() => setRevealed((value) => !value)}
        className="self-start"
      >
        {revealed ? 'Hide gate code' : 'Show gate code'}
      </Button>

      {revealed && (
        <div className="flex items-center gap-3">
          <span aria-hidden="true" className="font-mono text-lg tracking-[0.3em]">
            {code}
          </span>
          {/* Space-separated so a screen reader speaks each digit rather than
              the whole string as one large number. */}
          <span className="sr-only">{code.split('').join(' ')}</span>
          <Button type="button" variant="ghost" size="sm" onClick={handleCopy}>
            Copy
          </Button>
        </div>
      )}

      <p role="status" className="text-muted-foreground text-sm">
        {copyStatus}
      </p>
    </div>
  )
}
