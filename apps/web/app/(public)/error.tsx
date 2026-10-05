'use client'

import { usePathname } from 'next/navigation'
import { useT } from '@/components/i18n/locale-provider'
import { ErrorPanel } from '@/components/site/error-panel'

// B-435 (PRD 01 §6.7). "Nothing was charged" is said only where it is true:
// of the routes under this layout, only checkout can start a charge, and an
// error there can land after the card was taken.
export default function PublicError({
  unstable_retry,
}: {
  error: Error & { digest?: string }
  unstable_retry: () => void
}) {
  const t = useT()
  const checkout = usePathname().startsWith('/checkout')

  return (
    <ErrorPanel
      title={t('errorPage.errorTitle')}
      body={t(checkout ? 'errorPage.checkout' : 'errorPage.notCharged')}
      retryLabel={t('errorPage.tryAgain')}
      retry={unstable_retry}
      phoneLabel={t('chrome.callUsAt')}
    />
  )
}
