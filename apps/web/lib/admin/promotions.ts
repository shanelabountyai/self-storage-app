import { prisma } from "@storage/db";
import { recordAudit } from "@storage/core/audit";
import {
  describeTerms,
  discountSchedule,
  withMinStay,
} from "@storage/core/promotions";
import { requirePermission } from "@/lib/rbac/authorize";
import { toAuditActor } from "@/lib/rbac/audit-actor";
import type { Actor } from "@/lib/rbac/actor";

// PRD 02 US-10 / PRD 04 FR-PROMO-1/2 (B-070). Promotions as something an
// operator can create without a deploy.
//
// The whole item exists because a promotion is a price the business advertises,
// and a price that needs an engineer is a price that does not change.

export type PromotionRow = {
  id: string;
  name: string;
  type: string;
  value: number;
  durationPeriods: number;
  status: string;
  displayMode: string;
  facilityIds: string[];
  unitTypeIds: string[];
  newTenantOnly: boolean;
  /// B-144. Months the tenant must stay for the promotion to be kept. `0` is
  /// no condition.
  minStayMonths: number;
  startsAt: Date | null;
  endsAt: Date | null;
  maxRedemptions: number | null;
  redemptionCount: number;
  /// What a prospect will read. Generated unless the operator wrote their own,
  /// with the minimum stay appended either way.
  terms: string;
  codes: {
    id: string;
    code: string;
    expiresAt: Date | null;
    maxUses: number | null;
    usesCount: number;
  }[];
  /// FR-PROMO-4's ROI half: what this promo has actually given away.
  discountedCents: number;
};

export async function promotionsFor(
  actor: Actor,
  facilityId: string,
): Promise<PromotionRow[]> {
  requirePermission(actor, "facility:settings", facilityId);

  const promotions = await prisma.promotion.findMany({
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    include: {
      codes: { orderBy: { createdAt: "asc" } },
      redemptions: { select: { totalCents: true } },
    },
  });

  return promotions.map((promotion) => ({
    id: promotion.id,
    name: promotion.name,
    type: promotion.type,
    value: promotion.value,
    durationPeriods: promotion.durationPeriods,
    status: promotion.status,
    displayMode: promotion.displayMode,
    facilityIds: promotion.facilityIds,
    unitTypeIds: promotion.unitTypeIds,
    newTenantOnly: promotion.newTenantOnly,
    minStayMonths: promotion.minStayMonths,
    startsAt: promotion.startsAt,
    endsAt: promotion.endsAt,
    maxRedemptions: promotion.maxRedemptions,
    redemptionCount: promotion.redemptionCount,
    terms: withMinStay(
      promotion.termsText?.trim() || describeTerms(promotion),
      promotion.minStayMonths,
    ),
    codes: promotion.codes.map((code) => ({
      id: code.id,
      code: code.code,
      expiresAt: code.expiresAt,
      maxUses: code.maxUses,
      usesCount: code.usesCount,
    })),
    discountedCents: promotion.redemptions.reduce(
      (sum, row) => sum + row.totalCents,
      0,
    ),
  }));
}

export type PromotionWriteResult =
  { ok: true; id: string } | { ok: false; field: string; problem: string };

export type PromotionInput = {
  name: string;
  type: "percent_off" | "amount_off" | "free_months";
  value: number;
  durationPeriods: number;
  displayMode: "auto" | "code";
  facilityIds: string[];
  newTenantOnly: boolean;
  minStayMonths: number;
  startsAt: Date | null;
  endsAt: Date | null;
  maxRedemptions: number | null;
  termsText: string | null;
};

