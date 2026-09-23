import * as React from 'react'

import { cn } from '@/lib/utils'

const TONE = {
  danger: 'border-danger-border bg-danger-bg text-danger-fg',
  warning: 'border-warning-border bg-warning-bg text-warning-fg',
  success: 'border-success-border bg-success-bg text-success-fg',
  info: 'border-info-border bg-info-bg text-info-fg',
} as const

// B-384. Owns the B-383 rule: colour is never the only cue, so danger and
// warning carry a lead word (`title`) and a ⚠ glyph. The glyph is aria-hidden,
// so the announced text is the title and body only. `role` defaults to "alert";
// pass "status" for a polite region. Pre-mounted regions (empty until an error
// arrives) should keep their own element and use this only once populated.
export function Alert({
  tone,
  title,
  action,
  role = 'alert',
  className,
  children,
}: {
  tone: keyof typeof TONE
  title?: React.ReactNode
  action?: React.ReactNode
  role?: 'alert' | 'status'
  className?: string
  children?: React.ReactNode
}) {
  return (
    <div
      role={role}
      className={cn('rounded-md border-2 p-3 text-sm', TONE[tone], className)}
    >
      <div className="flex items-start gap-2">
        {(tone === 'danger' || tone === 'warning') && (
          <span aria-hidden className="font-semibold">
            ⚠
          </span>
        )}
        <div className="min-w-0 flex-1 text-pretty">
          {title && <strong className="font-semibold">{title}</strong>}
          {title && children ? ' ' : null}
          {children}
        </div>
        {action}
      </div>
    </div>
  )
}
