import { describe, expect, it } from 'vitest'
import {
  CLAIM_WINDOW_HOURS,
  claimExpired,
  isPlausibleEmail,
  normaliseEmail,
  notifiableCount,
  positionOf,
} from '../packages/core/waitlist'

// PRD 01 §9 Phase 3 (B-090 part 1). The rules behind notify-me.
//
// `notifiableCount` is the one with a wrong answer. Tell everybody and eleven
// of twelve people drive to a facility to find the unit gone, which is worse
// than never writing to them; tell one and say nothing more, and a prospect who
// has changed their mind blocks the queue forever.

describe('how many people get told', () => {
  it('tells one person about one unit, not the whole list', () => {
    expect(notifiableCount(1, 0, 12)).toBe(1)
  })

  it('tells nobody twice about the same unit', () => {
    // The second sweep, ten minutes after the first. One unit, one claim
    // already outstanding — there is nothing left to offer.
    expect(notifiableCount(1, 1, 11)).toBe(0)
  })

  it('tells as many people as there are units', () => {
    expect(notifiableCount(3, 0, 12)).toBe(3)
    expect(notifiableCount(3, 1, 12)).toBe(2)
  })

  it('never promises more units than there are people, or vice versa', () => {
    expect(notifiableCount(5, 0, 2)).toBe(2)
    expect(notifiableCount(0, 0, 9)).toBe(0)
  })

  it('clamps at zero when units were taken while claims were outstanding', () => {
    // Two people were told, then both units were rented by walk-ins. That is a
    // legitimate state, not an error, and it must not produce a negative slot
    // count that a caller would read as "notify everybody".
    expect(notifiableCount(0, 2, 5)).toBe(0)
  })

  it('frees the slot again once a claim window elapses', () => {
    const notifiedAt = new Date('2026-08-20T09:00:00Z')
    const justInside = new Date(notifiedAt.getTime() + (CLAIM_WINDOW_HOURS - 1) * 3_600_000)
    const justOutside = new Date(notifiedAt.getTime() + CLAIM_WINDOW_HOURS * 3_600_000)

    expect(claimExpired(notifiedAt, justInside)).toBe(false)
    expect(claimExpired(notifiedAt, justOutside)).toBe(true)
  })

  it('spans a weekend, which is the reason for the number', () => {
    // Somebody who gets the mail on Friday evening still has their unit on
    // Monday morning. Pinned because shortening this silently would make the
    // list unfair to anybody who does not read mail daily.
    const fridayEvening = new Date('2026-08-21T18:00:00Z')
    const mondayMorning = new Date('2026-08-24T09:00:00Z')
    expect(claimExpired(fridayEvening, mondayMorning)).toBe(false)
  })
})

describe('the queue', () => {
  it('is FIFO, and reports a position somebody can act on', () => {
    const waiting = ['first', 'second', 'third']
    expect(positionOf('first', waiting)).toEqual({ position: 1, total: 3 })
    expect(positionOf('third', waiting)).toEqual({ position: 3, total: 3 })
  })

  it('reports nothing for an entry that is no longer waiting', () => {
    expect(positionOf('cancelled-one', ['first', 'second'])).toBeNull()
  })
})

describe('the address', () => {
  it('treats two spellings of one address as one person', () => {
    // Matches the partial unique index, which is on `lower(email)`. Without
    // this the same person joins twice and gets two mails about one unit.
    expect(normaliseEmail('  Ada@Example.COM ')).toBe('ada@example.com')
  })

  it('is permissive, because a rejected good address costs a rental', () => {
    expect(isPlausibleEmail('ada@example.com')).toBe(true)
    expect(isPlausibleEmail('ada+waitlist@sub.example.co.uk')).toBe(true)
    // A typo costs one bounced mail, which the suppression list already
    // handles. These are the shapes that cannot be delivered at all.
    expect(isPlausibleEmail('ada')).toBe(false)
    expect(isPlausibleEmail('ada@example')).toBe(false)
    expect(isPlausibleEmail('ada @example.com')).toBe(false)
    expect(isPlausibleEmail('')).toBe(false)
  })
})
