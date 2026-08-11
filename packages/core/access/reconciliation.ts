// PRD 03 FR-9 (B-080). "Nightly + on-demand expected-vs-actual diff;
// discrepancy tasks; metrics (drift count per facility)."
//
// Why this exists at all: every write to a gate controller is a command sent
// over a boundary we do not own, and B-027's outbox can tell you a command was
// ACCEPTED but never that the controller still agrees with us a month later. A
// dead-lettered revoke, a vendor-side edit somebody made in the vendor's own
// portal, a controller restored from a backup — all of them leave our database
// and the hardware saying different things, and the failure is silent in the
// only direction that matters. A former tenant's code that still opens the gate
// does not raise an error; it just works.
//
// Pure, and deliberately so. The comparison is the part that has to be right,
// and it should be provable without a controller, a database or a clock.

/// What we believe the controller ought to hold for one credential.
export type ExpectedCredential = {
  credentialId: string
  /// SHA-256 of the code, never the code. A drift report is read on a screen,
  /// written to a job log and attached to a task — none of which are places a
  /// gate code belongs (SR-1). Hashes compare exactly as well.
  codeHash: string | null
  /// Whether this code should open the gate right now: the grant is active and
  /// the credential has not been revoked.
  shouldOpen: boolean
  /// Whatever the adapter pushed as the time window, normalized by the adapter
  /// into something comparable. Null means "no window was ever pushed".
  windowFingerprint: string | null
}

/// What the controller says it holds. Produced by an adapter's `snapshot()`.
export type ActualCredential = {
  /// Null when the controller holds a code we cannot match to any credential —
  /// the ghost-code case, and the single most important thing this finds.
  credentialId: string | null
  /// The vendor's own identifier, so a person can find the row in the vendor's
  /// portal. For the simulator this is its row id.
  externalId: string
  codeHash: string | null
  opens: boolean
  windowFingerprint: string | null
}

export const DRIFT_KINDS = [
  'missing_at_controller',
  'unknown_at_controller',
  'open_state_mismatch',
  'code_mismatch',
  'window_mismatch',
] as const

export type DriftKind = (typeof DRIFT_KINDS)[number]

/// Ordered worst-first. Two of these are security findings and three are
/// service problems, and a screen that sorts them alphabetically buries the
/// difference.
export const DRIFT_SEVERITY: Record<DriftKind, 'security' | 'service'> = {
  // A code the controller honours that we know nothing about. Could be a
  // former tenant, could be a vendor-portal edit, could be a restored backup.
  unknown_at_controller: 'security',
  // We think this person's access is suspended or revoked; the gate disagrees.
  // Only counted as security when the gate is the more permissive of the two —
  // `driftFor` decides that, not this table.
  open_state_mismatch: 'security',
  code_mismatch: 'service',
  missing_at_controller: 'service',
  window_mismatch: 'service',
}

export const DRIFT_LABELS: Record<DriftKind, string> = {
  missing_at_controller: 'We issued this code; the controller has never heard of it',
  unknown_at_controller: 'The controller honours a code we have no record of',
  open_state_mismatch: 'The controller and we disagree about whether this code opens the gate',
  code_mismatch: 'Same credential, different code',
  window_mismatch: 'The controller is enforcing a different time window',
}

export type Drift = {
  kind: DriftKind
  credentialId: string | null
  externalId: string | null
  /// True when the CONTROLLER is more permissive than we intend. The
  /// distinction a manager needs at 7am: a code that opens when it should not
  /// is somebody in the building, while a code that fails to open when it
  /// should is somebody on the phone.
  gateTooPermissive: boolean
  detail: string
}

