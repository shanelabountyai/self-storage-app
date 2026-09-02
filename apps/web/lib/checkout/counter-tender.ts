import type { CounterMethod } from '@storage/core/pos'
import type { Actor } from '@/lib/rbac/actor'
import {
  counterTenderRefusal,
  recordCounterPayment,
  type CounterTenderProblem,
} from '@/lib/admin/pos'
import { amountDueToday } from './payment'
import { provisionMoveIn, requestDownstream } from './provision'
import type { CheckoutSessionView } from './session'

// PRD 02 §4.8 US-32 / PRD 01 US-501 step 5 (B-230). Cash or a check for a
// move-in taken at the counter.
//
// ── The gap this closes ──────────────────────────────────────────────────────
//
// `startWalkInMoveInAction` hands staff into the SAME public checkout the
// website uses — deliberately, so there is one set of move-in rules rather
// than two that drift. But that checkout's only payment step is the Stripe
// Payment Element, so there was no cash or check option on a move-in AT ALL:
// a walk-in with two hundred dollars in notes could not rent a unit, which
// US-32's own AC has required since it was written and B-039 closed without.
//
// The tender step is the only piece that was missing. Everything it settles
// with is built and unchanged — `settleTender`'s change calculation, D-22's
// gapless receipt numbering, B-078's drawer sessions, US-32's non-overridable
// staff attribution on cash, and RBAC-2's configurable cash ceiling escalating
// to a manager. This does not become a way around any of them.
//
// ── Why the order is provision, THEN take the money ──────────────────────────
//
// A ledger entry needs a lease, and at the moment the notes are handed over
// there is not one: `provisionMoveIn` is what creates it, along with the
// opening charge the payment settles. So the payment cannot be recorded first
// without inventing a lease for it to post against.
//
// That is only safe because every refusal is decided BEFORE anything is
// written — `counterTenderRefusal` — so the sequence cannot provision a lease
// and then discover the cash is over this staffer's approval limit. What is
// left if `recordCounterPayment` fails after a successful provision is a
// tenant who is moved in and owes the move-in total, which is an ordinary
// balance the POS screen settles in one payment. The other order's failure —
// money recorded against no lease — is the one nothing can reconcile, and it
// is the same defect FR-4.6 is written to prevent in the other direction.
//
// The CARD path is not this shape and does not need to be: Stripe's webhook
// posts the payment and provisions afterwards, because the money is confirmed
// asynchronously. Cash is settled the moment it is taken.

export type CounterMoveInResult =
  | {
      ok: true
      leaseId: string
      receiptNumber: number
      /// Notes to hand back, for cash. Null for a check or money order — see
      /// `settleTender`'s note on why overpayment by check is a credit rather
      /// than change out of a drawer.
      changeCents: number | null
      amountCents: number
    }
  | {
      ok: false
      problem:
        | CounterTenderProblem
        | 'not_at_payment'
        | 'already_provisioned'
        | 'no_unit'
        | 'moved_in_unpaid'
    }

export async function takeCounterMoveInPayment(
  actor: Actor,
  session: CheckoutSessionView,
  input: {
    method: CounterMethod
    tenderedCents?: number | null
    checkNumber?: string | null
  },
): Promise<CounterMoveInResult> {
  // The step is the authority, not the screen. A tender posted against a
  // session still on the lease step would move somebody in without a signed
  // lease — the steps before this one are not decoration.
  if (session.step !== 'payment' || session.status !== 'active') {
    return { ok: false, problem: 'not_at_payment' }
  }
  if (!session.tenantId) return { ok: false, problem: 'not_at_payment' }

  // The total comes from `amountDueToday`, the same function the screen printed
  // and the same one the card path charges. Never a figure from the form: a
  // total the browser could name is a total the browser could choose, and this
  // form is submitted by a staffer with a cash drawer open.
  const due = await amountDueToday(session)
  const amountCents = due.totalDueTodayCents

  const refusal = await counterTenderRefusal(actor, {
    facilityId: session.facilityId,
    method: input.method,
    amountCents,
    tenderedCents: input.tenderedCents,
    checkNumber: input.checkNumber,
  })
  if (refusal) return { ok: false, problem: refusal.problem }

  const provisioned = await provisionMoveIn(session.id)
  if (!provisioned.ok) return { ok: false, problem: 'no_unit' }
  // Somebody has already completed this checkout — a second press, or a card
  // that cleared while the staffer was counting notes. Taking the cash now
  // would be a second payment for one move-in, and the honest answer is to
  // stop and say so rather than to record it and leave a credit nobody
  // expected on a brand-new account.
  if (provisioned.alreadyProvisioned) return { ok: false, problem: 'already_provisioned' }

  const payment = await recordCounterPayment(actor, {
    facilityId: session.facilityId,
    tenantId: session.tenantId,
    leaseId: provisioned.leaseId,
    method: input.method,
    amountCents,
    tenderedCents: input.tenderedCents,
    checkNumber: input.checkNumber,
  })

  // FR-4.6, in the one order this function can produce it: the tenant IS moved
  // in — the lease, the unit and the opening charge all committed — and the
  // money did not record. Reported as its own problem rather than as the
  // underlying refusal, because "cash tendered is less than the amount" would
  // be read as "nothing happened", and something very much did.
  if (!payment.ok) return { ok: false, problem: 'moved_in_unpaid' }

  // The gate code and the welcome email, exactly as the webhook path requests
  // them. Best-effort by design (`requestDownstream` raises an admin task and
  // rethrows), so a hardware queue that is down cannot un-move-in somebody who
  // has paid — caught here for the same reason `applyStripeEvent` lets the
  // webhook retry: the renter is standing at the desk and the receipt is real.
  for (const leaseId of provisioned.leaseIds) {
    try {
      await requestDownstream(leaseId)
    } catch {
      // Swallowed deliberately; the task `requestDownstream` raised is what a
      // human acts on, and the `lease.moved_in` consumer retries on the cron.
    }
  }

  return {
    ok: true,
    leaseId: provisioned.leaseId,
    receiptNumber: payment.receiptNumber,
    changeCents: payment.changeCents,
    amountCents,
  }
}