export async function createPromotion(
  actor: Actor,
  facilityId: string,
  input: PromotionInput,
): Promise<PromotionWriteResult> {
  requirePermission(actor, "facility:settings", facilityId);

  if (!input.name.trim())
    return {
      ok: false,
      field: "name",
      problem: "Give it a name staff will recognise.",
    };
  if (input.type === "percent_off" && (input.value < 1 || input.value > 100)) {
    return {
      ok: false,
      field: "value",
      problem: "A percentage between 1 and 100.",
    };
  }
  if (input.type === "amount_off" && input.value < 1) {
    return {
      ok: false,
      field: "value",
      problem: "An amount greater than zero.",
    };
  }
  if (input.durationPeriods < 1) {
    return {
      ok: false,
      field: "durationPeriods",
      problem: "At least one month.",
    };
  }
  // B-144. A minimum shorter than the discount itself is not a minimum: "first
  // three months free, one-month minimum" gives away three months and holds the
  // tenant to one of them, which is a promotion that cannot be recovered from
  // and reads on the lease as a condition that protects nothing.
  if (input.minStayMonths > 0 && input.minStayMonths < input.durationPeriods) {
    return {
      ok: false,
      field: "minStayMonths",
      problem: `At least as long as the ${input.durationPeriods} months the discount covers, or leave it at 0 for no minimum.`,
    };
  }
  if (input.startsAt && input.endsAt && input.endsAt <= input.startsAt) {
    return {
      ok: false,
      field: "endsAt",
      problem: "The end has to come after the start.",
    };
  }

  const promotion = await prisma.promotion.create({
    data: {
      name: input.name.trim(),
      type: input.type,
      // `free_months` ignores `value` — the count of free periods IS the
      // duration. Normalised here so a stale value cannot confuse the
      // evaluator later.
      value: input.type === "free_months" ? 0 : Math.round(input.value),
      durationPeriods: Math.round(input.durationPeriods),
      displayMode: input.displayMode,
      facilityIds: input.facilityIds,
      newTenantOnly: input.newTenantOnly,
      minStayMonths: Math.max(0, Math.round(input.minStayMonths)),
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      maxRedemptions: input.maxRedemptions,
      termsText: input.termsText?.trim() || null,
      // Draft, always. FR-PROMO-1 lists the statuses and a promo that went live
      // the instant somebody pressed Create is one that gets published with a
      // typo in the percentage — activating is a second, deliberate act.
      status: "draft",
    },
  });

  await recordAudit({
    actor: toAuditActor(actor),
    action: "promotion.changed",
    entityType: "Promotion",
    entityId: promotion.id,
    facilityId,
    context: {
      created: input.name.trim(),
      type: input.type,
      value: input.value,
    },
  });

  return { ok: true, id: promotion.id };
}

/// FR-PROMO-1's status transitions, and the one refusal worth having.
export async function setPromotionStatus(
  actor: Actor,
  facilityId: string,
  promotionId: string,
  status: "draft" | "active" | "paused" | "ended",
): Promise<PromotionWriteResult> {
  requirePermission(actor, "facility:settings", facilityId);

  const promotion = await prisma.promotion.findUniqueOrThrow({
    where: { id: promotionId },
    select: {
      name: true,
      status: true,
      displayMode: true,
      facilityIds: true,
      unitTypeIds: true,
      codes: { select: { id: true } },
    },
  });

  // FR-PROMO-4: "blocks publishing a promo whose eligibility set is empty."
  // A code-gated promo with no codes can never be redeemed by anyone, and
  // publishing it is the kind of thing nobody notices until the campaign is
  // over and nobody used it.
  if (
    status === "active" &&
    promotion.displayMode === "code" &&
    promotion.codes.length === 0
  ) {
    return {
      ok: false,
      field: "status",
      problem:
        "This is a code-gated promotion with no codes. Add one before activating, or nobody can use it.",
    };
  }

  await prisma.promotion.update({
    where: { id: promotionId },
    data: { status },
  });

  await recordAudit({
    actor: toAuditActor(actor),
    action: "promotion.changed",
    entityType: "Promotion",
    entityId: promotionId,
    facilityId,
    before: { status: promotion.status },
    after: { status },
  });

  return { ok: true, id: promotionId };
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/// FR-PROMO-2. Codes are stored lower-case so the unique index enforces
/// "unique, case-insensitive" rather than a lookup the index cannot help with.
export async function addPromoCode(
  actor: Actor,
  facilityId: string,
  input: {
    promotionId: string;
    code: string;
    maxUses: number | null;
    expiresAt: Date | null;
  },
): Promise<PromotionWriteResult> {
  requirePermission(actor, "facility:settings", facilityId);

  const code = (input.code.trim() || randomCode()).toLowerCase();
  if (!/^[a-z0-9-]{3,32}$/.test(code)) {
    return {
      ok: false,
      field: "code",
      problem:
        "Letters, numbers and hyphens, 3 to 32 characters — it has to survive being read down a phone.",
    };
  }

  const existing = await prisma.promoCode.findUnique({
    where: { code },
    select: { id: true },
  });
  if (existing)
    return {
      ok: false,
      field: "code",
      problem: "That code is already in use.",
    };

  const created = await prisma.promoCode.create({
    data: {
      promotionId: input.promotionId,
      code,
      maxUses: input.maxUses,
      expiresAt: input.expiresAt,
    },
  });
  return { ok: true, id: created.id };
}

function randomCode(): string {
  let out = "";
  for (let index = 0; index < 8; index += 1) {
    out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return out;
}

/// What a promo is worth against a given rate — for the preview an operator
/// needs before they publish a percentage they typed wrong.
export function previewFor(promotion: PromotionRow, monthlyRateCents: number) {
  const schedule = discountSchedule(promotion as never, monthlyRateCents);
  return { schedule: schedule.periods, totalCents: schedule.totalCents };
}
