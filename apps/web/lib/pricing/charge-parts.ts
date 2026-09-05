import { listParts, type RecurringPart } from '@storage/core/pricing'
import { translate, type Dictionary, type MessageKey } from '@/lib/i18n'

// B-260 (D-122). What the recurring charge is made of, in the reader's
// language: "rent, tax and your protection plan".
//
// `recurringParts` in `@storage/core` names the parts as tokens and stops
// there — the arithmetic package holds the figures the billing tests pin and
// has no business holding customer copy. This is the other half, and it lives
// in one file for the same reason `listParts` does: `/portal` and
// `/portal/methods` both print this sentence beside the same figure, and two
// copies of it is how they end up describing one charge two ways.

const PART_KEYS: Record<RecurringPart, MessageKey> = {
  rent: 'charge.rent',
  tax: 'charge.tax',
  protection: 'charge.protection',
}

export function chargePartsSentence(dict: Dictionary, parts: readonly RecurringPart[]): string {
  return listParts(
    parts.map((part) => translate(dict, PART_KEYS[part])),
    translate(dict, 'charge.and'),
  )
}
