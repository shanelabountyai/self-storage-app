"use server";

import { revalidatePath } from "next/cache";
import {
  DAYS_OF_WEEK,
  type WeeklySchedule,
} from "@storage/core/facility-settings";
import { requireStaffActor } from "@/lib/rbac/session";
import { formatCents } from "@/lib/format";
import {
  fieldError,
  parseDate,
  parseScaled,
  success,
  type FieldErrors,
  type FormState,
} from "@/lib/admin/form-state";
import { prisma } from "@storage/db";
import { recordAudit } from "@storage/core/audit";
import { toAuditActor } from "@/lib/rbac/audit-actor";
import { ForbiddenError, requirePermission } from "@/lib/rbac/authorize";
import {
  addCamera,
  InvalidCameraUrlError,
  removeCamera,
} from "@/lib/access/cameras";
import { rotateWebhookSecret } from "@/lib/access/webhook-secrets";
import {
  InvalidAbandonmentScheduleError,
  parseAbandonmentHours,
} from "@storage/core/checkout";
import {
  InvalidRetryScheduleError,
  addFeeScheduleEntry,
  addLateFeeStep,
  addTaxComponent,
  updateGateAdapter,
  parseDunningDays,
  parseRetryDays,
  updateBillingPolicy,
  updateEmailIdentity,
  updateSmsSettings,
  updateOperationsPolicy,
  updateFacilityDetails,
  updateFacilityHours,
} from "@/lib/admin/facility-settings";

// PRD 02 FR-19: these RETURN error state rather than throwing it. Before B-094
// every one of them was `await doThing(...)` with no try/catch, so a rejected
// value rendered an error boundary instead of a message beside the field.

function readWeeklySchedule(
  formData: FormData,
  namePrefix: string,
): WeeklySchedule {
  const schedule = {} as WeeklySchedule;
  for (const day of DAYS_OF_WEEK) {
    const closed = formData.get(`${namePrefix}.${day}.closed`) != null;
    schedule[day] = closed
      ? { closed: true }
      : {
          closed: false,
          open: String(formData.get(`${namePrefix}.${day}.open`) ?? ""),
          close: String(formData.get(`${namePrefix}.${day}.close`) ?? ""),
        };
  }
  return schedule;
}

/// Domain-layer rejections still arrive as exceptions (the libs under
/// lib/admin/ throw, and B-094 is not rewriting those). This turns the last one
/// into a form-level message so the user sees a sentence rather than a stack.
function asFormError(error: unknown, fallback: string): FormState {
  const message = error instanceof Error ? error.message : fallback;
  return { status: "error", message, fieldErrors: {} };
}

export async function updateFacilityDetailsAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireStaffActor();
  const facilityId = String(formData.get("facilityId"));

  const state = String(formData.get("state") ?? "").trim();
  const errors: FieldErrors = {};
  // 3.3.3 wants a suggestion, not just an identification.
  if (!/^[A-Za-z]{2}$/.test(state)) {
    errors.state = "State must be a 2-letter code, for example TX.";
  }
  if (String(formData.get("name") ?? "").trim() === "") {
    errors.name = "Enter the facility name as customers should see it.";
  }
  if (Object.keys(errors).length > 0) return fieldError(errors);

  try {
    await updateFacilityDetails(actor, facilityId, {
      name: String(formData.get("name")),
      addressLine1: String(formData.get("addressLine1")),
      addressLine2: String(formData.get("addressLine2") || "") || null,
      city: String(formData.get("city")),
      state: state.toUpperCase(),
      postalCode: String(formData.get("postalCode")),
      timezone: String(formData.get("timezone")),
      phone: String(formData.get("phone") || "") || null,
      email: String(formData.get("email") || "") || null,
    });
  } catch (error) {
    return asFormError(error, "Could not save the facility details.");
  }

  revalidatePath("/admin/settings");
  return success("Facility details saved.");
}

export async function updateFacilityHoursAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireStaffActor();
  const facilityId = String(formData.get("facilityId"));

  try {
    await updateFacilityHours(actor, facilityId, {
      officeHours: readWeeklySchedule(formData, "officeHours"),
      gateHours: readWeeklySchedule(formData, "gateHours"),
    });
  } catch (error) {
    // The domain layer rejects a day whose close is not after its open, which
    // is the realistic failure here.
    return asFormError(error, "Could not save the hours.");
  }

  revalidatePath("/admin/settings");
  return success("Office and gate hours saved.");
}

export async function addTaxComponentAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireStaffActor();
  const facilityId = String(formData.get("facilityId"));

  const jurisdiction = String(formData.get("jurisdiction") ?? "").trim();
  // Entered as a percentage (e.g. "8.25"); stored as basis points (825).
  const rate = parseScaled(formData.get("ratePercent"), {
    scale: 100,
    min: 0,
    max: 100,
    unit: "percent",
  });
  const effectiveFrom = parseDate(formData.get("effectiveFrom"));

  const errors: FieldErrors = {};
  if (jurisdiction === "")
    errors.jurisdiction = 'Name the jurisdiction, for example "state".';
  if ("error" in rate) errors.ratePercent = rate.error;
  if ("error" in effectiveFrom) errors.effectiveFrom = effectiveFrom.error;
  if (Object.keys(errors).length > 0) return fieldError(errors);
  if ("error" in rate || "error" in effectiveFrom) return fieldError(errors);

  // 3.3.4 Error Prevention (Legal, Financial, Data). Tax components are
  // append-only by design (FR-9) — there is no edit and no delete — so this is
  // one click away from a rate every future invoice applies, forever. Echo back
  // what we parsed, in the user's terms, and make them agree to it.
  if (formData.get("confirmed") !== "yes") {
    return {
      status: "confirm",
      message:
        "Check this before it is published — it cannot be edited or deleted.",
      echo: [
        { label: "Jurisdiction", value: jurisdiction },
        { label: "Rate", value: `${(rate.value / 100).toFixed(2)}%` },
        {
          label: "Effective from",
          value: effectiveFrom.value.toISOString().slice(0, 10),
        },
      ],
    };
  }

  try {
    await addTaxComponent(actor, facilityId, {
      jurisdiction,
      rateBasisPoints: rate.value,
      effectiveFrom: effectiveFrom.value,
    });
  } catch (error) {
    return asFormError(error, "Could not add the tax rate.");
  }

  revalidatePath("/admin/settings");
  return success(
    `${jurisdiction} tax of ${(rate.value / 100).toFixed(2)}% added, effective ${effectiveFrom.value
      .toISOString()
      .slice(0, 10)}.`,
  );
}

