import * as React from 'react'

import { cn } from '@/lib/utils'

// B-384. The kit's card: shadow-1, a hover lift when it is a link/button
// target, and a clay ring when selected. Selection is a ring, never a fill
// (the kit forbids it); `selected` also sets aria-current only when the caller
// passes it, so no role or state changes by adopting this.
export function Card({
  className,
  selected,
  interactive,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { selected?: boolean; interactive?: boolean }) {
  return (
    <div
      className={cn(
        'bg-card text-card-foreground border-border rounded-(--radius-card) border shadow-1',
        interactive &&
          'transition-shadow duration-(--dur-base) ease-(--ease-out) hover:shadow-2',
        selected && 'border-primary ring-primary ring-1',
        className,
      )}
      {...props}
    />
  )
}
