'use client'

import { useState } from 'react'
import { useT } from '@/components/i18n/locale-provider'

// PRD 10 §5.2 (B-100) — "the central decision", in the PRD's own words.
//
// **The tenant texts it from their own phone. The system never sends an email
// or SMS to a prospect.** That is the whole design of this feature and it is
// not a simplification:
//
//   * a "give us your friend's number and we'll text them" field makes THIS
//     business the sender of an unsolicited commercial message to somebody who
//     never gave consent, and CAN-SPAM liability attaches to the sender rather
//     than to the person who typed the address;
//   * as SMS it is squarely a TCPA problem, where damages are statutory and
//     PER MESSAGE — $500, trebled to $1,500 for a willful violation. A referral
//     program that texted a thousand friends is a six-figure exposure on a
//     feature designed to save aggregator fees;
//   * PRD 05 FR-21 requires captured consent before any marketing message, and
//     a number typed by a third party is by definition not consent;
//   * the suppression list cannot protect somebody it has never heard of.
//
// So there is NO recipient field here, and there must never be one. Getting the
// tenant's own thumb to press send costs one extra tap and removes the entire
// category. §5.2's AC states it as a permanent non-goal: "there is no input
// anywhere in this feature that accepts a third party's email address or phone
// number."
//
// The three-step degradation is §5.2's other AC: the native share sheet (which
// opens Messages on a phone) where available, then copy-to-clipboard, then the
// code as selectable text — which is why the code is rendered as text on the
// page regardless of whether any of this JavaScript runs at all.

export function ShareInvite({ code, message }: { code: string; message: string }) {
  const t = useT()
  const [copied, setCopied] = useState(false)
  const [failed, setFailed] = useState(false)

  async function share() {
    setFailed(false)
    // The tenant's own message, in the tenant's own app. We prefill; they send.
    const nav: Navigator | undefined = typeof navigator === 'undefined' ? undefined : navigator
    if (!nav) return
    if (typeof nav.share === 'function') {
      try {
        await nav.share({ text: message })
        return
      } catch {
        // A dismissed share sheet is not a failure — the tenant changed their
        // mind, and saying "sharing failed" would be wrong. Fall through to
        // copy only if the sheet was never usable.
        return
      }
    }
    try {
      await nav.clipboard.writeText(message)
      setCopied(true)
    } catch {
      // Clipboard blocked. The code is already on screen as selectable text,
      // so the honest thing is to point at it rather than pretend.
      setFailed(true)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={share}
        className="border-input hover:bg-accent inline-flex min-h-11 items-center justify-center rounded-md border px-4 text-sm font-medium"
      >
        {t('invite.share', { code })}
      </button>
      {/* Pre-mounted and empty rather than inserted with its own text — the
          B-111 lesson: a live region that appears WITH its content announces
          nothing. */}
      <p role="status" className="text-muted-foreground mt-1 text-xs empty:mt-0">
        {copied ? t('invite.copied') : ''}
        {failed ? t('invite.copyFailed') : ''}
      </p>
    </>
  )
}