export async function addFeeScheduleEntryAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireStaffActor();
  const facilityId = String(formData.get("facilityId"));

  const feeType = String(formData.get("feeType") ?? "");
  // Entered in dollars; stored as cents, per the money-is-cents convention.
  // Capped at $10,000: a fee schedule is admin/late/nsf/lien amounts, so a
  // five-figure entry is a typo, not a policy.
  const amount = parseScaled(formData.get("amountDollars"), {
    scale: 100,
    min: 0,
    max: 10_000,
    unit: "dollars",
  });
  const effectiveFrom = parseDate(formData.get("effectiveFrom"));

  const errors: FieldErrors = {};
  if ("error" in amount) errors.amountDollars = amount.error;
  if ("error" in effectiveFrom) errors.effectiveFrom = effectiveFrom.error;
  if (Object.keys(errors).length > 0) return fieldError(errors);
  if ("error" in amount || "error" in effectiveFrom) return fieldError(errors);

  if (formData.get("confirmed") !== "yes") {
    return {
      status: "confirm",
      message:
        "Check this before it is published — it cannot be edited or deleted.",
      echo: [
        { label: "Fee", value: feeType },
        { label: "Amount", value: formatCents(amount.value) },
        {
          label: "Effective from",
          value: effectiveFrom.value.toISOString().slice(0, 10),
        },
      ],
    };
  }

  try {
    await addFeeScheduleEntry(actor, facilityId, {
      feeType: feeType as "admin" | "late" | "nsf" | "lien",
      amountCents: amount.value,
      effectiveFrom: effectiveFrom.value,
    });
  } catch (error) {
    return asFormError(error, "Could not add the fee.");
  }

  revalidatePath("/admin/settings");
  return success(
    `${feeType} fee of ${formatCents(amount.value)} added, effective ${effectiveFrom.value
      .toISOString()
      .slice(0, 10)}.`,
  );
}

/// PRD 02 US-44. Adds a protection tier, effective-dated like every other price
/// (FR-9) — rows are never edited, so a premium change is a new row with a
/// later date and existing leases keep what they signed up to.
///
/// Same 3.3.4 confirm-and-echo as tax and fees: this is money that will bill
/// monthly, forever, and the row cannot be taken back.
export async function addProtectionPlanAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireStaffActor();
  const facilityId = String(formData.get("facilityId"));
  requirePermission(actor, "facility:settings", facilityId);

  const tier = String(formData.get("tier") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const coverage = parseScaled(formData.get("coverageDollars"), {
    scale: 100,
    min: 0,
    max: 100_000,
    unit: "dollars",
  });
  const premium = parseScaled(formData.get("premiumDollars"), {
    scale: 100,
    min: 0,
    max: 1_000,
    unit: "dollars",
  });
  const effectiveFrom = parseDate(formData.get("effectiveFrom"));

  const errors: FieldErrors = {};
  if (!/^[a-z0-9_]+$/.test(tier)) {
    errors.tier =
      'Use a short lowercase key, for example "standard". It never changes once set.';
  }
  if (!name)
    errors.name =
      'Name the tier as a customer will see it, for example "$3,000 cover".';
  if ("error" in coverage) errors.coverageDollars = coverage.error;
  if ("error" in premium) errors.premiumDollars = premium.error;
  if ("error" in effectiveFrom) errors.effectiveFrom = effectiveFrom.error;
  if (Object.keys(errors).length > 0) return fieldError(errors);
  if ("error" in coverage || "error" in premium || "error" in effectiveFrom) {
    return fieldError(errors);
  }

  if (formData.get("confirmed") !== "yes") {
    return {
      status: "confirm",
      message:
        "Check this before it is published — it cannot be edited or deleted.",
      echo: [
        { label: "Tier", value: `${name} (${tier})` },
        { label: "Covers up to", value: formatCents(coverage.value) },
        { label: "Premium", value: `${formatCents(premium.value)}/mo` },
        {
          label: "Effective from",
          value: effectiveFrom.value.toISOString().slice(0, 10),
        },
      ],
    };
  }

  try {
    const plan = await prisma.protectionPlan.create({
      data: {
        facilityId,
        tier,
        name,
        coverageCents: coverage.value,
        premiumCents: premium.value,
        effectiveFrom: effectiveFrom.value,
      },
    });
    await recordAudit({
      actor: toAuditActor(actor),
      facilityId,
      action: "facility.settings_updated",
      entityType: "ProtectionPlan",
      entityId: plan.id,
      context: {
        tier,
        premiumCents: premium.value,
        coverageCents: coverage.value,
      },
    });
  } catch (error) {
    return asFormError(error, "Could not add that tier.");
  }

  revalidatePath("/admin/settings");
  return success(`${name} added at ${formatCents(premium.value)}/mo.`);
}

