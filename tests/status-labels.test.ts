import { describe, expect, it } from 'vitest'
import {
  LEAD_STATUS_LABELS,
  LEASE_STATUS_LABELS,
  UNIT_STATUS_LABELS,
  leadStatusLabel,
  leaseStatusLabel,
  unitStatusLabel,
} from '../packages/core/labels'

// B-109. Admin was rendering the database's own identifiers: a `<select>` whose
// options read `pending_auction`, a filter chip saying *Filtered to
// "overlock_apply"*, a badge relying on CSS `capitalize` — which cannot turn an
// underscore into a space, so it produced "Pending_auction".

describe('status labels', () => {
  it('never lets an underscore reach a screen', () => {
    const every = [
      ...Object.values(UNIT_STATUS_LABELS),
      ...Object.values(LEASE_STATUS_LABELS),
      ...Object.values(LEAD_STATUS_LABELS),
    ]
    expect(every.length).toBeGreaterThan(10)
    for (const label of every) {
      expect(label, `"${label}" still reads as an identifier`).not.toMatch(/_/)
      expect(label[0]).toBe(label[0]?.toUpperCase())
    }
  })

  it('writes the lien-sale status as words', () => {
    expect(leaseStatusLabel('pending_auction')).toBe('Pending auction')
  })

  // The one deliberate rename. Everything else keeps the operator's own word.
  it('says "Past due" rather than the schema\'s "delinquent"', () => {
    expect(leaseStatusLabel('delinquent')).toBe('Past due')
  })

  // Admin may use industry words; it may not use enum identifiers. Translating
  // "overlocked" into something friendlier would make the software HARDER to
  // use for the people whose job it is — a manager asks for the overlock list
  // by that name.
  it('keeps operator vocabulary intact', () => {
    expect(unitStatusLabel('overlocked')).toBe('Overlocked')
    expect(unitStatusLabel('unrentable')).toBe('Unrentable')
  })

  it('covers every lead status', () => {
    expect(leadStatusLabel('converted')).toBe('Converted')
    expect(Object.keys(LEAD_STATUS_LABELS)).toHaveLength(5)
  })

  // A status the map has not been taught about is a bug the exhaustive
  // Record types catch at build time. If one ever reaches a screen anyway it
  // must still read as words rather than as a column value.
  it('degrades an unknown status to words, not to the raw value', () => {
    expect(unitStatusLabel('some_future_state')).toBe('Some future state')
  })
})
