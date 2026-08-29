// PRD 02 §4.4 US-42 (B-096). What a hold IS, and what each type stops.
//
// US-42's AC is emphatic about the shape: "effects are declared per hold type
// as configuration, not hardcoded per screen ... A new hold type is a
// configuration row, not six code changes." So this file is the configuration,
// every consumer asks it rather than switching on the type, and adding a type
// is an entry here.
//
// ── Why this exists at all ───────────────────────────────────────────────────
//
// US-25 already said the delinquency pipeline halts on "payment/move-out/hold"
// and nothing anywhere defined a hold. A tenant deploys, files Chapter 7, or
// dies and his daughter calls: selling the goods of an active-duty
// servicemember without a court order, or of a debtor under an automatic stay,
// is not a bad customer experience — it is a federal problem.
//
// ── Draft, not legal advice (D-10) ───────────────────────────────────────────
//
// Which effects each type must carry in Texas needs an attorney pass, and
// US-42's own note says so. The mechanism is built now regardless, because the
// exposure is uncapped while it does not exist. The effects below are a
// defensible starting point, not a legal opinion.

export const HOLD_EFFECTS = [
  /// Stop the past-due chasing: dunning steps and retry reminders. Does NOT
  /// stop an ordinary "rent is due on the 1st" reminder — a tenant on a payment
  /// plan still has rent due, and going silent would be its own problem.
  'halt_dunning',
  'halt_late_fees',
  /// B-098's day-N gate suspension, and B-057/B-058's later timeline step.
  'halt_access_suspension',
  /// Hard block. Never a warning a manager can click past.
  'block_auction',
  'suppress_marketing',
  /// Stop charging the saved card.
  ///
  /// NOT in US-42's original list, and added deliberately in B-096: an
  /// automatic stay under Chapter 7 makes taking money from a debtor a
  /// violation, and charging a dead person's card is its own problem. Halting
  /// dunning while continuing to help ourselves to the balance would be the
  /// worst of both. Flagged for the same attorney pass as everything else here.
  'halt_autopay',
] as const

export type HoldEffect = (typeof HOLD_EFFECTS)[number]

export type HoldTypeSpec = {
  type: string
  /// What a staffer sees in the picker and on the banner.
  label: string
  /// The one-line explanation on the banner, written for whoever opens the
  /// profile next rather than for whoever placed it.
  bannerNote: string
  effects: readonly HoldEffect[]
  /// US-42: "lifting a `military_scra` or `bankruptcy` hold requires
  /// manager-or-above."
  liftRequiresManager: boolean
  /// US-42: "the `deceased` type records an estate contact."
  requiresEstateContact: boolean
}

