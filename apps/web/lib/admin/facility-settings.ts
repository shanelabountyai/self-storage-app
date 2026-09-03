import { prisma } from "@storage/db";
import { recordAudit } from "@storage/core/audit";
import { ORG_DEFAULT_SCOPES, type OrgDefaultScope } from "@storage/core/org";
import {
  effectiveByGroup,
  parseWeeklySchedule,
  type WeeklySchedule,
} from "@storage/core/facility-settings";
import { propagateGateHours } from "@/lib/access/time-windows";
import { switchGateAdapter } from "@/lib/access/manual-adapter";
import { recordFacilityMove } from "@/lib/marketing/redirects";
import { pushOrgDefault } from "@/lib/admin/org-defaults";
import { requirePermission } from "@/lib/rbac/authorize";
import type { Actor } from "@/lib/rbac/actor";
import { toAuditActor } from "@/lib/rbac/audit-actor";

// PRD 02 US-3: address/geo, timezone, office+gate hours, effective-dated tax
// components and fee schedule, state. Every write here requires
// 'facility:settings' AT the target facility — requirePermission checks both
// the permission and facility access together, since can() only matches an
// assignment scoped to that facility (or an all-facilities one).

export type FacilitySettingsView = {
  facility: NonNullable<Awaited<ReturnType<typeof prisma.facility.findUnique>>>;
  currentLateFeeSteps: {
    step: number;
    daysPastDue: number;
    amountCents: number;
    percentBasisPoints: number;
    basis: string;
    capCents: number | null;
    effectiveFrom: Date;
  }[];
  lateFeeHistory: Awaited<ReturnType<typeof prisma.lateFeeRule.findMany>>;
  officeHours: WeeklySchedule | null;
  gateHours: WeeklySchedule | null;
  currentTaxComponents: {
    jurisdiction: string;
    rateBasisPoints: number;
    effectiveFrom: Date;
  }[];
  currentFeeSchedule: {
    feeType: string;
    amountCents: number;
    effectiveFrom: Date;
  }[];
  taxComponentHistory: Awaited<ReturnType<typeof prisma.taxComponent.findMany>>;
  feeScheduleHistory: Awaited<ReturnType<typeof prisma.feeSchedule.findMany>>;
};

export async function getFacilitySettings(
  facilityId: string,
): Promise<FacilitySettingsView> {
  const [facility, taxComponentHistory, feeScheduleHistory, lateFeeHistory] =
    await Promise.all([
      prisma.facility.findUniqueOrThrow({ where: { id: facilityId } }),
      prisma.taxComponent.findMany({
        where: { facilityId },
        orderBy: { effectiveFrom: "desc" },
      }),
      prisma.feeSchedule.findMany({
        where: { facilityId },
        orderBy: { effectiveFrom: "desc" },
      }),
      prisma.lateFeeRule.findMany({
        where: { facilityId },
        orderBy: [{ step: "asc" }, { effectiveFrom: "desc" }],
      }),
    ]);

  const now = new Date();
  const currentTax = effectiveByGroup(
    taxComponentHistory,
    now,
    (row) => row.jurisdiction,
  );
  const currentFee = effectiveByGroup(
    feeScheduleHistory,
    now,
    (row) => row.feeType,
  );

  return {
    facility,
    officeHours: parseWeeklySchedule(facility.officeHours),
    gateHours: parseWeeklySchedule(facility.gateHours),
    currentTaxComponents: [...currentTax.values()].sort((a, b) =>
      a.jurisdiction.localeCompare(b.jurisdiction),
    ),
    currentFeeSchedule: [...currentFee.values()].sort((a, b) =>
      a.feeType.localeCompare(b.feeType),
    ),
    taxComponentHistory,
    feeScheduleHistory,
    // The ladder in force today, one row per step — the same effective-dating
    // the tax and fee tables above use.
    currentLateFeeSteps: [
      ...effectiveByGroup(lateFeeHistory, now, (row) =>
        String(row.step),
      ).values(),
    ].sort((a, b) => a.step - b.step),
    lateFeeHistory,
  };
}