/// The whole of FR-9's comparison.
///
/// Matched by `credentialId`, not by code: a rotated code is one credential
/// with a `code_mismatch`, not a missing one plus an unknown one. Getting that
/// wrong would report two findings for one fact and make every rotation look
/// like a break-in.
export function diffControllerState(
  expected: readonly ExpectedCredential[],
  actual: readonly ActualCredential[],
): Drift[] {
  const drifts: Drift[] = []
  const actualById = new Map<string, ActualCredential>()

  for (const row of actual) {
    if (row.credentialId) actualById.set(row.credentialId, row)
    else {
      drifts.push({
        kind: 'unknown_at_controller',
        credentialId: null,
        externalId: row.externalId,
        // Only if it actually opens. A disabled orphan row on the controller is
        // untidy, not dangerous, and flagging it as a security finding would
        // train people to ignore the ones that are.
        gateTooPermissive: row.opens,
        detail: row.opens
          ? `Controller entry ${row.externalId} opens the gate and matches no credential on file`
          : `Controller entry ${row.externalId} matches no credential on file (currently disabled)`,
      })
    }
  }

  for (const want of expected) {
    const has = actualById.get(want.credentialId)

    if (!has) {
      // Only a finding if we expected it to work. A revoked credential the
      // controller has already forgotten is the system working.
      if (want.shouldOpen) {
        drifts.push({
          kind: 'missing_at_controller',
          credentialId: want.credentialId,
          externalId: null,
          gateTooPermissive: false,
          detail: 'Issued and expected to open, but the controller holds no such entry',
        })
      }
      continue
    }

    if (has.opens !== want.shouldOpen) {
      drifts.push({
        kind: 'open_state_mismatch',
        credentialId: want.credentialId,
        externalId: has.externalId,
        gateTooPermissive: has.opens && !want.shouldOpen,
        detail: has.opens
          ? 'Opens the gate; we expect it not to'
          : 'Does not open the gate; we expect it to',
      })
    }

    // Compared only when both sides know their code. An adapter that cannot
    // read codes back (most real vendors will not return a PIN) reports null,
    // and null must read as "cannot verify" rather than "they differ" — a
    // reconciliation that cries drift on every credential is one nobody reads.
    if (want.codeHash && has.codeHash && want.codeHash !== has.codeHash) {
      drifts.push({
        kind: 'code_mismatch',
        credentialId: want.credentialId,
        externalId: has.externalId,
        // The controller holds a code the tenant was never given, which locks
        // them out rather than letting anyone in.
        gateTooPermissive: false,
        detail: 'The controller holds a different code from the one on file',
      })
    }

    if (want.windowFingerprint !== has.windowFingerprint) {
      drifts.push({
        kind: 'window_mismatch',
        credentialId: want.credentialId,
        externalId: has.externalId,
        // A controller with NO window pushed is unrestricted, which is more
        // permissive than any schedule we would have sent.
        gateTooPermissive: has.windowFingerprint === null && want.windowFingerprint !== null,
        detail:
          has.windowFingerprint === null
            ? 'The controller is enforcing no time window at all'
            : 'The controller is enforcing a different time window',
      })
    }
  }

  return drifts
}

export type DriftSummary = {
  total: number
  byKind: Record<DriftKind, number>
  /// The count that decides whether this is a page or a ticket.
  tooPermissive: number
}

export function summarizeDrift(drifts: readonly Drift[]): DriftSummary {
  const byKind = Object.fromEntries(DRIFT_KINDS.map((kind) => [kind, 0])) as Record<DriftKind, number>
  for (const drift of drifts) byKind[drift.kind] += 1

  return {
    total: drifts.length,
    byKind,
    tooPermissive: drifts.filter((drift) => drift.gateTooPermissive).length,
  }
}

/// Stable, comparable representation of a time window.
///
/// Both sides of the diff run their schedule through this, so "the same window
/// written differently" — a different key order, a day the form omitted and the
/// controller stored as closed — does not read as drift. Without it the nightly
/// job reports every credential at every facility as broken, which is the
/// classic way a reconciliation report gets switched off in week two.
export function windowFingerprint(input: {
  schedule: unknown
  exempt: boolean
}): string | null {
  if (input.exempt) return 'exempt'
  if (input.schedule === null || input.schedule === undefined) return null
  return `sched:${stableStringify(input.schedule)}`
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`
}
