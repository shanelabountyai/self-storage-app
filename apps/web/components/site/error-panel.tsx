'use client'

import { useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { SITE } from '@/lib/site-config'

// B-435 (PRD 01 §6.7). What every segment's `error.tsx` renders: the problem,
// the consequence, the next action, in that order. The words are the caller's,
// because what is true differs per segment ("Nothing was charged" is a claim).
//
// ponytail: the phone is the organisation's, not the reader's facility. An
// error boundary is a client component with no data; a context from each
// layout is the upgrade when `SITE.phone` stops being the only office line.
/// SC 2.4.2. Neither an error boundary nor a not-found file can export
/// `metadata`, and a hoisted `<title>` loses to the one Next already wrote
/// (measured: the not-found page kept the site default). So the title is set
/// after hydration.
export function DocumentTitle({ title }: { title: string }) {
  useEffect(() => {
    document.title = `${title} · ${SITE.brand}`
  }, [title])
  return null
}

export function ErrorPanel({
  title,
  body,
  retryLabel,
  retry,
  phoneLabel,
  children,
}: {
  title: string
  body: string
  retryLabel: string
  retry: () => void
  /// Absent on the staff screen, which has no office to call.
  phoneLabel?: string
  children?: React.ReactNode
}) {
  const heading = useRef<HTMLHeadingElement>(null)
  // A soft navigation swaps this page in without a load, so nothing announces
  // it. Focus on the heading is what tells a screen reader the page changed.
  useEffect(() => heading.current?.focus(), [])

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-12">
      <DocumentTitle title={title} />
      <h1 ref={heading} tabIndex={-1} className="text-3xl font-semibold tracking-tight text-balance">
        {title}
      </h1>
      <p className="mt-3 text-lg text-pretty">{body}</p>
      {children}
      <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3">
        <Button type="button" className="min-h-11 px-4" onClick={() => retry()}>
          {retryLabel}
        </Button>
        {phoneLabel && (
          <p>
            {phoneLabel}
            <a
              href={`tel:${SITE.phone.href}`}
              className="inline-flex min-h-11 items-center underline underline-offset-4"
            >
              {SITE.phone.display}
            </a>
          </p>
        )}
      </div>
    </div>
  )
}