/// The per-facility policy: protection required (a proof-of-insurance waiver is
/// still permitted) vs optional. Texas practice is "required, or show proof",
/// which is the shipped default — configuration, not law (D-10).
export async function setProtectionPolicyAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireStaffActor();
  const facilityId = String(formData.get("facilityId"));
  requirePermission(actor, "facility:settings", facilityId);

  const required = formData.get("protectionRequired") === "yes";
  // D-17's lapse policy rides the same form: both answer "what cover does this
  // facility insist on", and splitting them into two saves would let a facility
  // switch auto-enrolment on with no tier chosen and never see the two settings
  // side by side.
  const autoEnrol = formData.get("autoEnrolProtectionOnLapse") === "yes";
  const tierInput = String(formData.get("defaultProtectionTier") ?? "").trim();
  const defaultProtectionTier = tierInput === "" ? null : tierInput;

  if (autoEnrol && !defaultProtectionTier) {
    return {
      status: "error",
      message:
        "Choose the tier a lapsed proof enrols into before turning auto-enrolment on.",
      fieldErrors: { defaultProtectionTier: "Pick a tier." },
    };
  }

  try {
    await prisma.facility.update({
      where: { id: facilityId },
      data: {
        protectionRequired: required,
        autoEnrolProtectionOnLapse: autoEnrol,
        defaultProtectionTier,
      },
    });
    await recordAudit({
      actor: toAuditActor(actor),
      facilityId,
      action: "facility.settings_updated",
      entityType: "Facility",
      entityId: facilityId,
      context: {
        protectionRequired: required,
        autoEnrolProtectionOnLapse: autoEnrol,
        defaultProtectionTier,
      },
    });
  } catch (error) {
    return asFormError(error, "Could not save the policy.");
  }

  revalidatePath("/admin/settings");
  return success(
    `${
      required
        ? "Protection is now required at this facility — a tenant may still show their own cover."
        : "Protection is now optional at this facility."
    } ${
      autoEnrol
        ? `A lapsed proof of insurance now enrols the lease in ${defaultProtectionTier}.`
        : "A lapsed proof of insurance raises a staff task and charges nothing."
    }`,
  );
}