export const HOLD_TYPES = [
  {
    type: 'military_scra',
    label: 'Military (SCRA)',
    bannerNote:
      'Servicemembers Civil Relief Act protections apply. Do not sell, suspend access, or send collections without checking with a manager.',
    // Everything. The SCRA restricts enforcement against an active-duty
    // servicemember's property without a court order, and the safe reading of
    // an uncertain scope is the broad one.
    effects: ['halt_dunning', 'halt_late_fees', 'halt_access_suspension', 'block_auction', 'suppress_marketing', 'halt_autopay'],
    liftRequiresManager: true,
    requiresEstateContact: false,
  },
  {
    type: 'bankruptcy',
    label: 'Bankruptcy',
    bannerNote:
      'An automatic stay may be in force. Collections, fees, access suspension and sale are all stopped until a manager confirms otherwise.',
    effects: ['halt_dunning', 'halt_late_fees', 'halt_access_suspension', 'block_auction', 'suppress_marketing', 'halt_autopay'],
    liftRequiresManager: true,
    requiresEstateContact: false,
  },
  {
    type: 'deceased',
    label: 'Tenant deceased',
    bannerNote:
      'Access decisions are staff-only and must go through the estate contact recorded below. Do not act on a portal request for this unit.',
    effects: ['halt_dunning', 'halt_late_fees', 'halt_access_suspension', 'block_auction', 'suppress_marketing', 'halt_autopay'],
    liftRequiresManager: false,
    requiresEstateContact: true,
  },
  {
    type: 'litigation',
    label: 'Litigation',
    bannerNote: 'This account is in litigation. Do not sell the contents or send collections.',
    effects: ['halt_dunning', 'halt_late_fees', 'block_auction', 'suppress_marketing'],
    liftRequiresManager: false,
    requiresEstateContact: false,
  },
  {
    type: 'dispute',
    label: 'Billing dispute',
    bannerNote:
      'The tenant disputes what is owed. Fees and collections are paused while it is looked into — access is unaffected.',
    // Deliberately narrow: a dispute about a charge is not a reason to stop
    // taking a payment the tenant chose to make, nor to open the gate policy.
    effects: ['halt_dunning', 'halt_late_fees'],
    liftRequiresManager: false,
    requiresEstateContact: false,
  },
  {
    type: 'do_not_contact',
    label: 'Do not contact',
    bannerNote: 'The tenant has asked not to be contacted. Speak to them in person or by post only.',
    // Stops the sending, not the owing. Fees still accrue and the gate policy
    // still applies — this is a channel instruction, not forbearance.
    effects: ['halt_dunning', 'suppress_marketing'],
    liftRequiresManager: false,
    requiresEstateContact: false,
  },
  {
    type: 'payment_plan',
    label: 'Payment plan',
    bannerNote:
      'The tenant is on an agreed plan. Late fees and collections are paused while they keep to it — check the plan before taking action.',
    // B-202. `block_auction` is here for a different reason than it is on
    // `military_scra` or `bankruptcy` — selling under those is a federal
    // problem, selling under this one is selling the goods of a tenant holding
    // a payment agreement we generated and emailed him. It is the commonest of
    // the two at the counter by a wide margin, and it was the only one of the
    // "tenant is not actually in default any more" events missing from the
    // list D-104 built the lot sheet's refusal rule around. Blocking is the
    // safe default; whether agreeing a plan on a `scheduled` case should also
    // CANCEL it is an owner decision and not this row's.
    effects: ['halt_dunning', 'halt_late_fees', 'halt_access_suspension', 'block_auction'],
    liftRequiresManager: false,
    requiresEstateContact: false,
  },
] as const satisfies readonly HoldTypeSpec[]

export type HoldType = (typeof HOLD_TYPES)[number]['type']

const BY_TYPE = new Map<string, HoldTypeSpec>(HOLD_TYPES.map((spec) => [spec.type, spec]))

export function holdTypeSpec(type: string): HoldTypeSpec | undefined {
  return BY_TYPE.get(type)
}

export type HoldLike = { type: string; effectiveFrom: Date; effectiveTo: Date | null; liftedAt: Date | null }

/// Whether a hold is in force at an instant.
///
/// Three ways to not be in force and they are different facts: it has not
/// started, it has expired, or a person lifted it early. All three are checked
/// because a hold with an end date that a manager also lifted must not come
/// back to life on the strength of the end date being in the future.
export function holdIsActive(hold: HoldLike, asOf: Date): boolean {
  if (hold.liftedAt !== null) return false
  if (hold.effectiveFrom.getTime() > asOf.getTime()) return false
  if (hold.effectiveTo !== null && hold.effectiveTo.getTime() <= asOf.getTime()) return false
  return true
}

/// The union of every effect the active holds declare.
///
/// A union, not a precedence order: US-42 says "multiple concurrent holds are
/// allowed and each is evaluated independently", so a narrow hold can never
/// weaken a broad one sitting beside it. An unknown type contributes nothing
/// rather than everything — fail-closed would mean a typo silently freezing an
/// account, and the catalog is code rather than user input, so the typo is
/// caught at the placement boundary instead.
export function effectsOf(holds: readonly HoldLike[], asOf: Date): Set<HoldEffect> {
  const effects = new Set<HoldEffect>()
  for (const hold of holds) {
    if (!holdIsActive(hold, asOf)) continue
    for (const effect of holdTypeSpec(hold.type)?.effects ?? []) effects.add(effect)
  }
  return effects
}

export function hasEffect(
  holds: readonly HoldLike[],
  effect: HoldEffect,
  asOf: Date = new Date(),
): boolean {
  return effectsOf(holds, asOf).has(effect)
}
