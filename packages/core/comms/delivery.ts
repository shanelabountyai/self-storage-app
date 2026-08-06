// PRD 05 FR-14 / FR-15 (B-054). What a provider tells us about a message, and
// what follows from it.
//
// FR-14 asks for a normalised state machine — `queued → sent → delivered |
// bounced | failed | filtered` — and for handlers that are idempotent, because
// "provider retries must not duplicate status rows".
//
// Both fall out of one rule: **status only ever moves forward.** Providers
// retry, and they deliver out of order — a `delivered` webhook routinely
// arrives before the `sent` one it followed. A handler that simply wrote
// whatever arrived would flip a delivered message back to sent and then leave
// it there, and the send log is the evidence a lien file leans on.

export type DeliveryStatus =
  | 'queued'
  | 'sent'
  | 'delivered'
  | 'bounced'
  | 'failed'
  | 'suppressed'
  | 'cancelled'

/// How far along each status is. A higher rank never yields to a lower one.
///
/// The three terminal outcomes share the top rank rather than ordering among
/// themselves: a message is delivered or it is not, and nothing a provider
/// sends afterwards should overwrite which. `suppressed` and `cancelled` are
/// terminal too — they are decisions WE made before sending, and a provider has
/// no standing to contradict them.
const RANK: Record<DeliveryStatus, number> = {
  queued: 0,
  sent: 1,
  delivered: 2,
  bounced: 2,
  failed: 2,
  suppressed: 3,
  cancelled: 3,
}

/// The status to store, or null to ignore this event.
///
/// Null is the common case on a retry and is not an error — it is the whole
/// idempotency guarantee. Callers should treat it as "acknowledge and do
/// nothing", never as a failure to report to the provider, or the provider
/// will keep retrying forever.
export function nextDeliveryStatus(
  current: DeliveryStatus,
  incoming: DeliveryStatus,
): DeliveryStatus | null {
  if (current === incoming) return null
  // A decision we made outright is never revised by a provider callback.
  if (RANK[current] === 3) return null
  return RANK[incoming] > RANK[current] ? incoming : null
}

/// Resend's event names, normalised. Anything unrecognised returns null and is
/// acknowledged — an unhandled event type is not an error, and returning
/// non-2xx for one would make the provider retry something we were never going
/// to act on. Same posture as the Stripe reconciler (B-019).
export function statusFromResendEvent(type: string): DeliveryStatus | null {
  switch (type) {
    case 'email.sent':
      return 'sent'
    case 'email.delivered':
      return 'delivered'
    case 'email.bounced':
      return 'bounced'
    case 'email.complained':
      // A spam complaint is not a delivery failure — it arrived, and the
      // recipient reported us. It is recorded as delivered and its real
      // consequence is the non-removable suppression below.
      return 'delivered'
    case 'email.delivery_delayed':
      // Not terminal and not a regression. Ignored deliberately: a delay that
      // later delivers would otherwise leave the log saying "failed".
      return null
    default:
      return null
  }
}

export type DeliveryConsequence = {
  /// FR-15: hard bounce → suppression; spam complaint → suppression that
  /// CN-20 forbids removing.
  suppress: 'hard_bounce' | 'complaint' | null
  /// FR-15's tenant flag — the address is unusable, and every later screen that
  /// shows contact details should say so.
  flagTenant: boolean
  /// CN-19: "hard bounce or invalid number auto-flags the tenant record and
  /// creates a task in PRD 02's task system." A task, not a private queue
  /// table — §4.9 is explicit that every later queue reads `Task`.
  raiseTask: boolean
}

const NOTHING: DeliveryConsequence = { suppress: null, flagTenant: false, raiseTask: false }

/// What has to happen besides recording the status.
///
/// A *soft* bounce is deliberately excluded: a full mailbox or a temporary
/// server failure is not a reason to stop writing to someone forever, and
/// suppressing on one would silently cut a paying tenant off from every notice
/// this system sends. Only a hard bounce and a complaint carry consequences.
export function consequencesOf(eventType: string): DeliveryConsequence {
  switch (eventType) {
    case 'email.bounced':
      return { suppress: 'hard_bounce', flagTenant: true, raiseTask: true }
    case 'email.complained':
      // No task: the tenant asked not to hear from us, and a staff task saying
      // "call them about it" is the opposite of honouring that. Suppressed and
      // flagged so nobody adds them back by hand without seeing why.
      return { suppress: 'complaint', flagTenant: true, raiseTask: false }
    default:
      return NOTHING
  }
}

/// CN-20: manual and bounce entries may be removed; STOP and complaints never.
///
/// A STOP is a legal instruction from the recipient and a complaint is a
/// deliverability black mark against the whole sending domain — undoing either
/// from an admin screen is exactly the thing that gets a domain blocked, so it
/// is refused rather than permitted-with-a-warning.
export function suppressionIsRemovable(reason: string): boolean {
  return reason === 'manual' || reason === 'hard_bounce'
}

/// CN-18: the send log is shown to staff with the destination masked.
///
/// Enough to confirm "yes, that is the address we have" without putting a full
/// contact detail on a screen anyone at the counter can read over a shoulder.
/// The whole address stays in the database — it is the delivery evidence.
export function maskAddress(address: string): string {
  const at = address.lastIndexOf('@')
  if (at < 1) {
    // A phone number, or something unrecognisable. Show the last four.
    return address.length <= 4 ? '••••' : `••••${address.slice(-4)}`
  }
  const local = address.slice(0, at)
  const shown = local.slice(0, Math.min(2, local.length - 1)) || local[0]
  return `${shown}${'•'.repeat(Math.max(1, local.length - shown.length))}${address.slice(at)}`
}
