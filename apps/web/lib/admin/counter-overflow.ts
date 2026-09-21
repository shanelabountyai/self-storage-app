import { formatCents } from '@/lib/format'

// B-339 / O5. The counter form's warning when a unit-directed amount is more
// than that unit owes and the tenant has another owing unit. Pure, so the test
// can assert the wording without rendering the form.

/// Typed dollars to cents for the warning only — the server parses its own.
export function typedCents(input: string): number | null {
  const cleaned = input.trim().replace(/[$,\s]/g, '')
  return /^\d+(\.\d{1,2})?$/.test(cleaned) ? Math.round(Number(cleaned) * 100) : null
}

export function unitList(numbers: string[]): string {
  return numbers.length <= 2
    ? numbers.join(' and ')
    : `${numbers.slice(0, -1).join(', ')} and ${numbers.at(-1)}`
}

type Unit = { unitNumber: string; balanceCents: number; daysPastDue: number }

/// Late fees net credit per TENANT, but the delinquency ladder qualifies per
/// LEASE (`lib/delinquency/engine.ts`), so a surplus parked on the picked unit
/// does nothing for the other one — it can still be overlocked. Worded without
/// the typed figure so the live region does not re-announce on every key.
export function overflowWarning(picked: Unit, others: Unit[], amount: string): string {
  const typed = typedCents(amount)
  if (others.length === 0 || typed === null || typed <= picked.balanceCents) return ''
  const owes = others
    .map((l) => `Unit ${l.unitNumber} also owes ${formatCents(l.balanceCents)}`)
    .join('; ')
  const rest = unitList(others.map((l) => l.unitNumber))
  const warning = `${owes}. This amount is more than ${picked.unitNumber} owes, so as it stands the rest stays as credit on ${picked.unitNumber} and ${rest} ${others.length === 1 ? 'stays' : 'stay'} unpaid.`
  // B-358. The harm B-339 confirmed, said out loud. No late-fee claim: late
  // fees DO net credit per tenant, so only the lockout is true here.
  const late = others.filter((l) => l.daysPastDue > 0)
  if (late.length === 0) return warning
  const lateList = unitList(late.map((l) => l.unitNumber))
  return `${warning} Credit on ${picked.unitNumber} does not take ${lateList} off ${late.length === 1 ? 'its' : 'their'} past-due schedule, so ${lateList} can still be locked out.`
}
