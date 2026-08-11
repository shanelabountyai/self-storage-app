import { describe, expect, it } from 'vitest'
import {
  diffControllerState,
  summarizeDrift,
  windowFingerprint,
  type ActualCredential,
  type ExpectedCredential,
} from '../packages/core/access'
import { concernsFor } from '../apps/web/lib/admin/gate-health'
import type { FacilityGateHealth } from '../apps/web/lib/admin/gate-health'

// B-080 / PRD 03 FR-9. The comparison a gate's correctness rests on, proved
// without a controller, a database or a clock.

const expected = (over: Partial<ExpectedCredential> = {}): ExpectedCredential => ({
  credentialId: 'cred-1',
  codeHash: 'hash-a',
  shouldOpen: true,
  windowFingerprint: 'sched:{"mon":"9-5"}',
  ...over,
})

const actual = (over: Partial<ActualCredential> = {}): ActualCredential => ({
  credentialId: 'cred-1',
  externalId: 'vendor-1',
  codeHash: 'hash-a',
  opens: true,
  windowFingerprint: 'sched:{"mon":"9-5"}',
  ...over,
})

describe('diffControllerState', () => {
  it('finds nothing when both sides agree', () => {
    expect(diffControllerState([expected()], [actual()])).toEqual([])
  })

  it('flags a code the controller honours that we know nothing about', () => {
    // The single most valuable finding: a former tenant whose code still works.
    const drifts = diffControllerState([], [actual({ credentialId: null, externalId: 'ghost-9' })])
    expect(drifts).toHaveLength(1)
    expect(drifts[0].kind).toBe('unknown_at_controller')
    expect(drifts[0].gateTooPermissive).toBe(true)
    expect(drifts[0].externalId).toBe('ghost-9')
  })

  it('does NOT call a disabled orphan entry a security finding', () => {
    // Untidy, not dangerous. Flagging it as urgent trains people to ignore the
    // ones that are.
    const drifts = diffControllerState([], [actual({ credentialId: null, opens: false })])
    expect(drifts[0].kind).toBe('unknown_at_controller')
    expect(drifts[0].gateTooPermissive).toBe(false)
  })

  it('flags a credential the controller has never heard of', () => {
    const drifts = diffControllerState([expected()], [])
    expect(drifts).toHaveLength(1)
    expect(drifts[0].kind).toBe('missing_at_controller')
    // Somebody on the phone, not somebody in the building.
    expect(drifts[0].gateTooPermissive).toBe(false)
  })

  it('says nothing about a REVOKED credential the controller has forgotten', () => {
    // That is the system working. A revoke that removed the entry, reported as
    // drift, would make every move-out generate a finding.
    expect(diffControllerState([expected({ shouldOpen: false })], [])).toEqual([])
  })

  it('flags a gate that opens for someone we have suspended', () => {
    const drifts = diffControllerState([expected({ shouldOpen: false })], [actual({ opens: true })])
    expect(drifts).toHaveLength(1)
    expect(drifts[0].kind).toBe('open_state_mismatch')
    expect(drifts[0].gateTooPermissive).toBe(true)
  })

  it('flags a gate that refuses someone we expect to get in — but not as permissive', () => {
    const drifts = diffControllerState([expected()], [actual({ opens: false })])
    expect(drifts[0].kind).toBe('open_state_mismatch')
    expect(drifts[0].gateTooPermissive).toBe(false)
  })

  it('reports a rotated code as ONE finding, not a missing plus an unknown', () => {
    // Matched by credential id, not by code. Matching by code would report two
    // findings for one fact and make every rotation look like a break-in.
    const drifts = diffControllerState([expected()], [actual({ codeHash: 'hash-b' })])
    expect(drifts).toHaveLength(1)
    expect(drifts[0].kind).toBe('code_mismatch')
  })

  it('says nothing about codes when either side cannot report one', () => {
    // Most real vendors will not return a PIN. "Cannot verify" must not read as
    // "they differ", or the report cries drift on every credential forever.
    expect(diffControllerState([expected({ codeHash: null })], [actual()])).toEqual([])
    expect(diffControllerState([expected()], [actual({ codeHash: null })])).toEqual([])
  })

  it('flags a controller enforcing no time window at all as too permissive', () => {
    const drifts = diffControllerState([expected()], [actual({ windowFingerprint: null })])
    expect(drifts).toHaveLength(1)
    expect(drifts[0].kind).toBe('window_mismatch')
    expect(drifts[0].gateTooPermissive).toBe(true)
  })

  it('flags a different window without calling it permissive', () => {
    const drifts = diffControllerState([expected()], [actual({ windowFingerprint: 'exempt' })])
    expect(drifts[0].kind).toBe('window_mismatch')
    expect(drifts[0].gateTooPermissive).toBe(false)
  })

  it('reports several findings for one credential when several things differ', () => {
    const drifts = diffControllerState(
      [expected()],
      [actual({ opens: false, codeHash: 'hash-b', windowFingerprint: null })],
    )
    expect(drifts.map((drift) => drift.kind).sort()).toEqual([
      'code_mismatch',
      'open_state_mismatch',
      'window_mismatch',
    ])
  })
})