/// The billing policy B-044 through B-047 shipped as columns.
///
/// One form for the five settings that decide when a tenant is billed and what
/// happens when a card fails, because they are read together and a screen that
/// split them across five saves would let a facility end up in a combination
/// nobody looked at as a whole.
export async function updateBillingPolicyAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireStaffActor();
  const facilityId = String(formData.get("facilityId"));
  requirePermission(actor, "facility:settings", facilityId);

  const billingPolicy =
    formData.get("billingPolicy") === "first_of_month"
      ? "first_of_month"
      : "anniversary";
  const leadDays = parseScaled(formData.get("invoiceLeadDays"), {
    scale: 1,
    min: 0,
    max: 28,
    unit: "days",
  });

  // Zero disables the rule outright, which is a real operator choice — so the
  // floor is 0 rather than 1, and the copy says what zero means.
  const suspendDays = parseScaled(formData.get("accessSuspendDaysPastDue"), {
    scale: 1,
    min: 0,
    max: 180,
    unit: "days",
  });
  // US-28's note: "the Texas surplus holding period... needs an attorney pass
  // under D-10. The fields and the hard block are built now; the durations are
  // configuration." Floor of 1: a zero-day hold is not a hold.
  const surplusHoldDays = parseScaled(formData.get("surplusHoldDays"), {
    scale: 1,
    min: 1,
    max: 3_650,
    unit: "days",
  });
  // B-234. Warning, not law. Floor of 1: a lead of zero is the deadline
  // itself, which is the state this row exists to stop happening unannounced.
  const surplusNoticeLeadDays = parseScaled(
    formData.get("surplusNoticeLeadDays"),
    { scale: 1, min: 1, max: 365, unit: "days" },
  );
  // D-98 (B-190). Three numbers that together decide whether a payment plan is
  // forbearance or a lien clock that never runs. Bounds are wide because they
  // are configuration, not law (D-10) — but each has a floor that means
  // something: a plan finishing in zero days is not a plan, and a facility
  // allowing zero plans per year should turn the feature off, not set it here.
  const planMaxDays = parseScaled(formData.get("planMaxDays"), {
    scale: 1,
    min: 1,
    max: 730,
    unit: "days",
  });
  const planMaxPerRollingYear = parseScaled(formData.get("planMaxPerRollingYear"), {
    scale: 1,
    min: 1,
    max: 12,
    unit: "plans",
  });
  // Zero is legitimate and means the plan breaks the night the date passes,
  // which is what shipped before this — a real operator choice, so the floor
  // is 0 rather than 1.
  const planGraceDays = parseScaled(formData.get("planGraceDays"), {
    scale: 1,
    min: 0,
    max: 30,
    unit: "days",
  });
  const restoreAtOrBelow = parseScaled(
    formData.get("accessRestoreAtOrBelowDollars"),
    {
      scale: 100,
      min: 0,
      max: 1_000,
      unit: "dollars",
    },
  );

  // A select per position rather than free text: the order is a permutation of
  // four fixed categories, and a text field would invite a typo that silently
  // demotes a category to last.
  const allocationOrder = [1, 2, 3, 4]
    .map((position) => String(formData.get(`allocation${position}`) ?? ""))
    .filter(Boolean);

  const errors: FieldErrors = {};
  if (new Set(allocationOrder).size !== allocationOrder.length) {
    errors.allocation1 =
      "Each of the four can only appear once. Check for a repeat.";
  }
  if ("error" in leadDays) errors.invoiceLeadDays = leadDays.error;
  if ("error" in suspendDays)
    errors.accessSuspendDaysPastDue = suspendDays.error;
  if ("error" in surplusHoldDays)
    errors.surplusHoldDays = surplusHoldDays.error;
  if ("error" in surplusNoticeLeadDays)
    errors.surplusNoticeLeadDays = surplusNoticeLeadDays.error;
  if ("error" in restoreAtOrBelow)
    errors.accessRestoreAtOrBelowDollars = restoreAtOrBelow.error;
  if ("error" in planMaxDays) errors.planMaxDays = planMaxDays.error;
  if ("error" in planMaxPerRollingYear)
    errors.planMaxPerRollingYear = planMaxPerRollingYear.error;
  if ("error" in planGraceDays) errors.planGraceDays = planGraceDays.error;

  let retryDays: number[] = [];
  try {
    retryDays = parseRetryDays(String(formData.get("paymentRetryDays") ?? ""));
  } catch (error) {
    errors.paymentRetryDays =
      error instanceof InvalidRetryScheduleError
        ? error.message
        : 'Enter the days like "1, 3, 5".';
  }

  let dunningDays: number[] = [];
  try {
    dunningDays = parseDunningDays(String(formData.get("dunningDays") ?? ""));
  } catch (error) {
    errors.dunningDays =
      error instanceof InvalidRetryScheduleError
        ? error.message
        : 'Enter the days like "1, 5, 10, 30".';
  }

  if (Object.keys(errors).length > 0) return fieldError(errors);
  if (
    "error" in leadDays ||
    "error" in suspendDays ||
    "error" in surplusHoldDays ||
    "error" in surplusNoticeLeadDays ||
    "error" in restoreAtOrBelow ||
    "error" in planMaxDays ||
    "error" in planMaxPerRollingYear ||
    "error" in planGraceDays
  ) {
    return fieldError(errors);
  }

  try {
    await updateBillingPolicy(actor, facilityId, {
      billingPolicy,
      invoiceLeadDays: leadDays.value,
      prorateOnMoveIn: formData.get("prorateOnMoveIn") === "yes",
      prorateOnMoveOut: formData.get("prorateOnMoveOut") === "yes",
      paymentRetryDays: retryDays,
      accessSuspendDaysPastDue: suspendDays.value,
      surplusHoldDays: surplusHoldDays.value,
      surplusNoticeLeadDays: surplusNoticeLeadDays.value,
      accessRestoreAtOrBelowCents: restoreAtOrBelow.value,
      planMaxDays: planMaxDays.value,
      planMaxPerRollingYear: planMaxPerRollingYear.value,
      planGraceDays: planGraceDays.value,
      paymentAllocationOrder: allocationOrder,
      dunningDays,
      achAtCheckoutEnabled: formData.get("achAtCheckoutEnabled") === "yes",
      // B-145. Anything not one of the three known values falls back to
      // `none` — the safe direction for a setting that decides whether a
      // former tenant is billed.
      promoRecapturePolicy:
        formData.get("promoRecapturePolicy") === "full"
          ? "full"
          : formData.get("promoRecapturePolicy") === "prorated"
            ? "prorated"
            : "none",
      // D-93's default is the safe direction here too: an unrecognised value
      // must not silently become `street`, which is the one setting that can
      // raise a tenant's rent with no notice.
      transferRatePolicy:
        formData.get("transferRatePolicy") === "street"
          ? "street"
          : formData.get("transferRatePolicy") === "in_place"
            ? "in_place"
            : "preserve_discount",
    });
  } catch (error) {
    return asFormError(error, "Could not save the billing policy.");
  }

  revalidatePath("/admin/settings");
  const billingLine =
    billingPolicy === "anniversary"
      ? `Each lease now bills on its own move-in day, invoiced ${leadDays.value} days ahead.`
      : `Every lease now bills on the 1st, invoiced ${leadDays.value} days ahead.`;
  // Says what the access rule now does in the same breath, because it is the
  // setting on this form that locks a paying customer out of their property.
  const accessLine =
    suspendDays.value === 0
      ? "Gate access is never suspended for non-payment."
      : `Gate access is suspended at ${suspendDays.value} days past due and restored once the balance is ${formatCents(restoreAtOrBelow.value)} or less.`;
  return success(`${billingLine} ${accessLine}`);
}

