import * as React from 'react'

import { cn } from '@/lib/utils'

// B-384. The in-card "nothing here" — one sentence, an optional next step.
// Plain text, no role: an empty list is not an event to announce.
export function EmptyState({
  className,
  action,
  children,
}: {
  className?: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className={cn('text-muted-foreground py-6 text-center text-sm', className)}>
      <p>{children}</p>
      {action && <div className="mt-3">{action}</div>}
    </div>
  )
}