describe('summarizeDrift', () => {
  it('counts by kind and counts the permissive ones separately', () => {
    const drifts = diffControllerState(
      [expected({ shouldOpen: false }), expected({ credentialId: 'cred-2', codeHash: 'x' })],
      [actual({ opens: true }), actual({ credentialId: null, externalId: 'ghost' })],
    )
    const summary = summarizeDrift(drifts)
    expect(summary.total).toBe(drifts.length)
    // Two things the gate is too open about: the suspended tenant who still
    // gets in, and the code nobody can account for.
    expect(summary.tooPermissive).toBe(2)
    expect(summary.byKind.open_state_mismatch).toBe(1)
    expect(summary.byKind.unknown_at_controller).toBe(1)
  })

  it('reports zeros for kinds that did not occur', () => {
    expect(summarizeDrift([]).byKind.code_mismatch).toBe(0)
  })
})

describe('windowFingerprint', () => {
  it('is order-independent', () => {
    // A schedule written by a form and one written by a seed serialise
    // differently. Key-order sensitivity here would flag every credential at
    // every facility, which is how a reconciliation report gets switched off.
    expect(windowFingerprint({ schedule: { a: 1, b: 2 }, exempt: false })).toBe(
      windowFingerprint({ schedule: { b: 2, a: 1 }, exempt: false }),
    )
  })

  it('collapses extended hours to one value regardless of schedule', () => {
    expect(windowFingerprint({ schedule: { a: 1 }, exempt: true })).toBe('exempt')
    expect(windowFingerprint({ schedule: null, exempt: true })).toBe('exempt')
  })

  it('distinguishes "no window pushed" from any schedule', () => {
    expect(windowFingerprint({ schedule: null, exempt: false })).toBeNull()
    expect(windowFingerprint({ schedule: {}, exempt: false })).not.toBeNull()
  })
})

describe('concernsFor', () => {
  const healthy = (over: Partial<FacilityGateHealth> = {}): FacilityGateHealth => ({
    facilityId: 'f1',
    facilityName: 'Test',
    adapter: 'simulated',
    simulated: { offline: false, latencyMs: 0, webhookFailing: false },
    commands: {
      pending: 0,
      failed: 0,
      awaitingManual: 0,
      deadLettered: 0,
      oldestPendingMinutes: null,
      lastSucceededAt: new Date(),
    },
    events: { last24h: 12, lastEventAt: new Date(), quietHours: 0 },
    reconciliation: {
      businessDate: new Date('2026-08-10'),
      verifiable: true,
      driftCount: 0,
      permissiveCount: 0,
      credentialsChecked: 20,
      finishedAt: new Date(),
    },
    webhookSecret: { configured: true, activeSince: new Date(), retiring: [], unavailable: false },
    cameras: 1,
    ...over,
  })

  it('says nothing about a healthy site', () => {
    expect(concernsFor(healthy())).toEqual([])
  })

  it('treats a dead-lettered command as urgent', () => {
    const concerns = concernsFor(
      healthy({ commands: { ...healthy().commands, deadLettered: 2 } }),
    )
    expect(concerns[0].level).toBe('urgent')
  })

  it('treats a gate that is too open as urgent', () => {
    const concerns = concernsFor(
      healthy({ reconciliation: { ...healthy().reconciliation!, driftCount: 1, permissiveCount: 1 } }),
    )
    expect(concerns.some((concern) => concern.level === 'urgent')).toBe(true)
  })

  it('does not call a never-reconciled site healthy', () => {
    // The failure this exists to prevent: an empty concerns list reading as a
    // clean bill of health for a site nothing has ever checked.
    expect(concernsFor(healthy({ reconciliation: null }))).not.toEqual([])
  })

  it('does not call an unverifiable reconciliation clean either', () => {
    const concerns = concernsFor(
      healthy({ reconciliation: { ...healthy().reconciliation!, verifiable: false } }),
    )
    expect(concerns).not.toEqual([])
  })

  it('notices a webhook feed that has gone quiet', () => {
    // Identical to a quiet weekend from every other screen, which is why it
    // needs saying here.
    const concerns = concernsFor(
      healthy({ events: { last24h: 0, lastEventAt: new Date(), quietHours: 72 } }),
    )
    expect(concerns.some((concern) => concern.message.includes('No gate events'))).toBe(true)
  })

  it('leaves a brand-new site with no events alone', () => {
    // Never had an event is not the same as stopped having them.
    const concerns = concernsFor(
      healthy({ events: { last24h: 0, lastEventAt: null, quietHours: null } }),
    )
    expect(concerns.some((concern) => concern.message.includes('No gate events'))).toBe(false)
  })
})