export type FacilityDetailsInput = {
  name: string;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  state: string;
  postalCode: string;
  timezone: string;
  phone: string | null;
  email: string | null;
  /// B-237. Geo had no control anywhere in the product, and it is not
  /// cosmetic: `searchFacilities` filters to facilities that have both, so a
  /// site with either missing is invisible to every renter search.
  latitude: number | null;
  longitude: number | null;
};

export class InvalidSlugError extends Error {
  constructor(readonly slug: string) {
    super(`"${slug}" is not a usable URL segment`);
    this.name = "InvalidSlugError";
  }
}

export class DuplicateSlugError extends Error {
  constructor(readonly slug: string) {
    super(`"${slug}" is already used by another facility`);
    this.name = "DuplicateSlugError";
  }
}

export class InvalidTimezoneError extends Error {
  readonly timezone: string;

  constructor(timezone: string) {
    super(`"${timezone}" is not a recognized IANA timezone`);
    this.name = "InvalidTimezoneError";
    this.timezone = timezone;
  }
}

function assertValidTimezone(timezone: string): void {
  // Intl.supportedValuesOf ships with Node/browsers — no timezone-list
  // dependency needed for this validation.
  if (!Intl.supportedValuesOf("timeZone").includes(timezone)) {
    throw new InvalidTimezoneError(timezone);
  }
}

export async function updateFacilityDetails(
  actor: Actor,
  facilityId: string,
  input: FacilityDetailsInput,
): Promise<void> {
  requirePermission(actor, "facility:settings", facilityId);
  assertValidTimezone(input.timezone);

  const before = await prisma.facility.findUniqueOrThrow({
    where: { id: facilityId },
  });
  const after = await prisma.facility.update({
    where: { id: facilityId },
    data: input,
  });

  // PRD 04 FR-SEO-2: "facility slug changes auto-create redirects." The public
  // URL is `/storage/{state}/{city}/{slug}`, so editing the CITY or the STATE
  // moves the page just as surely as renaming the slug would — and that is the
  // edit an operator actually makes, usually to fix a typo, without any idea
  // they have just 404'd every link and every printed sign.
  //
  // Recorded here rather than swept up later because the old path cannot be
  // reconstructed once the row has been updated.
  await recordFacilityMove(before, after);

  await recordAudit({
    actor: toAuditActor(actor),
    action: "facility.settings_changed",
    entityType: "Facility",
    entityId: facilityId,
    facilityId,
    before,
    after,
  });
}

/// B-237. Creating a site, which until now was a database session.
///
/// Gated on `org:defaults` rather than `facility:settings`: there is no
/// facility to be assigned to yet, and adding one to the portfolio is a
/// portfolio-wide act. `can()` is asked with a null facilityId, which only an
/// all-facilities assignment satisfies — the same shape `saveOrgDefault` uses.
///
/// The push is part of the create, not a thing to remember afterwards. A
/// facility with no fee schedule, no ladder and no timeline invoices rent and
/// does nothing else, silently, which is the failure this whole item is about.
/// It is D-41's "pushed, never resolved" shape applied at birth: the new site
/// owns ordinary effective-dated rows from day one, so nothing downstream has
/// to know org defaults exist, and its own history says where the values came
/// from.
///
/// A scope with no org default configured, or one whose push is refused, is
/// left as a gap for `facilityReadiness` to name rather than being invented
/// here. Creating the facility still succeeds: an operator who has bought a
/// site needs it in the system today, and the banner is what stops the gap
/// going unnoticed.
export async function createFacility(
  actor: Actor,
  input: FacilityDetailsInput & { slug: string },
): Promise<{ id: string; pushed: OrgDefaultScope[] }> {
  requirePermission(actor, "org:defaults", null);
  assertValidTimezone(input.timezone);

  const slug = input.slug.trim().toLowerCase();
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) throw new InvalidSlugError(slug);
  if (await prisma.facility.findUnique({ where: { slug }, select: { id: true } })) {
    throw new DuplicateSlugError(slug);
  }

  const facility = await prisma.facility.create({
    data: { ...input, slug, state: input.state.toUpperCase() },
  });

  await recordAudit({
    actor: toAuditActor(actor),
    action: "facility.created",
    entityType: "Facility",
    entityId: facility.id,
    facilityId: facility.id,
    after: facility,
  });

  // Effective from today, not from the epoch: the rows are the facility's real
  // history and it has none before today.
  const effectiveFrom = new Date();
  const pushed: OrgDefaultScope[] = [];
  for (const scope of ORG_DEFAULT_SCOPES) {
    const results = await pushOrgDefault(actor, {
      scope,
      facilityIds: [facility.id],
      effectiveFrom,
    });
    if (results.some((result) => result.outcome === "pushed")) pushed.push(scope);
  }

  return { id: facility.id, pushed };
}

