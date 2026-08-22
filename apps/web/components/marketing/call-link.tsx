import { SITE } from '@/lib/site-config'

/// The one place a public page decides which number to show. Mixing the
/// facility's own line with the org line on a single page sends a renter to a
/// different number than the button they just read — so this is resolved once
/// per page and passed down, never re-derived per component.
///
/// Lifted out of the facility page in B-149, when checkout's unit-lost branch
/// needed the same rule: that branch had no number at all, and the two places
/// most likely to make a renter dial must not disagree about what they dial.
export function phoneFor(phone: string | null) {
  if (phone) {
    return { href: phone.replace(/[^\d+]/g, ''), display: phone, isMain: false }
  }
  return { href: SITE.phone.href, display: SITE.phone.display, isMain: true }
}

export type Phone = ReturnType<typeof phoneFor>

/// "Call (512) 555-0100" / "Call our main line, (512) 555-0100" — a renter who
/// might get transferred should know that before they dial.
export function CallLink({ phone, className }: { phone: Phone; className?: string }) {
  return (
    <a href={`tel:${phone.href}`} className={className}>
      Call {phone.isMain ? 'our main line, ' : ''}
      {phone.display}
    </a>
  )
}
