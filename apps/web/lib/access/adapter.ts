import type { GateCommandType } from '@storage/db'

// PRD 03 §4.1 / FR-3. The port every gate controller sits behind.
//
// CLAUDE.md: gate hardware runs against the simulated adapter — never assume a
// real vendor API. D-4 settled the same posture for undecided vendors: define
// the contract, ship something real behind it, and write the first driver when
// there is a controller on a bench.

export type GateCommandInput = {
  type: GateCommandType
  /// Opaque to the adapter — the code reference, the zone, whatever the vendor
  /// needs. Never the plaintext PIN in a log.
  payload: Record<string, unknown>
}

export type AdapterResult =
  | { ok: true }
  /// Retry me. A controller that is offline, slow, or rate-limiting.
  | { ok: false; retryable: true; message: string }
  /// Do not retry. A rejected code, an unknown zone — retrying will fail
  /// identically and only delays the staff alert that is the real fix.
  | { ok: false; retryable: false; message: string }

export type GateAdapter = {
  name: string
  send(command: GateCommandInput): Promise<AdapterResult>
}

/// The adapter every facility uses today.
///
/// It succeeds, and that is deliberate rather than lazy: the value of running
/// against a simulator is that the *queue* — idempotency, retry, backoff, dead
/// letters, staff alerts — is exercised for real. Failure modes are injected in
/// tests through `failingAdapter`, not by making the default flaky.
export const simulatedAdapter: GateAdapter = {
  name: 'simulated',
  async send() {
    return { ok: true }
  },
}

/// For tests and for the "what happens when the car park is offline" drill.
export function scriptedAdapter(results: AdapterResult[]): GateAdapter {
  let index = 0
  return {
    name: 'scripted',
    async send() {
      const result = results[Math.min(index, results.length - 1)]
      index += 1
      return result
    },
  }
}

/// Per-facility adapter selection (FR-3).
///
/// Every facility is on the simulator, so the argument is unused today — it is
/// in the signature because the callers are already passing the right thing,
/// and adding it later would mean touching every call site to fix a lookup.
export function adapterFor(facilityId: string): GateAdapter {
  void facilityId
  return simulatedAdapter
}
