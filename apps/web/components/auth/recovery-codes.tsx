'use client'

import Link from 'next/link'
import { useState } from 'react'

// B-108, UX review 2026-08-12 finding 15. A way to actually save the codes.
//
// The screen said "this is the only time they are shown" and then offered no
// copy-all, no download, no print and no acknowledgement gate, while the codes
// lived in a client component's `useActionState` — so a refresh, a Back or a
// stray click lost them permanently. On a product with one owner account, the
// recovery path from there is an administrator reset performed by the
// administrator who has just locked themselves out.
//
// Nothing here logs a code and nothing sends one anywhere: the copy goes to the
// clipboard and the download is a Blob built in the page. A "download" that
// round-tripped through the server would put ten working credentials in an
// access log, which is the failure this whole screen exists to avoid.

export function RecoveryCodes({ codes }: { codes: string[] }) {
  const [saved, setSaved] = useState<'copied' | 'downloaded' | null>(null)
  const [acknowledged, setAcknowledged] = useState(false)

  const asText = codes.join('\n')

  async function copyAll() {
    try {
      await navigator.clipboard.writeText(asText)
      setSaved('copied')
    } catch {
      // The codes are already on screen as selectable text. Saying nothing is
      // more honest than claiming a copy that did not happen.
    }
  }

  function download() {
    // Built and revoked in the page; the file never exists on a server.
    const blob = new Blob([`${asText}\n`], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'recovery-codes.txt'
    link.click()
    URL.revokeObjectURL(url)
    setSaved('downloaded')
  }

  return (
    <div className="col-span-full flex flex-col gap-3">
      <ul className="border-input grid gap-1 rounded-md border p-3 font-mono text-sm">
        {codes.map((code) => (
          <li key={code}>
            <span aria-hidden="true">{code}</span>
            {/* Character-separated for the same reason the TOTP key is: a code
                read aloud as words is a code somebody mistypes, and these are
                the credential of last resort. */}
            <span className="sr-only">{code.split('').join(' ')}</span>
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={copyAll}
          className="border-input hover:bg-accent inline-flex min-h-11 items-center rounded-md border px-4 text-sm font-medium"
        >
          Copy all
        </button>
        <button
          type="button"
          onClick={download}
          className="border-input hover:bg-accent inline-flex min-h-11 items-center rounded-md border px-4 text-sm font-medium"
        >
          Download as a file
        </button>
        <button
          type="button"
          onClick={() => window.print()}
          className="border-input hover:bg-accent inline-flex min-h-11 items-center rounded-md border px-4 text-sm font-medium"
        >
          Print
        </button>
      </div>

      {/* Pre-mounted and empty — the `GateCodePanel` pattern the row names. A
          region inserted along with its own text announces nothing (B-111). */}
      <p role="status" className="text-muted-foreground text-sm">
        {saved === 'copied' ? 'Copied to your clipboard.' : ''}
        {saved === 'downloaded' ? 'Downloaded as recovery-codes.txt.' : ''}
      </p>

      {/* The gate. Not a nag: until this is ticked there is no way onward from
          this screen, because "I have seen them" and "I have saved them" are
          different claims and only the second is true when it matters. */}
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={(event) => setAcknowledged(event.target.checked)}
          className="mt-1"
        />
        <span>I have saved these codes somewhere I can reach without this account.</span>
      </label>

      {/* A link rather than a disabled button: B-093's rule is that a control
          is never `disabled`, because a disabled control tells a screen-reader
          user nothing about why. This one stays in the tab order, announces
          itself as unavailable, and says what to do about it. */}
      <Link
        href="/admin"
        aria-disabled={acknowledged ? undefined : true}
        aria-describedby="ack-hint"
        onClick={(event) => {
          if (!acknowledged) event.preventDefault()
        }}
        className={
          acknowledged
            ? 'bg-primary text-primary-foreground inline-flex min-h-11 items-center justify-center self-start rounded-md px-4 text-sm font-medium'
            : 'border-input text-muted-foreground inline-flex min-h-11 cursor-not-allowed items-center justify-center self-start rounded-md border px-4 text-sm font-medium'
        }
      >
        Continue to the dashboard
      </Link>
      <p id="ack-hint" className="text-muted-foreground text-xs">
        {acknowledged
          ? 'These codes will not be shown again.'
          : 'Tick the box above once you have saved the codes — they will not be shown again.'}
      </p>
    </div>
  )
}
