// PRD 02 US-33 (B-078). What should be in the drawer, what was, and whether
// the difference needs explaining.
//
// Pure: no database, no clock. Every figure is passed in, which is the point —
// this is the arithmetic somebody's job depends on being right, and it should
// be provable without fixtures.
//
// B-039 shipped a deposit slip that reconciled against nothing counted and
// said so in its own comment: "would look like accountability without being
// it." This is the counted side that makes it accountability.

/// One movement of physical money through the drawer during a session.
///
/// Refunds are included with a NEGATIVE amount rather than as a separate
/// bucket: a cash refund is money leaving the same drawer the payments went
/// into, and netting it here is what makes `expectedCash` a single sum rather
/// than a chain of subtractions a reader has to hold in their head.
export type DrawerMovement = {
  method: 'cash' | 'check' | 'money_order' | 'card' | 'ach'
  /// What the tenant paid, in cents. Negative for a refund paid out.
  amountCents: number
  /// Change handed back, for a cash payment. Always positive when present.
  changeCents?: number
}

export type DrawerExpectation = {
  /// Float plus net cash in, minus change given out and cash refunds paid.
  expectedCashCents: number
  /// Cheques and money orders, which are deposited as a list rather than
  /// counted as notes. Kept separate for the same reason the schema does.
  expectedChecksCents: number
}

/// What the drawer should hold at close-out.
///
/// Only cash movements touch `expectedCashCents`. A card payment never enters
/// the drawer at all — it settles to the processor — and including one would
/// make every drawer look over by the day's card takings, which is the single
/// most common way a naive till reconciliation gets built wrong.
export function expectedDrawer(
  openingFloatCents: number,
  movements: readonly DrawerMovement[],
): DrawerExpectation {
  let cash = openingFloatCents
  let checks = 0

  for (const movement of movements) {
    if (movement.method === 'cash') {
      // `amountCents` alone, and the change is deliberately NOT subtracted.
      //
      // `settleTender` defines change as `tendered − amount`, so the drawer
      // takes in the tendered note and hands the change straight back out:
      // net movement is `tendered − change`, which IS `amount`. A $100 note
      // against a $60 bill leaves the drawer $60 up, and subtracting the $40
      // as well would count it twice — the drawer would read $20 and every
      // close-out that gave change would look short.
      cash += movement.amountCents
    } else if (movement.method === 'check' || movement.method === 'money_order') {
      checks += movement.amountCents
    }
    // card and ach: deliberately nothing. They never touch the drawer.
  }

  return { expectedCashCents: cash, expectedChecksCents: checks }
}

/// counted − expected. Positive is over (more money than the system knows
/// about), negative is short.
export function varianceOf(countedCents: number, expectedCents: number): number {
  return countedCents - expectedCents
}

/// US-33: "over/short beyond a configurable threshold requires a manager
/// note."
///
/// Compares the ABSOLUTE variance: a drawer $20 over is exactly as much a
/// problem as one $20 short — an overage usually means a payment was never
/// recorded, which is the same failure seen from the other side. A threshold
/// that only caught shortages would let unrecorded income through silently.
export function varianceNeedsNote(varianceCents: number, thresholdCents: number): boolean {
  return Math.abs(varianceCents) > thresholdCents
}

export type CloseProblem = 'not_open' | 'count_negative' | 'note_required'

/// Every reason a close-out is refused, in the order an operator can act on
/// them. Returns null when the close may proceed.
export function closeProblem(input: {
  status: 'open' | 'closed'
  countedCashCents: number
  countedChecksCents: number
  varianceCents: number
  thresholdCents: number
  note: string
}): CloseProblem | null {
  if (input.status !== 'open') return 'not_open'
  if (input.countedCashCents < 0 || input.countedChecksCents < 0) return 'count_negative'
  if (varianceNeedsNote(input.varianceCents, input.thresholdCents) && !input.note.trim()) {
    return 'note_required'
  }
  return null
}

export type DepositSlip = {
  openingFloatCents: number
  /// Net cash received — what was applied to accounts, which is what the
  /// drawer is actually up by. See `expectedDrawer` on why change is not
  /// subtracted from this.
  cashTakenCents: number
  /// Informational only, and deliberately NOT part of the arithmetic above:
  /// it is already netted inside `cashTakenCents`. On the slip so an
  /// operator can sanity-check a day that felt change-heavy.
  changeGivenCents: number
  cashRefundedCents: number
  checksCents: number
  cardCents: number
  expectedCashCents: number
  expectedChecksCents: number
  /// What actually goes to the bank: everything above the float. A facility
  /// that banks the float too has bigger problems than this function.
  depositCashCents: number
}

/// US-33's "deposit slip summary (cash total, check list)", as figures. The
/// list of cheques is the caller's to render; this is the arithmetic under it.
export function depositSlip(
  openingFloatCents: number,
  movements: readonly DrawerMovement[],
): DepositSlip {
  const expectation = expectedDrawer(openingFloatCents, movements)

  let cashTaken = 0
  let changeGiven = 0
  let cashRefunded = 0
  let card = 0

  for (const movement of movements) {
    if (movement.method === 'cash') {
      if (movement.amountCents >= 0) {
        cashTaken += movement.amountCents
        changeGiven += movement.changeCents ?? 0
      } else {
        cashRefunded += -movement.amountCents
      }
    } else if (movement.method === 'card') {
      card += movement.amountCents
    }
  }

  return {
    openingFloatCents,
    cashTakenCents: cashTaken,
    changeGivenCents: changeGiven,
    cashRefundedCents: cashRefunded,
    checksCents: expectation.expectedChecksCents,
    cardCents: card,
    expectedCashCents: expectation.expectedCashCents,
    expectedChecksCents: expectation.expectedChecksCents,
    depositCashCents: Math.max(0, expectation.expectedCashCents - openingFloatCents),
  }
}
