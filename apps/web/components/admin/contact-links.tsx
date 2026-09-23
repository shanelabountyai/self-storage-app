/// B-386. Call and Text for a tenant with a phone number. `sms:` only opens the
/// staff member's own messaging app; nothing is sent from here. The name is in
/// each link's accessible name because a column of bare "Call" links is not
/// distinguishable by a screen reader.
export function ContactLinks({ name, phone }: { name: string; phone: string | null }) {
  if (!phone) return null
  const number = phone.replace(/[^\d+]/g, '')
  if (!number) return null
  const cls = 'border-input hover:bg-accent inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border px-3 text-sm font-medium'
  return (
    <span className="inline-flex gap-2">
      <a href={`tel:${number}`} aria-label={`Call ${name}`} className={cls}>
        Call
      </a>
      <a href={`sms:${number}`} aria-label={`Text ${name}`} className={cls}>
        Text
      </a>
    </span>
  )
}
