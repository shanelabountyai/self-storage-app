import { translate, type Dictionary, type MessageKey, type MessageSegment } from '@/lib/i18n'

// B-090 part 6. The move-in cost lines, in the reader's language.
//
// `calculateMoveInCost` lives in `@storage/core` and emits English labels and
// notes. It is NOT translated in place, for one reason: the dictionaries are an
// `apps/web` concern and pulling them into a shared package would put customer
// copy in the same file as the arithmetic that the billing tests pin. What the
// function already emits is a stable `key` per line, which is all a lookup
// needs — so the maths stays where it is and the words move here.
//
// One line is deliberately NOT translated: any key this map does not know,
// which falls back to the English label rather than rendering blank — a new
// cost line must be visible before it is translated, never invisible until
// somebody notices.
//
// B-269 corrected the other half of this note. `promoTerms` used to be an
// English sentence built in `@storage/core/promotions`, and this comment said
// so; it is now whatever `offerTermsText` produced for the CALLER's dictionary,
// so the generated half arrives translated and only an operator's own
// `termsText` is still their own words (D-129). It is the same string the badge
// above shows either way, which is the property that matters here: two
// different descriptions of one discount is what gets argued about at the
// counter.

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

// B-272 returns RUNS rather than one string, and only the promo line ever has
// more than one of them. `promoTerms` is `offerTermsSegments`' output now, not
// a finished sentence: an operator's own `termsText` carries `lang: 'en'`
// (D-129), and flattening it here is exactly how this `<dt>` came to be one of
// the three surfaces B-269 left with English unannounced inside `lang="es"`.
//
// A `<dt>` cannot take a component, so the callers render these through
// `MessageSegments`. Every other line is a single unmarked run, which that
// renderer emits as the same bare text node it always was.
export function costLineLabel(
  dict: Dictionary,
  line: CostLine,
  promoTerms?: readonly MessageSegment[],
): readonly MessageSegment[] {
  // The promotion's own wording wins over "Promotion" in either language — it
  // is the same runs the badge on the card shows, resolved by the caller
  // against the same dictionary this function was handed.
  if (line.key === 'promo' && promoTerms && promoTerms.length > 0) return promoTerms
  const key = LINE_KEYS[line.key]
  return [{ text: key ? translate(dict, key) : line.label }]
}

export function costLineNote(dict: Dictionary, line: CostLine): string | undefined {
  if (!line.note) return undefined
  const key = NOTE_KEYS[line.key]
  return key ? translate(dict, key) : line.note
}