/// Adds a step to the late-fee ladder (US-21).
///
/// Confirmed before it is written, like the protection tier above: this decides
/// what a tenant is charged automatically at 2am, and it cannot be edited or
/// deleted afterwards — changing it is another row with a later date.
export async function addLateFeeStepAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireStaffActor();
  const facilityId = String(formData.get("facilityId"));
  requirePermission(actor, "facility:settings", facilityId);

  const basis = String(formData.get("basis") ?? "flat") as
    "flat" | "percent" | "greater" | "lesser";
  const step = parseScaled(formData.get("step"), {
    scale: 1,
    min: 1,
    max: 5,
    unit: "steps",
  });
  const daysPastDue = parseScaled(formData.get("daysPastDue"), {
    scale: 1,
    min: 1,
    max: 180,
    unit: "days",
  });
  const amount = parseScaled(formData.get("amountDollars"), {
    scale: 100,
    min: 0,
    max: 1_000,
    unit: "dollars",
  });
  const percent = parseScaled(formData.get("percent"), {
    scale: 100,
    min: 0,
    max: 100,
    unit: "percent",
  });
  const capRaw = String(formData.get("capDollars") ?? "").trim();
  const cap =
    capRaw === ""
      ? { value: null as number | null }
      : parseScaled(capRaw, {
          scale: 100,
          min: 0,
          max: 1_000,
          unit: "dollars",
        });
  const effectiveFrom = parseDate(formData.get("effectiveFrom"));

  const errors: FieldErrors = {};
  if ("error" in step) errors.step = step.error;
  if ("error" in daysPastDue) errors.daysPastDue = daysPastDue.error;
  if ("error" in amount) errors.amountDollars = amount.error;
  if ("error" in percent) errors.percent = percent.error;
  if ("error" in cap) errors.capDollars = cap.error;
  if ("error" in effectiveFrom) errors.effectiveFrom = effectiveFrom.error;

  // An uncapped percentage is the one shape that can run away — a 10% fee on a
  // tenant three months behind is a fee nobody intended to set. Refused rather
  // than warned about, because the warning would be dismissed.
  if (
    !("error" in percent) &&
    percent.value > 0 &&
    basis !== "flat" &&
    !("error" in cap) &&
    cap.value === null
  ) {
    errors.capDollars =
      "A percentage fee needs a cap. Enter the most this step may ever charge.";
  }

  if (Object.keys(errors).length > 0) return fieldError(errors);
  if (
    "error" in step ||
    "error" in daysPastDue ||
    "error" in amount ||
    "error" in percent ||
    "error" in cap ||
    "error" in effectiveFrom
  ) {
    return fieldError(errors);
  }

  const describe =
    basis === "flat"
      ? formatCents(amount.value)
      : basis === "percent"
        ? `${percent.value / 100}% of the overdue balance`
        : `the ${basis} of ${formatCents(amount.value)} or ${percent.value / 100}%`;

  if (formData.get("confirmed") !== "yes") {
    return {
      status: "confirm",
      message:
        "This charges tenants automatically. Check it before it is published.",
      echo: [
        { label: "Step", value: String(step.value) },
        { label: "Charged at", value: `${daysPastDue.value} days past due` },
        { label: "Amount", value: describe },
        {
          label: "Cap",
          value: cap.value === null ? "none" : formatCents(cap.value),
        },
        {
          label: "Effective from",
          value: effectiveFrom.value.toISOString().slice(0, 10),
        },
      ],
    };
  }

  try {
    await addLateFeeStep(actor, facilityId, {
      step: step.value,
      daysPastDue: daysPastDue.value,
      amountCents: amount.value,
      percentBasisPoints: percent.value,
      basis,
      capCents: cap.value,
      effectiveFrom: effectiveFrom.value,
    });
  } catch (error) {
    return asFormError(error, "Could not add that step.");
  }

  revalidatePath("/admin/settings");
  return success(
    `Step ${step.value} added — ${describe} at ${daysPastDue.value} days past due.`,
  );
}

