'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { useT } from '@/components/i18n/locale-provider'

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
  const t = useT()
  const [revealed, setRevealed] = useState(false)
  const [copyStatus, setCopyStatus] = useState('')

  async function handleCopy() {
    await navigator.clipboard.writeText(code)
    setCopyStatus(t('gate.copied'))
  }

  return (
    // B-367 (D-146): the kit's `GateCodeCard` is the most-wanted object on the
    // page — a dark card, mono digits, masked by default — so the reveal
    // control gets that surface rather than sitting bare on the page
    // background. `data-surface="inverse"` repoints the focus ring the same
    // way the public dark bands do (globals.css, B-364).
    <div data-surface="inverse" className="bg-inverse text-inverse-foreground flex flex-col gap-3 rounded-lg p-4">
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-expanded={revealed}
        onClick={() => setRevealed((value) => !value)}
        className="border-inverse-muted bg-transparent text-inverse-foreground hover:bg-inverse-muted/20 self-start"
      >
        {revealed ? t('gate.hide') : t('gate.show')}
      </Button>

      {revealed && (
        <div className="flex items-center gap-3">
          <span aria-hidden="true" className="font-mono text-[44px] leading-none tracking-[0.15em]">
            {code}
          </span>
          {/* Space-separated so a screen reader speaks each digit rather than
              the whole string as one large number. */}
          <span className="sr-only">{code.split('').join(' ')}</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleCopy}
            className="text-inverse-foreground hover:bg-inverse-muted/20"
          >
            {t('gate.copy')}
          </Button>
        </div>
      )}

      <p role="status" className="text-inverse-muted text-sm">
        {copyStatus}
      </p>
    </div>
  )
}
