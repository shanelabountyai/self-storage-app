'use client'

import { ErrorPanel } from '@/components/site/error-panel'

import './globals.css'

// B-435 (PRD 01 §6.7). Replaces the root layout when the layout itself fails,
// so it has no locale to read: English, with the same sentence marked as
// Spanish (SC 3.1.2). It says nothing about a charge because it cannot know.
export default function GlobalError({
  unstable_retry,
}: {
  error: Error & { digest?: string }
  unstable_retry: () => void
}) {
  return (
    <html lang="en">
      <body>
        <main>
          <ErrorPanel
            title="This page did not load"
            body="Something went wrong on our end. Try again, or call us."
            retryLabel="Try again"
            retry={unstable_retry}
            phoneLabel="Call us at "
          >
            <p lang="es" className="mt-3">
              Algo falló de nuestra parte. Inténtelo de nuevo o llámenos.
            </p>
          </ErrorPanel>
        </main>
      </body>
    </html>
  )
}
