// PRD 05 FR-5 (B-074). Twilio requires E.164 (`+1XXXXXXXXXX`); `Tenant.phone`
// is stored however checkout's own loose validation left it (`≥10 digits`,
// no format enforced — apps/web/lib/checkout/details.ts). This is the one
// place that bridges the two, so a phone that renders fine as "512-555-0100"
// does not silently fail a Twilio call with a 21211 error.
//
// US-only, matching D-10's operating-state scope: this product is built for
// Texas facilities today, and a stored number with no country code is
// overwhelmingly a US number, not an internationally ambiguous one.

/// Normalizes to E.164, or null if the number cannot be read as a plausible
/// US number. Accepts what checkout already lets through: 10 bare digits,
/// 11 digits leading with the country code, or an already-E.164 value.
export function normalizePhoneE164(raw: string | null | undefined): string | null {
  if (!raw) return null
  const trimmed = raw.trim()

  // Already E.164: a leading + followed by 10-15 digits, per the ITU format
  // Twilio itself validates against.
  if (/^\+[1-9]\d{9,14}$/.test(trimmed)) return trimmed

  const digits = trimmed.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return null
}
