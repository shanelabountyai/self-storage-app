import { translate, type Dictionary, type MessageKey } from '@/lib/i18n'

// B-090 part 6. The move-in cost lines, in the reader's language.
//
// `calculateMoveInCost` lives in `@storage/core` and emits English labels and
// notes. It is NOT translated in place, for one reason: the dictionaries are an
// `apps/web` concern and pulling them into a shared package would put customer
// copy in the same file as the arithmetic that the billing tests pin. What the
// function already emits is a stable `key` per line, which is all a lookup
// needs — so the maths stays where it is and the words move here.
//
// Two lines are deliberately NOT translated:
//   * the promo label when a promotion supplied its own terms, which is text an
//     operator typed and which appears verbatim on the badge above; and
//   * any key this map does not know, which falls back to the English label
//     rather than rendering blank — a new cost line must be visible before it
//     is translated, never invisible until somebody notices.

const LINE_KEYS: Record<string, MessageKey> = {
  rent: 'cost.rent',
  promo: 'cost.promo',
  admin: 'cost.admin',
  tax: 'cost.tax',
  protection: 'cost.protection',
}

const NOTE_KEYS: Record<string, MessageKey> = {
  rent: 'cost.rent.note',
  promo: 'cost.promo.note',
  admin: 'cost.admin.note',
  protection: 'cost.protection.note',
}

export type CostLine = { key: string; label: string; note?: string }

export function costLineLabel(dict: Dictionary, line: CostLine, promoTerms?: string): string {
  // An operator's own promotion wording wins over "Promotion" in either
  // language — it is the same string the badge on the card shows, and two
  // different descriptions of one discount is what gets argued about at the
  // counter.
  if (line.key === 'promo' && promoTerms) return promoTerms
  const key = LINE_KEYS[line.key]
  return key ? translate(dict, key) : line.label
}

export function costLineNote(dict: Dictionary, line: CostLine): string | undefined {
  if (!line.note) return undefined
  const key = NOTE_KEYS[line.key]
  return key ? translate(dict, key) : line.note
}
