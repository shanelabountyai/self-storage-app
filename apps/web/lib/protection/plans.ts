import { prisma } from '@storage/db'
import { effectiveByGroup } from '@storage/core/facility-settings'
import type { FieldErrors } from '@/lib/admin/form-state'

// PRD 02 US-44 / PRD 01 US-501 step 3.
//
// What we sell is a **protection plan**. "Insurance" describes cover the tenant
// already holds somewhere else — the two words are not interchangeable, and the
// distinction is not pedantry: selling actual insurance generally requires a
// licensed agent, which is why the industry sells a lease addendum instead.
//
// §10 Q5 (whether a full insurance *program* belongs in any phase) stays open
// and is not a blocker: a program later replaces this catalog behind the same
// lease-facing behaviour.

export type PlanOption = {
  id: string
  tier: string
  name: string
  coverageCents: number
  premiumCents: number
}

/// The tiers on sale at a facility today, cheapest first.
///
/// Effective-dated like every other price (FR-9): the row that wins per tier is
/// the latest one on or before `asOf`, and a tier whose only row starts in the
/// future is not yet on sale.
export async function currentPlans(
  facilityId: string,
  asOf: Date = new Date(),
): Promise<PlanOption[]> {
  const rows = await prisma.protectionPlan.findMany({ where: { facilityId } })
  const current = effectiveByGroup(rows, asOf, (row) => row.tier)

  return [...current.values()]
    .map((row) => ({
      id: row.id,
      tier: row.tier,
      name: row.name,
      coverageCents: row.coverageCents,
      premiumCents: row.premiumCents,
    }))
    .sort((a, b) => a.premiumCents - b.premiumCents)
}

/// US-501 step 3: "default selection is the mid-tier plan, changeable in one
/// tap." The middle of what is actually on sale, not a hardcoded tier name —
/// an operator with two tiers or four still gets a sensible default.
export function defaultTier(plans: readonly PlanOption[]): string | null {
  if (plans.length === 0) return null
  return plans[Math.floor((plans.length - 1) / 2)].tier
}

export type ProtectionChoice =
  | { kind: 'plan'; tier: string }
  | {
      kind: 'waiver'
      carrier: string
      policyNumber: string
      /// yyyy-mm-dd. What D-17's lapse scan reads.
      expiresAt: string
      attested: boolean
    }

/// Validates a choice. The step cannot be skipped silently (US-501), and the
/// waiver path needs a real record rather than a tick — that record is the
/// whole point of US-44.
export function validateChoice(
  input: Partial<ProtectionChoice> & { kind?: string },
  plans: readonly PlanOption[],
): FieldErrors {
  const errors: FieldErrors = {}

  if (input.kind !== 'plan' && input.kind !== 'waiver') {
    errors.protection = 'Choose a protection plan, or tell us about your own cover.'
    return errors
  }

  if (input.kind === 'plan') {
    const tier = (input as { tier?: string }).tier
    if (!tier || !plans.some((plan) => plan.tier === tier)) {
      errors.protection = 'Choose one of the protection plans listed.'
    }
    return errors
  }

  const waiver = input as Partial<Extract<ProtectionChoice, { kind: 'waiver' }>>
  if (!waiver.carrier?.trim()) {
    errors.carrier = 'Enter the name of your insurer, for example State Farm.'
  }
  if (!waiver.policyNumber?.trim()) {
    errors.policyNumber = 'Enter your policy number — it is on your declaration page.'
  }

  const expires = waiver.expiresAt ?? ''
  const expiryDate = new Date(`${expires}T12:00:00`)
  if (!expires || Number.isNaN(expiryDate.getTime())) {
    errors.expiresAt = 'Enter the date your policy runs out, as yyyy-mm-dd.'
  } else if (expiryDate.getTime() < Date.now()) {
    // A policy that has already lapsed is not cover, and accepting it would put
    // a lapsed waiver on the lease from day one.
    errors.expiresAt = 'That policy has already run out. Enter cover that is still current.'
  }

  if (!waiver.attested) {
    // 3.3.2/3.3.1: an explicit, identified error rather than a disabled button.
    // Never disable Continue — a control that cannot be pressed, with no
    // message, is invisible to someone who cannot see why.
    errors.attested = 'Tick the box to confirm you have your own cover.'
  }

  return errors
}

/// The premium that will bill monthly, in cents. Zero for a waiver.
export function premiumFor(choice: ProtectionChoice, plans: readonly PlanOption[]): number {
  if (choice.kind === 'waiver') return 0
  return plans.find((plan) => plan.tier === choice.tier)?.premiumCents ?? 0
}

/// Records a waiver against a checkout session. B-026 links it to the lease
/// when the lease exists; until then the session owns it.
export async function recordWaiver(input: {
  facilityId: string
  checkoutSessionId: string
  tenantId: string | null
  carrier: string
  policyNumber: string
  expiresAt: Date
}): Promise<string> {
  const waiver = await prisma.protectionWaiver.upsert({
    where: { checkoutSessionId: input.checkoutSessionId },
    create: {
      facilityId: input.facilityId,
      checkoutSessionId: input.checkoutSessionId,
      tenantId: input.tenantId,
      carrier: input.carrier.trim(),
      policyNumber: input.policyNumber.trim(),
      expiresAt: input.expiresAt,
    },
    update: {
      carrier: input.carrier.trim(),
      policyNumber: input.policyNumber.trim(),
      expiresAt: input.expiresAt,
    },
  })
  return waiver.id
}