/// US-9, US-14 and US-32's limits, given a screen.
export async function updateOperationsPolicyAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireStaffActor();
  const facilityId = String(formData.get("facilityId"));
  requirePermission(actor, "facility:settings", facilityId);

  // Minimum 1: a cap of zero would mean nobody but the tenant may be named,
  // which is a real policy but is expressed by not adding anyone rather than by
  // a cap that reads as a misconfiguration.
  const accessCap = parseScaled(formData.get("authorizedAccessCap"), {
    scale: 1,
    min: 1,
    max: 20,
    unit: "people",
  });
  // Zero means every cash payment needs a manager — a real choice for a site
  // that takes very little cash.
  const cashApproval = parseScaled(
    formData.get("cashApprovalThresholdDollars"),
    {
      scale: 100,
      min: 0,
      max: 10_000,
      unit: "dollars",
    },
  );
  const writeOff = parseScaled(formData.get("writeOffThresholdDollars"), {
    scale: 100,
    min: 0,
    max: 1_000,
    unit: "dollars",
  });
  const noticeDays = parseScaled(formData.get("moveOutNoticeDays"), {
    scale: 1,
    min: 0,
    max: 90,
    unit: "days",
  });
  // PRD 01 US-401, B-126 / D-50. Zero is legitimate and means the hold dies at
  // end of the move-in day itself — an operator who wants the unit back the
  // moment somebody fails to turn up is making a real choice, the same as the
  // drawer-variance zero below. Negative is refused by the parser's own `min`,
  // and `holdExpiryFor` clamps as a backstop: a hold expiring BEFORE the date
  // the renter reserved it for is never a deliberate configuration.
  //
  // 30 is the ceiling because US-401 caps the move-in date itself at 14 days
  // out; a grace longer than the booking window is a unit held off the market
  // for over six weeks by one form submission.
  const holdGraceDays = parseScaled(formData.get("reservationHoldGraceDays"), {
    scale: 1,
    min: 0,
    max: 30,
    unit: "days",
  });

  // PRD 01 §9 Phase 2 (B-106). Zero is meaningful: it means same-day only,
  // which is exactly today's behaviour and a real choice for a site that does
  // not want to hold a rate for anybody. Capped at a year — past that the rate
  // the renter locked is not a rate the facility would still recognise, which
  // is the actual constraint rather than an arbitrary ceiling.
  const maxStartAhead = parseScaled(formData.get("maxCheckoutStartDaysAhead"), {
    scale: 1,
    min: 0,
    max: 365,
    unit: "days",
  });

  // PRD 02 US-43. At least an hour — zero would make every inquiry overdue the
  // moment it was taken, which is a queue nobody reads. A week is the ceiling
  // because past that the lead has rented somewhere else.
  const leadHours = parseScaled(formData.get("leadFollowUpHours"), {
    scale: 1,
    min: 1,
    max: 168,
    unit: "hours",
  });

  // PRD 02 US-11 (B-076). Minimum 1: zero is not "no notice required", it is
  // a misconfiguration that would let an unannounced increase reach a real
  // tenant — the scheduler refuses a zero-day period outright for the same
  // reason, so the form refuses to save one.
  const rateNoticeDays = parseScaled(formData.get("rateIncreaseNoticeDays"), {
    scale: 1,
    min: 1,
    max: 365,
    unit: "days",
  });

  // ── PRD 02 US-11 (B-165), D-94. The ECRI step rule. ──────────────────────
  //
  // Six controls for six columns. The ceilings are deliberately tight: this
  // whole row exists because an unbounded step sent a tenant at $89 a letter
  // raising them to $145, so a form that would let someone type 900% has
  // rebuilt the defect with more keystrokes.
  const ecriPercent = parseScaled(formData.get("ecriPercentStep"), {
    scale: 100,
    min: 0,
    max: 50,
    unit: "percent",
  });
  const ecriMinStep = parseScaled(formData.get("ecriMinStepDollars"), {
    scale: 100,
    min: 0,
    max: 500,
    unit: "dollars",
  });
  const ecriMaxStep = parseScaled(formData.get("ecriMaxStepDollars"), {
    scale: 100,
    min: 0,
    max: 500,
    unit: "dollars",
  });
  // Minimum 1 month: zero would make every lease eligible every night, which
  // is a batch that raises the same tenant twelve times a year.
  const ecriMinMonths = parseScaled(formData.get("ecriMinMonthsSinceChange"), {
    scale: 1,
    min: 1,
    max: 60,
    unit: "months",
  });
  const ecriMinGap = parseScaled(formData.get("ecriMinGapDollars"), {
    scale: 100,
    min: 0,
    max: 500,
    unit: "dollars",
  });

  // PRD 02 US-33 (B-078). Zero is legal here, unlike the notice period: a
  // facility that wants every penny explained is making a real choice.
  const drawerVariance = parseScaled(
    formData.get("drawerVarianceThresholdDollars"),
    {
      scale: 100,
      min: 0,
      max: 10_000,
      unit: "dollars",
    },
  );

  // ── PRD 10 (B-100). Refer a friend. ────────────────────────────────────
  //
  // Both reward amounts are entered in dollars and stored in cents, like every
  // other money field here. Capped at $500: the program pays TWICE per
  // referral, so a mistyped 5000 is a $10,000 exposure per move-in, and the
  // ceiling is the cheap version of finding that out on an invoice.
  const referrerReward = parseScaled(formData.get("referralRewardDollars"), {
    scale: 100,
    min: 0,
    max: 500,
    unit: "dollars",
  });
  const refereeReward = parseScaled(formData.get("refereeRewardDollars"), {
    scale: 100,
    min: 0,
    max: 500,
    unit: "dollars",
  });
  // Minimum 1 on both caps. Zero would mean "the program is on but nothing can
  // ever qualify", which is indistinguishable from a bug to whoever set it —
  // turning the program OFF is the way to express that, and it has its own
  // control.
  const referralCap = parseScaled(formData.get("referralAnnualCap"), {
    scale: 1,
    min: 1,
    max: 1_000,
    unit: "referrals",
  });
  const openInviteCap = parseScaled(formData.get("referralOpenInviteCap"), {
    scale: 1,
    min: 1,
    max: 100,
    unit: "invites",
  });
  const inviteExpiry = parseScaled(formData.get("referralInviteExpiryDays"), {
    scale: 1,
    min: 1,
    max: 365,
    unit: "days",
  });
  // Zero IS meaningful here, unlike the caps: it means no minimum stay, so a
  // reward is never cancelled for an early move-out.
  const minimumStay = parseScaled(formData.get("referralMinimumStayDays"), {
    scale: 1,
    min: 0,
    max: 365,
    unit: "days",
  });

  const errors: FieldErrors = {};
  if ("error" in accessCap) errors.authorizedAccessCap = accessCap.error;
  if ("error" in cashApproval)
    errors.cashApprovalThresholdDollars = cashApproval.error;
  if ("error" in writeOff) errors.writeOffThresholdDollars = writeOff.error;
  if ("error" in noticeDays) errors.moveOutNoticeDays = noticeDays.error;
  if ("error" in holdGraceDays)
    errors.reservationHoldGraceDays = holdGraceDays.error;
  if ("error" in maxStartAhead)
    errors.maxCheckoutStartDaysAhead = maxStartAhead.error;
  if ("error" in leadHours) errors.leadFollowUpHours = leadHours.error;
  if ("error" in rateNoticeDays)
    errors.rateIncreaseNoticeDays = rateNoticeDays.error;
  if ("error" in ecriPercent) errors.ecriPercentStep = ecriPercent.error;
  if ("error" in ecriMinStep) errors.ecriMinStepDollars = ecriMinStep.error;
  if ("error" in ecriMaxStep) errors.ecriMaxStepDollars = ecriMaxStep.error;
  if ("error" in ecriMinMonths)
    errors.ecriMinMonthsSinceChange = ecriMinMonths.error;
  if ("error" in ecriMinGap) errors.ecriMinGapDollars = ecriMinGap.error;
  // A ceiling below the floor is not a stricter rule, it is an unsatisfiable
  // one: `targetRateFor` clamps to the max last, so the max would silently
  // win and the floor the operator typed would never apply.
  if (
    !("error" in ecriMinStep) &&
    !("error" in ecriMaxStep) &&
    ecriMaxStep.value < ecriMinStep.value
  ) {
    errors.ecriMaxStepDollars =
      "The largest step cannot be smaller than the smallest one.";
  }
  if ("error" in drawerVariance)
    errors.drawerVarianceThresholdDollars = drawerVariance.error;
  if ("error" in referrerReward)
    errors.referralRewardDollars = referrerReward.error;
  if ("error" in refereeReward)
    errors.refereeRewardDollars = refereeReward.error;
  if ("error" in referralCap) errors.referralAnnualCap = referralCap.error;
  if ("error" in openInviteCap)
    errors.referralOpenInviteCap = openInviteCap.error;
  if ("error" in inviteExpiry)
    errors.referralInviteExpiryDays = inviteExpiry.error;
  if ("error" in minimumStay)
    errors.referralMinimumStayDays = minimumStay.error;

  // PRD 04 US-9 AC2 (B-073). "+1h, +24h, +72h (configurable)" — three
  // strictly-increasing hour offsets, same shape as the retry/dunning day
  // lists above but its own parser: the structure (exactly three steps) is
  // fixed, unlike a retry ladder an operator may shorten to nothing.
  let abandonmentHours: number[] = [];
  try {
    abandonmentHours = parseAbandonmentHours(
      String(formData.get("abandonmentFollowUpHours") ?? ""),
    );
  } catch (error) {
    errors.abandonmentFollowUpHours =
      error instanceof InvalidAbandonmentScheduleError
        ? error.message
        : 'Enter three offsets like "1, 24, 72".';
  }

  if (Object.keys(errors).length > 0) return fieldError(errors);
  if (
    "error" in accessCap ||
    "error" in cashApproval ||
    "error" in writeOff ||
    "error" in noticeDays ||
    "error" in holdGraceDays ||
    "error" in maxStartAhead ||
    "error" in leadHours ||
    "error" in rateNoticeDays ||
    "error" in ecriPercent ||
    "error" in ecriMinStep ||
    "error" in ecriMaxStep ||
    "error" in ecriMinMonths ||
    "error" in ecriMinGap ||
    "error" in drawerVariance ||
    "error" in referrerReward ||
    "error" in refereeReward ||
    "error" in referralCap ||
    "error" in openInviteCap ||
    "error" in inviteExpiry ||
    "error" in minimumStay
  ) {
    return fieldError(errors);
  }

  try {
    await updateOperationsPolicy(actor, facilityId, {
      authorizedAccessCap: accessCap.value,
      cashApprovalThresholdCents: cashApproval.value,
      writeOffThresholdCents: writeOff.value,
      moveOutNoticeDays: noticeDays.value,
      reservationHoldGraceDays: holdGraceDays.value,
      maxCheckoutStartDaysAhead: maxStartAhead.value,
      leadFollowUpHours: leadHours.value,
      abandonmentFollowUpHours: abandonmentHours,
      rateIncreaseNoticeDays: rateNoticeDays.value,
      ecriPercentBasisPoints: ecriPercent.value,
      ecriMinStepCents: ecriMinStep.value,
      ecriMaxStepCents: ecriMaxStep.value,
      ecriCapAtStreet: formData.get("ecriCapAtStreet") === "yes",
      ecriMinMonthsSinceChange: ecriMinMonths.value,
      ecriMinGapCents: ecriMinGap.value,
      drawerVarianceThresholdCents: drawerVariance.value,
      referralEnabled: formData.get("referralEnabled") === "yes",
      referralCrossFacility: formData.get("referralCrossFacility") === "yes",
      referralRewardCents: referrerReward.value,
      refereeRewardCents: refereeReward.value,
      referralAnnualCap: referralCap.value,
      referralOpenInviteCap: openInviteCap.value,
      referralInviteExpiryDays: inviteExpiry.value,
      referralMinimumStayDays: minimumStay.value,
    });
  } catch (error) {
    return asFormError(error, "Could not save the operations policy.");
  }

  revalidatePath("/admin/settings");
  return success(
    `Saved. Up to ${accessCap.value} named people per lease, cash at ${formatCents(cashApproval.value)} or more needs a manager, and ${noticeDays.value === 0 ? "no notice is required to move out" : `${noticeDays.value} days' notice is required to move out`}.`,
  );
}