export type FacilityHoursInput = {
  officeHours: WeeklySchedule;
  gateHours: WeeklySchedule;
};

export class InvalidScheduleError extends Error {
  constructor() {
    super(
      'Every day of the week needs either "closed" or a valid open/close time',
    );
    this.name = "InvalidScheduleError";
  }
}

export async function updateFacilityHours(
  actor: Actor,
  facilityId: string,
  input: FacilityHoursInput,
): Promise<{ gateCommandsEnqueued: number }> {
  requirePermission(actor, "facility:settings", facilityId);

  // Re-validate rather than trusting the caller's type: this is the boundary
  // where a malformed form submission would otherwise reach the database.
  if (
    !parseWeeklySchedule(input.officeHours) ||
    !parseWeeklySchedule(input.gateHours)
  ) {
    throw new InvalidScheduleError();
  }

  const before = await prisma.facility.findUniqueOrThrow({
    where: { id: facilityId },
  });
  const after = await prisma.facility.update({
    where: { id: facilityId },
    data: { officeHours: input.officeHours, gateHours: input.gateHours },
  });

  await recordAudit({
    actor: toAuditActor(actor),
    action: "facility.settings_changed",
    entityType: "Facility",
    entityId: facilityId,
    facilityId,
    before: { officeHours: before.officeHours, gateHours: before.gateHours },
    after: { officeHours: after.officeHours, gateHours: after.gateHours },
  });

  // PRD 03 US-4 AC1: "changes propagate to all active grants." Saving hours in
  // a database column changes nothing at the fence — the controller enforces
  // the window it was last told about, so the save has to push. Enqueued
  // rather than sent: the controller may be offline, and B-027's retry and
  // dead-letter path is what makes "the gate never got the memo" visible.
  //
  // Office hours are not propagated: they are when a human is behind the desk,
  // and no hardware enforces them.
  const { enqueued } = await propagateGateHours(facilityId);
  return { gateCommandsEnqueued: enqueued };
}

export type AddTaxComponentInput = {
  jurisdiction: string;
  rateBasisPoints: number;
  effectiveFrom: Date;
};

/// Never updates or deletes a row — "changing a rate" is a new effective-dated
/// row, so a previously generated invoice's line items are never retroactively
/// affected (PRD 02 US-3 AC).
export async function addTaxComponent(
  actor: Actor,
  facilityId: string,
  input: AddTaxComponentInput,
): Promise<void> {
  requirePermission(actor, "facility:settings", facilityId);

  const created = await prisma.taxComponent.create({
    data: { facilityId, ...input },
  });

  await recordAudit({
    actor: toAuditActor(actor),
    action: "facility.settings_changed",
    entityType: "TaxComponent",
    entityId: created.id,
    facilityId,
    context: {
      jurisdiction: input.jurisdiction,
      rateBasisPoints: input.rateBasisPoints,
      effectiveFrom: input.effectiveFrom,
    },
  });
}

export type AddFeeScheduleEntryInput = {
  feeType: "admin" | "late" | "nsf" | "lien";
  amountCents: number;
  effectiveFrom: Date;
};

