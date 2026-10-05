'use client'

import { ErrorPanel } from '@/components/site/error-panel'

// B-435 (PRD 01 §6.7). English, as the staff screens are (D-122). The digest
// is Next's id for a server error, and it is the line to search the logs for.
export default function AdminError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string }
  unstable_retry: () => void
}) {
  return (
    <ErrorPanel
      title="This screen did not load"
      body="Something went wrong on our end. Try again."
      retryLabel="Try again"
      retry={unstable_retry}
    >
      <p className="mt-3">
        If it keeps happening, report it with this request id:{' '}
        <code className="font-mono">{error.digest ?? 'none (the error was in the browser)'}</code>
      </p>
    </ErrorPanel>
  )
}
