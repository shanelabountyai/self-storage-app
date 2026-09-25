import { SITE } from '@/lib/site-config'
import type { MessageKey } from '@/lib/i18n'

// The honest failure. A form that cannot submit is worse than a sentence that
// ends in a rented unit. Shared by the server step (no Stripe key) and the
// client form (Stripe.js never loaded, B-392).
export function CardsUnavailable({
  t,
}: {
  t: (key: MessageKey, vars?: Record<string, string | number>) => string
}) {
  return (
    <p className="border-input mt-3 rounded-lg border p-4 text-pretty">
      {t('pay.cardsUnavailable')}{' '}
      <a href={`tel:${SITE.phone.href}`} className="font-medium underline underline-offset-4">
        {t('facility.callPhone', { phone: SITE.phone.display })}
      </a>{' '}
      {t('pay.cardsUnavailableAfter')}
    </p>
  )
}
