import Link from 'next/link'
import { Phone } from 'lucide-react'
import { phoneFor } from '@/components/marketing/call-link'
import { formatMiles, formatRate } from '@/lib/format'
import { facilityPath } from '@/lib/facility/public-facility'
import type { HomeFacility } from '@/lib/marketing/home-facts'
import { translate, type Dictionary, type MessageKey } from '@/lib/i18n'

// B-365's home-page card, extracted in B-366 so the locations page (D-146,
// D-147) can list the same facilities without a second copy of this markup.
// The card itself is unchanged; only `distanceMiles` is new, and only the
// locations page passes it.

export function FacilityCard({
  facility,
  dict,
  distanceMiles,
}: {
  facility: HomeFacility
  dict: Dictionary
  /// B-366. Set only when the visitor shared their location (`?lat=&lng=`) —
  /// the same opt-in "Use my location" carries on the search page. Absent
  /// otherwise, same as the search results' own distance column.
  distanceMiles?: number
}) {
  const t = (key: MessageKey, vars?: Record<string, string | number>) =>
    translate(dict, key, vars)
  const phone = phoneFor(facility.phone)
  const { from } = facility
  return (
    <li className="bg-card flex flex-col gap-2 rounded-xl border p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="font-heading text-lg font-bold">
          {/* Distance rides inside the link's accessible name (WCAG 2.4.4)
              rather than being read twice — same treatment as the search
              results' cards. */}
          <Link href={facilityPath(facility)} className="underline-offset-4 hover:underline">
            {facility.name}
            {distanceMiles !== undefined && (
              <span className="sr-only">, {formatMiles(distanceMiles)}</span>
            )}
          </Link>
        </h3>
        {distanceMiles !== undefined && (
          <p className="text-muted-foreground text-sm" aria-hidden="true">
            {formatMiles(distanceMiles)}
          </p>
        )}
      </div>
      <p className="text-muted-foreground text-sm">
        {facility.addressLine1}, {facility.city}, {facility.state} {facility.postalCode}
      </p>
      <a
        href={`tel:${phone.href}`}
        className="inline-flex min-h-11 items-center gap-2 self-start text-sm underline underline-offset-4"
      >
        <Phone className="size-4" aria-hidden="true" />
        <span className="sr-only">{t('chrome.callUsAt')}</span>
        {phone.display}
      </a>
      <p className="mt-auto font-medium">
        {from === null ? (
          <>
            {t('card.noUnits')}{' '}
            <a href={`tel:${phone.href}`} className="underline underline-offset-4">
              {t('card.call', { phone: phone.display })}
            </a>
          </>
        ) : (
          <>
            <span aria-hidden="true">
              {from.widthFt}×{from.lengthFt} {t('card.from')} {formatRate(from.webRateCents)}
              <span className="text-muted-foreground font-normal">{t('card.perMonth')}</span>
            </span>
            <span className="sr-only">
              {t('card.priceSr', {
                width: from.widthFt,
                length: from.lengthFt,
                price: formatRate(from.webRateCents),
              })}
            </span>
          </>
        )}
      </p>
    </li>
  )
}