/// CN-17's sender identity. Its own action rather than a branch inside the
/// operations form: that one parses four numeric limits this form does not
/// submit, so sharing it would have failed validation on every save.
export async function updateEmailIdentityAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireStaffActor();
  const facilityId = String(formData.get("facilityId"));
  requirePermission(actor, "facility:settings", facilityId);

  const fromName = String(formData.get("emailFromName") ?? "").trim();
  const replyTo = String(formData.get("emailReplyTo") ?? "").trim();

  // A reply-to that does not parse is worse than none: it silently bounces
  // every reply a tenant sends, and nobody finds out because the bounce goes
  // to an address that does not exist either.
  if (replyTo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(replyTo)) {
    return fieldError({
      emailReplyTo:
        "Enter a full email address, for example office@example.com.",
    });
  }

  try {
    await updateEmailIdentity(actor, facilityId, {
      emailFromName: fromName || null,
      emailReplyTo: replyTo || null,
    });
  } catch (error) {
    return asFormError(error, "Could not save the email identity.");
  }

  revalidatePath("/admin/settings");
  return success(
    replyTo
      ? `Tenants will see “${fromName || "the facility name"}” and replies go to ${replyTo}.`
      : `Tenants will see “${fromName || "the facility name"}”. Replies have nowhere to go until you set a reply-to.`,
  );
}