export async function addFeeScheduleEntry(
  actor: Actor,
  facilityId: string,
  input: AddFeeScheduleEntryInput,
): Promise<void> {
  requirePermission(actor, "facility:settings", facilityId);

  const created = await prisma.feeSchedule.create({
    data: { facilityId, ...input },
  });

  await recordAudit({
    actor: toAuditActor(actor),
    action: "facility.settings_changed",
    entityType: "FeeSchedule",
    entityId: created.id,
    facilityId,
    context: {
      feeType: input.feeType,
      amountCents: input.amountCents,
      effectiveFrom: input.effectiveFrom,
    },
  });
}

// ── Billing policy (B-044/B-045/B-046/B-047's settings, given a screen) ──────
//
// Every field below shipped as a database column with no way for an operator to
// reach it. Each was defensible on its own — the defaults are right for a Texas
// facility — but together they had become the largest cluster of
// developer-only configuration in the project, and a setting only a developer
// can change is one an operator has to ring someone about.

export type BillingPolicyInput = {
  billingPolicy: "anniversary" | "first_of_month";
  invoiceLeadDays: number;
  prorateOnMoveIn: boolean;
  prorateOnMoveOut: boolean;
  paymentRetryDays: number[];
  /// D-16 / US-45. Days past due at which gate access is suspended; zero
  /// disables the rule. In this form rather than a section of its own because
  /// it is driven by the same days-past-due clock as everything above it, and
  /// D-16 puts the restore threshold "alongside the partial-payment allocation
  /// policy" for the same reason.
  accessSuspendDaysPastDue: number;
  accessRestoreAtOrBelowCents: number;
  /// D-98 (B-190). The three limits on what a payment plan may commit to. In
  /// this form because a plan is the thing that STOPS everything else in it —
  /// dunning, late fees, access suspension — and a limit on the brake belongs
  /// beside the brake.
  planMaxDays: number;
  planMaxPerRollingYear: number;
  planGraceDays: number;
  /// US-28 (B-062). How long an auction surplus is held before it must be
  /// dispositioned. Configuration, not law — the durations need an attorney
  /// pass under D-10, which is why it is a field and not a constant.
  surplusHoldDays: number;
  /// B-234. How long before that deadline the nightly alarm starts asking for a
  /// disposition. Separate from the hold because the two answer to different
  /// things: the hold to a statute, this to how long the paperwork takes here.
  surplusNoticeLeadDays: number;
  /// US-22's allocation order, as category keys.
  paymentAllocationOrder: string[];
  /// CN-3's ladder: days past due at which the tenant is chased.
  dunningDays: number[];
  /// B-103 / PRD 01 §3. Whether a renter may pay by bank debit AT CHECKOUT.
  ///
  /// Here rather than in a section of its own because it is a money-risk
  /// decision like the ones around it: an ACH move-in hands over a unit and a
  /// gate code against money that can reverse four business days later. Portal
  /// ACH is always on and is not configurable — there the tenant already has
  /// the unit, so a bounced debit is an unpaid balance the dunning ladder
  /// already knows how to handle.
  achAtCheckoutEnabled: boolean;
  /// B-145 / US-10. What happens to a promotional discount already given when
  /// the lease ends inside its minimum stay. In THIS form rather than beside
  /// the promotions themselves because it is a move-out money rule like
  /// `prorateOnMoveOut` two fields above it, and because it is per facility
  /// while a promotion can span several.
  promoRecapturePolicy: "none" | "full" | "prorated";
  /// B-162 / D-93. What rate a unit transfer opens the new lease at. In this
  /// form because it is a rent rule like `prorateOnMoveIn` above it, and
  /// because the alternative — leaving it reachable only from a database
  /// client — is the mistake this codebase has already made five times.
  transferRatePolicy: "preserve_discount" | "street" | "in_place";
};

export class InvalidRetryScheduleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidRetryScheduleError";
  }
}

