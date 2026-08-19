import { describe, expect, it } from 'vitest'
import {
  frequencyFlags,
  FREQUENCY_FLAG_DISTINCT_SUBJECTS,
  type SessionRow,
} from '../apps/web/lib/impersonation/oversight'

// PRD 09 FR-20 (B-092). The frequency flag, which is the only part of oversight
// that is a judgement rather than a query — so it is the part that gets tested
// against plain values rather than against a database.

function session(overrides: Partial<SessionRow> & { startedAt: Date }): SessionRow {
  return {
    id: `s-${Math.random()}`,
    impersonatorStaffId: 'staff-1',
    impersonatorName: 'Sam Owner',
    subjectType: 'tenant',
    subjectId: 't-1',
    subjectName: 'Marcus Tenant',
    facilityIds: [],
    reason: 'support',
    ticketRef: null,
    expiresAt: new Date(overrides.startedAt.getTime() + 30 * 60_000),
    endedAt: null,
    endedBy: null,
    endedByName: null,
    ...overrides,
  }
}

/// N distinct tenants, all on the same day.
function distinctSubjectsOn(day: string, count: number, staffId = 'staff-1'): SessionRow[] {
  return Array.from({ length: count }, (_, i) =>
    session({
      startedAt: new Date(`${day}T1${i}:00:00.000Z`),
      impersonatorStaffId: staffId,
      subjectId: `t-${i}`,
      subjectName: `Tenant ${i}`,
    }),
  )
}

describe('frequencyFlags', () => {
  it('says nothing at the threshold, and speaks one above it', () => {
    expect(frequencyFlags(distinctSubjectsOn('2026-08-19', FREQUENCY_FLAG_DISTINCT_SUBJECTS))).toEqual([])

    const flagged = frequencyFlags(distinctSubjectsOn('2026-08-19', FREQUENCY_FLAG_DISTINCT_SUBJECTS + 1))
    expect(flagged).toHaveLength(1)
    expect(flagged[0].distinctSubjects).toBe(FREQUENCY_FLAG_DISTINCT_SUBJECTS + 1)
    expect(flagged[0].day).toBe('2026-08-19')
  })

  it('counts DISTINCT subjects, not sessions — one tenant reopened all day is not a pattern', () => {
    // The case the flag must not fire on: somebody debugging one problem across
    // a morning. Twenty sessions, one account.
    const sameTenant = Array.from({ length: 20 }, (_, i) =>
      session({ startedAt: new Date(`2026-08-19T0${i % 10}:00:00.000Z`), subjectId: 't-same' }),
    )
    expect(frequencyFlags(sameTenant)).toEqual([])
  })

  it('separates a tenant and a staff user who happen to share an id', () => {
    // `subjectId` is polymorphic — it points at a Tenant or a StaffUser
    // depending on `subjectType` — so the key has to carry the type or two
    // different accounts would count as one.
    const rows = [
      ...distinctSubjectsOn('2026-08-19', FREQUENCY_FLAG_DISTINCT_SUBJECTS),
      session({ startedAt: new Date('2026-08-19T20:00:00.000Z'), subjectType: 'staff', subjectId: 't-0' }),
    ]
    expect(frequencyFlags(rows)).toHaveLength(1)
  })

  it('does not pool separate days into one total', () => {
    // Three on Monday and three on Tuesday is six accounts and no flag: the
    // rule is "in a day", and summing a week would flag ordinary use.
    const rows = [
      ...distinctSubjectsOn('2026-08-17', 3),
      ...distinctSubjectsOn('2026-08-18', 3).map((row) => ({ ...row, subjectId: `${row.subjectId}-b` })),
    ]
    expect(frequencyFlags(rows)).toEqual([])
  })

  it('does not pool separate people into one total', () => {
    const rows = [
      ...distinctSubjectsOn('2026-08-19', 3, 'staff-1'),
      ...distinctSubjectsOn('2026-08-19', 3, 'staff-2'),
    ]
    expect(frequencyFlags(rows)).toEqual([])
  })

  it('reports the worst offender first', () => {
    const rows = [
      ...distinctSubjectsOn('2026-08-19', FREQUENCY_FLAG_DISTINCT_SUBJECTS + 1, 'staff-1'),
      ...distinctSubjectsOn('2026-08-19', FREQUENCY_FLAG_DISTINCT_SUBJECTS + 4, 'staff-2'),
    ]
    const flagged = frequencyFlags(rows)
    expect(flagged.map((f) => f.impersonatorStaffId)).toEqual(['staff-2', 'staff-1'])
  })

  it('splits a day at UTC midnight, the same boundary the report groups on', () => {
    const rows = [
      ...distinctSubjectsOn('2026-08-19', FREQUENCY_FLAG_DISTINCT_SUBJECTS),
      session({ startedAt: new Date('2026-08-20T00:30:00.000Z'), subjectId: 't-late' }),
    ]
    expect(frequencyFlags(rows)).toEqual([])
  })
})
