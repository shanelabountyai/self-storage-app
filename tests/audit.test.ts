import { describe, expect, it } from 'vitest'
import {
  AUDIT_ACTIONS,
  diffSnapshots,
  redact,
  REDACTED,
  requiresReasonCode,
  toCsv,
} from '../packages/core/audit'
import type { AuditLog } from '../packages/db'

describe('audit action catalog', () => {
  it('has unique action keys', () => {
    const keys = AUDIT_ACTIONS.map((a) => a.action)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('requires a reason for actions that forgive or override', () => {
    for (const action of [
      'fee.waived',
      'credit.issued',
      'balance.written_off',
      'refund.issued',
      'delinquency.step_skipped',
      'unit.status_overridden',
      'access.code_viewed',
      'document.deleted',
    ]) {
      expect(requiresReasonCode(action), action).toBe(true)
    }
  })

  it('does not require a reason for routine records', () => {
    expect(requiresReasonCode('payment.recorded')).toBe(false)
    expect(requiresReasonCode('notice.generated')).toBe(false)
  })

  it('treats an unknown action as not requiring a reason', () => {
    expect(requiresReasonCode('something.invented')).toBe(false)
  })
})

describe('redaction', () => {
  it('removes credentials by key name at any depth', () => {
    const result = redact({
      email: 'a@example.com',
      passwordHash: 'scrypt$32768$8$1$abc$def',
      nested: { tokenHash: 'deadbeef', apiKey: 'sk_live_x', keep: 'visible' },
    }) as Record<string, unknown>

    expect(result.email).toBe('a@example.com')
    expect(result.passwordHash).toBe(REDACTED)
    expect((result.nested as Record<string, unknown>).tokenHash).toBe(REDACTED)
    expect((result.nested as Record<string, unknown>).apiKey).toBe(REDACTED)
    expect((result.nested as Record<string, unknown>).keep).toBe('visible')
  })

  it('redacts the gate-code reference', () => {
    // PRD 03 SR-2: seeing a real code is a separate, audited permission — it
    // must not leak into a seven-year log as a side effect.
    const result = redact({ valueRef: 'pin:4821', state: 'active' }) as Record<string, unknown>
    expect(result.valueRef).toBe(REDACTED)
    expect(result.state).toBe('active')
  })

  it('matches key names regardless of case or separators', () => {
    const result = redact({
      API_KEY: 'x',
      'card-number': 'y',
      newPassword: 'z',
    }) as Record<string, unknown>
    expect(Object.values(result)).toEqual([REDACTED, REDACTED, REDACTED])
  })

  it('normalises values that are not JSON-safe', () => {
    const date = new Date('2026-07-30T12:00:00.000Z')
    const result = redact({ when: date, big: 10n, missing: undefined }) as Record<string, unknown>
    expect(result.when).toBe('2026-07-30T12:00:00.000Z')
    expect(result.big).toBe('10')
    expect(result.missing).toBeNull()
  })

  it('survives a cyclic object instead of hanging', () => {
    const cyclic: Record<string, unknown> = { name: 'loop' }
    cyclic.self = cyclic
    expect(() => redact(cyclic)).not.toThrow()
  })
})

describe('diffing snapshots', () => {
  it('keeps only fields that changed', () => {
    const diff = diffSnapshots(
      { id: 'u1', status: 'available', notes: 'same' },
      { id: 'u1', status: 'occupied', notes: 'same' },
    )
    expect(diff).toEqual({ before: { status: 'available' }, after: { status: 'occupied' } })
  })

  it('ignores churn columns that carry no intent', () => {
    const diff = diffSnapshots(
      { status: 'available', updatedAt: new Date('2026-01-01'), version: 1 },
      { status: 'available', updatedAt: new Date('2026-07-30'), version: 2 },
    )
    expect(diff).toEqual({ before: {}, after: {} })
  })

  it('records added and removed fields', () => {
    const diff = diffSnapshots({ a: 1 }, { b: 2 })
    expect(diff).toEqual({ before: { a: 1, b: null }, after: { a: null, b: 2 } })
  })

  it('redacts inside the diff, not just the snapshot', () => {
    const diff = diffSnapshots(
      { passwordHash: 'old-hash' },
      { passwordHash: 'new-hash' },
    )
    // Both sides changed, so the key appears — but never with real values.
    expect(diff.before.passwordHash).toBe(REDACTED)
    expect(diff.after.passwordHash).toBe(REDACTED)
  })

  it('handles a create with no prior state', () => {
    const diff = diffSnapshots(null, { status: 'active' })
    expect(diff.before).toEqual({ status: null })
    expect(diff.after).toEqual({ status: 'active' })
  })
})

describe('csv export', () => {
  const entry = {
    id: 'a1',
    facilityId: 'f1',
    actorType: 'staff',
    actorStaffId: 's1',
    actorLabel: null,
    entityType: 'Unit',
    entityId: 'u1',
    action: 'unit.status_overridden',
    before: { status: 'available' },
    after: { status: 'occupied' },
    reasonCode: 'management_approval',
    correlationId: null,
    occurredAt: new Date('2026-07-30T18:30:00.000Z'),
  } as unknown as AuditLog

  it('emits a header and one row per entry', () => {
    const lines = toCsv([entry]).split('\n')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain('occurredAt,occurredAtLocal')
    expect(lines[1]).toContain('"unit.status_overridden"')
    expect(lines[1]).toContain('"{""status"":""available""}"')
  })

  it('renders the facility-local time alongside UTC', () => {
    const csv = toCsv([entry], { f1: 'America/Chicago' })
    expect(csv).toContain('2026-07-30T18:30:00.000Z')
    // 18:30 UTC is 13:30 CDT.
    expect(csv).toMatch(/1:30:00.PM/)
  })

  it('neutralises spreadsheet formula injection', () => {
    const dangerous = { ...entry, reasonCode: '=cmd|calc' } as unknown as AuditLog
    expect(toCsv([dangerous])).toContain(`"'=cmd|calc"`)
  })

  it('escapes embedded quotes', () => {
    const quoted = { ...entry, reasonCode: 'say "hi"' } as unknown as AuditLog
    expect(toCsv([quoted])).toContain('"say ""hi"""')
  })
})