/// Parses "1, 3, 5" into retry offsets.
///
/// Strictly increasing, because the offsets are days after the ORIGINAL due
/// date (D-25's anchoring rule) rather than gaps between attempts — "1, 3, 2"
/// is not a schedule that retries sooner, it is one whose third attempt is
/// already in the past when its second fires. Empty means one attempt and no
/// retries, which is a real operator choice.
export function parseRetryDays(raw: string): number[] {
  const text = raw.trim();
  if (text === "") return [];

  const parts = text.split(/[,\s]+/).filter(Boolean);
  const days: number[] = [];
  for (const part of parts) {
    const value = Number(part);
    if (!Number.isInteger(value) || value < 1 || value > 90) {
      throw new InvalidRetryScheduleError(
        `"${part}" is not a whole number of days between 1 and 90. Enter them like "1, 3, 5".`,
      );
    }
    if (days.length > 0 && value <= days[days.length - 1]) {
      throw new InvalidRetryScheduleError(
        "List the days in increasing order — they count from the original due date, not from the last attempt.",
      );
    }
    days.push(value);
  }
  if (days.length > 6) {
    throw new InvalidRetryScheduleError(
      "Six retries is already more than a card will forgive.",
    );
  }
  return days;
}

/// The ladder days, parsed with the same rule as the retry schedule: whole
/// days, increasing, counted from the invoice's original due date. Empty means
/// no automated chasing, which is a real choice for a site that phones.
export function parseDunningDays(raw: string): number[] {
  return parseRetryDays(raw);
}

export async function updateBillingPolicy(
  actor: Actor,
  facilityId: string,
  input: BillingPolicyInput,
): Promise<void> {
  requirePermission(actor, "facility:settings", facilityId);

  const before = await prisma.facility.findUniqueOrThrow({
    where: { id: facilityId },
  });
  const after = await prisma.facility.update({
    where: { id: facilityId },
    data: input,
  });

  await recordAudit({
    actor: toAuditActor(actor),
    action: "facility.settings_changed",
    entityType: "Facility",
    entityId: facilityId,
    facilityId,
    before: {
      billingPolicy: before.billingPolicy,
      invoiceLeadDays: before.invoiceLeadDays,
      prorateOnMoveIn: before.prorateOnMoveIn,
      prorateOnMoveOut: before.prorateOnMoveOut,
      paymentRetryDays: before.paymentRetryDays,
      accessSuspendDaysPastDue: before.accessSuspendDaysPastDue,
      surplusHoldDays: before.surplusHoldDays,
      surplusNoticeLeadDays: before.surplusNoticeLeadDays,
      accessRestoreAtOrBelowCents: before.accessRestoreAtOrBelowCents,
      planMaxDays: before.planMaxDays,
      planMaxPerRollingYear: before.planMaxPerRollingYear,
      planGraceDays: before.planGraceDays,
      paymentAllocationOrder: before.paymentAllocationOrder,
      dunningDays: before.dunningDays,
      achAtCheckoutEnabled: before.achAtCheckoutEnabled,
      promoRecapturePolicy: before.promoRecapturePolicy,
      transferRatePolicy: before.transferRatePolicy,
    },
    after: {
      billingPolicy: after.billingPolicy,
      invoiceLeadDays: after.invoiceLeadDays,
      prorateOnMoveIn: after.prorateOnMoveIn,
      prorateOnMoveOut: after.prorateOnMoveOut,
      paymentRetryDays: after.paymentRetryDays,
      accessSuspendDaysPastDue: after.accessSuspendDaysPastDue,
      surplusHoldDays: after.surplusHoldDays,
      surplusNoticeLeadDays: after.surplusNoticeLeadDays,
      accessRestoreAtOrBelowCents: after.accessRestoreAtOrBelowCents,
      planMaxDays: after.planMaxDays,
      planMaxPerRollingYear: after.planMaxPerRollingYear,
      planGraceDays: after.planGraceDays,
      paymentAllocationOrder: after.paymentAllocationOrder,
      dunningDays: after.dunningDays,
      achAtCheckoutEnabled: after.achAtCheckoutEnabled,
      promoRecapturePolicy: after.promoRecapturePolicy,
      transferRatePolicy: after.transferRatePolicy,
    },
  });
}

export type LateFeeStepInput = {
  step: number;
  daysPastDue: number;
  amountCents: number;
  percentBasisPoints: number;
  basis: "flat" | "percent" | "greater" | "lesser";
  capCents: number | null;
  effectiveFrom: Date;
};

