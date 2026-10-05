'use client'

import { useT } from '@/components/i18n/locale-provider'
import { ErrorPanel } from '@/components/site/error-panel'

// B-435 (PRD 01 §6.7). No word about the balance or a charge: a server action
// that throws lands here too, and this page cannot know how far it got.
export default function PortalError({
  unstable_retry,
}: {
  error: Error & { digest?: string }
  unstable_retry: () => void
}) {
  const t = useT()

  return (
    <ErrorPanel
      title={t('errorPage.errorTitle')}
      body={t('errorPage.portal')}
      retryLabel={t('errorPage.tryAgain')}
      retry={unstable_retry}
      phoneLabel={t('errorPage.payByPhone')}
    />
  )
}
