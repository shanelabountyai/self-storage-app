import * as React from 'react'

import { cn } from '@/lib/utils'

const TONE = {
  neutral: 'bg-muted text-foreground ring-foreground/30',
  danger: 'bg-danger-bg text-danger-fg ring-danger-border/50',
  warning: 'bg-warning-bg text-warning-fg ring-warning-border/50',
  success: 'bg-success-bg text-success-fg ring-success-border/50',
  info: 'bg-info-bg text-info-fg ring-info-border/50',
} as const

// B-384. A status pill; the label is the signal, the tone only reinforces it.
// Unit status has its own `UnitStatusBadge` (dot + hatch), which stays.
export function Badge({
  tone = 'neutral',
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: keyof typeof TONE }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset',
        TONE[tone],
        className,
      )}
      {...props}
    />
  )
}