/// Adds a late-fee step. Never edits or deletes, like every other price here —
/// changing a step is a new effective-dated row, so a fee already assessed is
/// never retroactively a different amount (FR-9).
export async function addLateFeeStep(
  actor: Actor,
  facilityId: string,
  input: LateFeeStepInput,
): Promise<void> {
  requirePermission(actor, "facility:settings", facilityId);

  const created = await prisma.lateFeeRule.create({
    data: { facilityId, ...input },
  });

  await recordAudit({
    actor: toAuditActor(actor),
    action: "facility.settings_changed",
    entityType: "LateFeeRule",
    entityId: created.id,
    facilityId,
    context: { ...input, effectiveFrom: input.effectiveFrom.toISOString() },
  });
}

// ── Operations policy (US-9, US-14, US-32) ──────────────────────────────────
//
// The four remaining columns an operator could not reach. Kept apart from the
// billing policy above because they are not billing: they are the limits a
// facility puts on its own staff and its own tenants, and grouping them with
// invoicing would mean nobody looking for "how many people can be on a lease"
// finds it.

export type OperationsPolicyInput = {
  authorizedAccessCap: number;
  cashApprovalThresholdCents: number;
  writeOffThresholdCents: number;
  moveOutNoticeDays: number;
  /// PRD 01 US-401, B-126 / D-50. Days after the renter's chosen move-in date
  /// that a free reservation hold survives. Here rather than in billing policy
  /// for the same reason `moveOutNoticeDays` is: it is a promise made to a
  /// prospect about how long we will keep a unit off the market, not a
  /// decision about money.
  reservationHoldGraceDays: number;
  /// PRD 01 §9 Phase 2 (B-106). How far ahead a PAID checkout may schedule a
  /// move-in. Deliberately separate from the free hold's 14-day cap — see the
  /// column's own note for why the two limits do not share a number.
  maxCheckoutStartDaysAhead: number;
  /// PRD 02 US-43. How long a new inquiry may sit uncontacted before the
  /// morning sweep turns it into a task.
  leadFollowUpHours: number;
  /// PRD 04 US-9 AC2 (B-073). The abandoned-checkout email sequence's own
  /// timing — grouped with `leadFollowUpHours` above rather than billing
  /// policy, since both are "how soon do we follow up", not money.
  abandonmentFollowUpHours: number[];
  /// PRD 02 US-11 (B-076). Minimum advance notice before a tenant rate
  /// increase may take effect. Here rather than in billing policy for the
  /// same reason `moveOutNoticeDays` is: it is a term of the lease and a
  /// question of what the state requires, not a decision about invoicing.
  rateIncreaseNoticeDays: number;
  /// PRD 02 US-11 (B-165), D-94. The ECRI step rule — six columns, six
  /// controls, in the item that adds them. Before this the step was a return
  /// statement and the eligibility rule a module constant, so "raise everyone
  /// to street" was not a policy anyone had chosen; it was the only one.
  ecriPercentBasisPoints: number;
  ecriMinStepCents: number;
  ecriMaxStepCents: number;
  ecriCapAtStreet: boolean;
  ecriMinMonthsSinceChange: number;
  ecriMinGapCents: number;
  /// PRD 02 US-33 (B-078). How far a drawer may be out at close-out before
  /// the close demands a written explanation.
  drawerVarianceThresholdCents: number;
  // ── PRD 10 (B-100). Refer a friend. ──────────────────────────────────────
  //
  // Eight columns, eight controls, in the item that adds them. The PRD says so
  // itself, citing this codebase's own rule — `billingPolicy`,
  // `invoiceLeadDays` and the late-fee ladder all shipped reachable only from
  // a database client and took two clean-up passes to close.
  referralEnabled: boolean;
  referralRewardCents: number;
  refereeRewardCents: number;
  referralMinimumStayDays: number;
  referralAnnualCap: number;
  referralInviteExpiryDays: number;
  referralOpenInviteCap: number;
  referralCrossFacility: boolean;
};