/// PRD 05 FR-5/FR-8 (B-074). The Twilio Messaging Service SID and the
/// quiet-hours override. No SID means SMS stays off for this facility —
/// every reminder rule degrades to email-only — so an empty field is a valid,
/// intentional save, not an error.
export async function updateSmsSettingsAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireStaffActor();
  const facilityId = String(formData.get("facilityId"));
  requirePermission(actor, "facility:settings", facilityId);

  const sid = String(formData.get("smsMessagingServiceSid") ?? "").trim();
  // Twilio's own SID format: a fixed "MG" prefix for a Messaging Service,
  // followed by 32 hex characters. Loose beyond that on purpose — this is a
  // trust boundary against typos, not a full validator.
  if (sid && !/^MG[0-9a-f]{32}$/i.test(sid)) {
    return fieldError({
      smsMessagingServiceSid:
        'A Messaging Service SID starts with "MG" followed by 32 characters.',
    });
  }

  const start = parseScaled(formData.get("smsQuietHoursStartHour"), {
    scale: 1,
    min: 0,
    max: 23,
    unit: "hours",
  });
  const end = parseScaled(formData.get("smsQuietHoursEndHour"), {
    scale: 1,
    min: 1,
    max: 24,
    unit: "hours",
  });

  const errors: FieldErrors = {};
  if ("error" in start) errors.smsQuietHoursStartHour = start.error;
  if ("error" in end) errors.smsQuietHoursEndHour = end.error;
  if (Object.keys(errors).length > 0) return fieldError(errors);
  if ("error" in start || "error" in end) return fieldError(errors);

  if (start.value >= end.value) {
    return fieldError({
      smsQuietHoursStartHour:
        "The window has to open before it closes — start must be earlier than end.",
    });
  }

  try {
    await updateSmsSettings(actor, facilityId, {
      smsMessagingServiceSid: sid || null,
      smsQuietHoursStartHour: start.value,
      smsQuietHoursEndHour: end.value,
    });
  } catch (error) {
    return asFormError(error, "Could not save the SMS settings.");
  }

  revalidatePath("/admin/settings");
  return success(
    sid
      ? `SMS is on for this facility, quiet hours ${start.value}:00-${end.value}:00.`
      : "SMS stays off for this facility until a Messaging Service SID is set — every reminder still sends by email.",
  );
}

/// PRD 03 FR-3 / US-6. Which gate controller this facility talks to, and how
/// long a manual instruction may sit before the queue escalates it.
export async function updateGateAdapterAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireStaffActor();
  const facilityId = String(formData.get("facilityId") ?? "");
  const adapter =
    formData.get("gateAdapter") === "manual" ? "manual" : "simulated";

  const hours = Number(formData.get("manualTaskSlaHours"));
  if (!Number.isFinite(hours) || hours < 0) {
    return fieldError({
      manualTaskSlaHours: "Enter a number of hours, or 0 to never escalate.",
    });
  }

  const { rerouted } = await updateGateAdapter(actor, facilityId, {
    gateAdapter: adapter,
    manualTaskSlaHours: Math.round(hours),
  });

  revalidatePath("/admin/settings");
  revalidatePath("/admin/access/queue");
  return success(
    rerouted > 0
      ? `Saved. ${rerouted} outstanding ${rerouted === 1 ? "change is" : "changes are"} back with the controller, and the keypad tasks for them are cancelled.`
      : "Saved.",
  );
}

// ---------------------------------------------------------------------------
// PRD 03 FR-10 / SR-4 (B-080). Camera links and webhook secret rotation.
// ---------------------------------------------------------------------------

export async function addCameraAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireStaffActor();
  const facilityId = String(formData.get("facilityId") ?? "");

  try {
    const camera = await addCamera(actor, {
      facilityId,
      label: String(formData.get("label") ?? ""),
      url: String(formData.get("url") ?? ""),
    });
    revalidatePath("/admin/settings");
    return success(`Camera link "${camera.label}" added.`);
  } catch (error) {
    if (error instanceof InvalidCameraUrlError)
      return fieldError({ url: error.reason });
    if (error instanceof ForbiddenError) {
      return fieldError({
        url: "You cannot change settings at this facility.",
      });
    }
    throw error;
  }
}

export async function removeCameraAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireStaffActor();
  const cameraId = String(formData.get("cameraId") ?? "");
  if (!cameraId) return fieldError({ cameraId: "Nothing to remove." });

  try {
    await removeCamera(actor, cameraId);
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return fieldError({
        cameraId: "You cannot change settings at this facility.",
      });
    }
    throw error;
  }

  revalidatePath("/admin/settings");
  return success("Camera link removed.");
}

/// SR-4's rotation. The new secret comes back once, in `details`, and is never
/// readable again from any screen — the only party that needs it is the vendor
/// portal it is about to be pasted into, and an admin page that could show
/// every site's signing key is the thing SR-1 exists to prevent.
export async function rotateWebhookSecretAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireStaffActor();
  const facilityId = String(formData.get("facilityId") ?? "");

  let result;
  try {
    result = await rotateWebhookSecret(actor, facilityId);
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return fieldError({
        facilityId: "You cannot change settings at this facility.",
      });
    }
    throw error;
  }

  if (!result.ok) {
    return fieldError({
      facilityId:
        "Rotation needs ACCESS_CODE_ENCRYPTION_KEY configured — without it the signing key would have to be stored in the clear.",
    });
  }

  revalidatePath("/admin/settings");
  return success(
    result.previousRetiresAt
      ? "New signing secret issued. Copy it now — it is not shown again. The previous secret keeps working for 24 hours so you can update the vendor portal without losing gate events."
      : "Signing secret issued for this site. Copy it now — it is not shown again.",
    [result.secret],
  );
}
