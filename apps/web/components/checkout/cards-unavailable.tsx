import { SITE } from '@/lib/site-config'
import type { MessageKey } from '@/lib/i18n'

// The honest failure. A form that cannot submit is worse than a sentence that
// ends in a rented unit. Shared by the server step (no Stripe key) and the
// client form (Stripe.js never loaded, B-392). `moveIn` is off for the portal
// (B-412), where there is no unit being held and no move-in to finish.
export function CardsUnavailable({
  t,
  moveIn = true,
}: {
  t: (key: MessageKey, vars?: Record<string, string | number>) => string
  moveIn?: boolean
}) {
  return (
    <p className="border-input mt-3 rounded-lg border p-4 text-pretty">
      {t('pay.cardsUnavailable')}{' '}
      <a href={`tel:${SITE.phone.href}`} className="font-medium underline underline-offset-4">
        {t('facility.callPhone', { phone: SITE.phone.display })}
      </a>
      {moveIn ? ` ${t('pay.cardsUnavailableAfter')}` : '.'}
    </p>
  )
}
