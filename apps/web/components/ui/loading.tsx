import * as React from 'react'

import { cn } from '@/lib/utils'

// B-389. Reduced motion is handled once in globals.css (animation-duration
// 0.01ms), so `animate-pulse` / `animate-spin` need no per-component guard.
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn('bg-muted animate-pulse rounded-md', className)} />
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'border-muted-foreground inline-block size-4 animate-spin rounded-full border-2 border-t-transparent',
        className,
      )}
    />
  )
}

// The body for a `loading.tsx`. Deliberately NOT `role="status"` (a11y.spec.ts
// forbids a populated live region on soft navigation), and no route mounts it
// yet: a `loading.tsx` at /portal, /admin, checkout or search each broke e2e
// (D-150) — it turns the segment into a Suspense boundary that remounts on
// router.refresh(), dropping focus and form state.
export function RouteLoading({ children }: { children?: React.ReactNode }) {
  return (
    <div aria-busy="true" className="mx-auto w-full max-w-5xl space-y-4 px-4 py-8">
      <span className="sr-only">Loading</span>
      <Skeleton className="h-8 w-1/3" />
      {children ?? (
        <>
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </>
      )}
    </div>
  )
}