export async function updateOperationsPolicy(
  actor: Actor,
  facilityId: string,
  input: OperationsPolicyInput,
): Promise<void> {
  requirePermission(actor, "facility:settings", facilityId);

  const before = await prisma.facility.findUniqueOrThrow({
    where: { id: facilityId },
  });
  const after = await prisma.facility.update({
    where: { id: facilityId },
    data: input,
  });

  const fields = (row: typeof before) => ({
    authorizedAccessCap: row.authorizedAccessCap,
    cashApprovalThresholdCents: row.cashApprovalThresholdCents,
    writeOffThresholdCents: row.writeOffThresholdCents,
    moveOutNoticeDays: row.moveOutNoticeDays,
    reservationHoldGraceDays: row.reservationHoldGraceDays,
    maxCheckoutStartDaysAhead: row.maxCheckoutStartDaysAhead,
    leadFollowUpHours: row.leadFollowUpHours,
    abandonmentFollowUpHours: row.abandonmentFollowUpHours,
    rateIncreaseNoticeDays: row.rateIncreaseNoticeDays,
    ecriPercentBasisPoints: row.ecriPercentBasisPoints,
    ecriMinStepCents: row.ecriMinStepCents,
    ecriMaxStepCents: row.ecriMaxStepCents,
    ecriCapAtStreet: row.ecriCapAtStreet,
    ecriMinMonthsSinceChange: row.ecriMinMonthsSinceChange,
    ecriMinGapCents: row.ecriMinGapCents,
    drawerVarianceThresholdCents: row.drawerVarianceThresholdCents,
    referralEnabled: row.referralEnabled,
    referralRewardCents: row.referralRewardCents,
    refereeRewardCents: row.refereeRewardCents,
    referralMinimumStayDays: row.referralMinimumStayDays,
    referralAnnualCap: row.referralAnnualCap,
    referralInviteExpiryDays: row.referralInviteExpiryDays,
    referralOpenInviteCap: row.referralOpenInviteCap,
    referralCrossFacility: row.referralCrossFacility,
  });

  await recordAudit({
    actor: toAuditActor(actor),
    action: "facility.settings_changed",
    entityType: "Facility",
    entityId: facilityId,
    facilityId,
    before: fields(before),
    after: fields(after),
  });
}

/// PRD 05 CN-17. Per-facility sender identity.
export async function updateEmailIdentity(
  actor: Actor,
  facilityId: string,
  input: { emailFromName: string | null; emailReplyTo: string | null },
): Promise<void> {
  requirePermission(actor, "facility:settings", facilityId);

  const before = await prisma.facility.findUniqueOrThrow({
    where: { id: facilityId },
  });
  const after = await prisma.facility.update({
    where: { id: facilityId },
    data: input,
  });

  await recordAudit({
    actor: toAuditActor(actor),
    action: "facility.settings_changed",
    entityType: "Facility",
    entityId: facilityId,
    facilityId,
    before: {
      emailFromName: before.emailFromName,
      emailReplyTo: before.emailReplyTo,
    },
    after: {
      emailFromName: after.emailFromName,
      emailReplyTo: after.emailReplyTo,
    },
  });
}

export type SmsSettingsInput = {
  /// PRD 05 FR-5. Null means SMS is not configured for this facility — every
  /// `sms_preferred_email_fallback` rule degrades to email-only, same as
  /// having no RESEND_API_KEY degrades email to log-only. A new column that
  /// configures behaviour, so its control ships in this item (B-074), same
  /// rule as every other facility setting on this page.
  smsMessagingServiceSid: string | null;
  smsQuietHoursStartHour: number;
  smsQuietHoursEndHour: number;
};

export async function updateSmsSettings(
  actor: Actor,
  facilityId: string,
  input: SmsSettingsInput,
): Promise<void> {
  requirePermission(actor, "facility:settings", facilityId);

  const before = await prisma.facility.findUniqueOrThrow({
    where: { id: facilityId },
  });
  const after = await prisma.facility.update({
    where: { id: facilityId },
    data: input,
  });

  const fields = (row: typeof before) => ({
    smsMessagingServiceSid: row.smsMessagingServiceSid,
    smsQuietHoursStartHour: row.smsQuietHoursStartHour,
    smsQuietHoursEndHour: row.smsQuietHoursEndHour,
  });

  await recordAudit({
    actor: toAuditActor(actor),
    action: "facility.settings_changed",
    entityType: "Facility",
    entityId: facilityId,
    facilityId,
    before: fields(before),
    after: fields(after),
  });
}

