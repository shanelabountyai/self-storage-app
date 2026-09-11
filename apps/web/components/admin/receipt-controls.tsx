'use client'

import { useEffect, useRef } from 'react'

// B-281. The two pieces of the counter receipt that need the browser.

/// Focus lands on the receipt's heading when the tender completes (2.4.3):
/// the Record payment button that had it was on the page this one replaced.
export function FocusedHeading({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  const ref = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    ref.current?.focus()
  }, [])
  return (
    <h1 ref={ref} tabIndex={-1} className={className}>
      {children}
    </h1>
  )
}

export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="border-input hover:bg-accent inline-flex min-h-11 items-center rounded-md border px-3 text-sm font-medium"
    >
      Print receipt
    </button>
  )
}