export type GateAdapterInput = {
  gateAdapter: "simulated" | "manual";
  manualTaskSlaHours: number;
};

/// PRD 03 FR-3 / US-6. Which gate controller this facility talks to, and how
/// long a manual instruction may sit before the queue starts shouting.
///
/// Both are new columns that configure behaviour, so both get their control in
/// the same item — this codebase's first hard-won rule, learned when
/// `billingPolicy`, `invoiceLeadDays` and the late-fee ladder all shipped
/// reachable only from a database client.
export async function updateGateAdapter(
  actor: Actor,
  facilityId: string,
  input: GateAdapterInput,
): Promise<{ rerouted: number }> {
  requirePermission(actor, "facility:settings", facilityId);

  const before = await prisma.facility.findUniqueOrThrow({
    where: { id: facilityId },
  });

  await prisma.facility.update({
    where: { id: facilityId },
    // The SLA is a plain column write; the adapter is not. Switching adapters
    // has to move the queue as well (US-6 AC3), so it goes through
    // `switchGateAdapter` rather than being set here.
    data: {
      manualTaskSlaHours: Math.max(0, Math.min(72, input.manualTaskSlaHours)),
    },
  });
  const { rerouted } = await switchGateAdapter(facilityId, input.gateAdapter);

  const after = await prisma.facility.findUniqueOrThrow({
    where: { id: facilityId },
  });
  await recordAudit({
    actor: toAuditActor(actor),
    action: "facility.settings_changed",
    entityType: "Facility",
    entityId: facilityId,
    facilityId,
    before: {
      gateAdapter: before.gateAdapter,
      manualTaskSlaHours: before.manualTaskSlaHours,
    },
    after: {
      gateAdapter: after.gateAdapter,
      manualTaskSlaHours: after.manualTaskSlaHours,
      reroutedCommands: rerouted,
    },
  });

  return { rerouted };
}

/// PRD 02 §4.6 US-30 (B-129). The terms of sale this facility advertises for a
/// lien auction, which the lot sheet prints on every row.
///
/// Trimmed to null rather than stored as an empty string: "not set" is a state
/// the auctions screen says out loud and the export leaves blank, and two
/// spellings of it would make that check read `!terms?.trim()` at every call
/// site instead of once here. Audit-logged like every other facility setting —
/// what a sale was advertised on is a question a wrongful-sale complaint asks.
/// B-205: the time of sale saves through here too.
///
/// One function and one audit entry because they are one form and one
/// decision — the terms and the time are both "what this facility advertises",
/// and splitting them would put two `facility.settings_changed` rows in the log
/// for a single save. `time` is optional so the existing single-argument tests
/// and any caller that only knows about the terms keep working unchanged.
export async function updateAuctionSaleTerms(
  actor: Actor,
  facilityId: string,
  terms: string,
  time?: string,
): Promise<void> {
  requirePermission(actor, "facility:settings", facilityId);

  const value = terms.trim() || null;
  const timeValue = time === undefined ? undefined : time.trim() || null;
  const before = await prisma.facility.findUniqueOrThrow({
    where: { id: facilityId },
    select: { auctionSaleTerms: true, auctionSaleTime: true },
  });
  await prisma.facility.update({
    where: { id: facilityId },
    data: { auctionSaleTerms: value, ...(timeValue === undefined ? {} : { auctionSaleTime: timeValue }) },
  });

  await recordAudit({
    actor: toAuditActor(actor),
    action: "facility.settings_changed",
    entityType: "Facility",
    entityId: facilityId,
    facilityId,
    before: { auctionSaleTerms: before.auctionSaleTerms, auctionSaleTime: before.auctionSaleTime },
    after: {
      auctionSaleTerms: value,
      auctionSaleTime: timeValue === undefined ? before.auctionSaleTime : timeValue,
    },
  });
}
