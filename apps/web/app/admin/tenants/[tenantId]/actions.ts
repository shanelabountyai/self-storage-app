"use server";

import { revalidatePath } from "next/cache";
import { requireStaffActor } from "@/lib/rbac/session";
import {
  addTenantNote,
  flagTenantAddressReturned,
  logTenantDocument,
  setTenantNotePinned,
  updateTenantActiveDuty,
  updateTenantAddress,
  updateTenantContact,
  type LoggableDocumentType,
} from "@/lib/admin/tenants";
import {
  fieldError,
  parseDate,
  success,
  type FormState,
} from "@/lib/admin/form-state";
import {
  cancelPaymentPlan,
  createPaymentPlan,
} from "@/lib/admin/payment-plans";
import { MAX_INSTALLMENTS, problemsByRow } from "@storage/core/payment-plans";
import { waiveFeeInvoice } from "@/lib/billing/late-fees";
import { postFeeCharge } from "@/lib/billing/charges";
import { formatCents } from "@/lib/format";
import { liftHold, placeHold } from "@/lib/admin/holds";
import { refundPayment } from "@/lib/billing/refunds";
import { returnPayment, waiveFeeFromForm } from "@/lib/billing/reversals";
import { parseScaled } from "@/lib/admin/form-state";
import { setExtendedHours } from "@/lib/access/time-windows";
import { requirePermission } from "@/lib/rbac/authorize";
import { recordNoticeGiven } from "@/lib/admin/move-out";

// PRD 02 §4.4 US-13/US-16. Thin session wrappers; every real decision lives
// in lib/admin/tenants.ts (and lib/portal/contact.ts underneath it), which
// import nothing from `@/auth` and are therefore directly testable.

function revalidateProfile(tenantId: string): void {
  revalidatePath(`/admin/tenants/${tenantId}`);
}

export async function updateContactAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireStaffActor();
  const tenantId = String(formData.get("tenantId") ?? "");

  const problems = await updateTenantContact(actor, tenantId, {
    phone: String(formData.get("phone") ?? ""),
    altContactName: String(formData.get("altContactName") ?? ""),
    altContactPhone: String(formData.get("altContactPhone") ?? ""),
    altContactEmail: String(formData.get("altContactEmail") ?? ""),
  });
  if (Object.keys(problems).length > 0) return fieldError(problems);

  revalidateProfile(tenantId);
  return success("Contact details saved.");
}

/// B-121 / D-49. Records the SCRA declaration and raises the hold that acts on
/// it. The success line names how many leases were covered, because "every
/// lease the tenant holds" is the part a staffer cannot verify from this screen
/// — the other facility's lease is not on it.
export async function updateActiveDutyAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireStaffActor();
  const tenantId = String(formData.get("tenantId") ?? "");
  const declared = formData.get("activeDutyMilitary") === "yes";

  const { heldLeases } = await updateTenantActiveDuty(
    actor,
    tenantId,
    declared,
  );

  revalidateProfile(tenantId);
  if (!declared) {
    return success(
      "Recorded as not active-duty. Any SCRA hold already in force stays until a manager lifts it.",
    );
  }
  return success(
    heldLeases === 0
      ? "Recorded as active-duty. An SCRA hold was already in force on every current lease."
      : `Recorded as active-duty. An SCRA hold was placed on ${heldLeases} lease${heldLeases === 1 ? "" : "s"}.`,
  );
}

export async function updateAddressAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireStaffActor();
  const tenantId = String(formData.get("tenantId") ?? "");

  const result = await updateTenantAddress(actor, tenantId, {
    addressLine1: String(formData.get("addressLine1") ?? ""),
    addressLine2: String(formData.get("addressLine2") ?? ""),
    city: String(formData.get("city") ?? ""),
    state: String(formData.get("state") ?? ""),
    postalCode: String(formData.get("postalCode") ?? ""),
  });
  if (!result.ok) return fieldError(result.problems);

  revalidateProfile(tenantId);
  return success("Address saved.");
}

export async function flagAddressReturnedAction(
  formData: FormData,
): Promise<void> {
  const actor = await requireStaffActor();
  const tenantId = String(formData.get("tenantId") ?? "");
  const addressId = String(formData.get("addressId") ?? "");

  await flagTenantAddressReturned(actor, tenantId, addressId);
  revalidateProfile(tenantId);
}

// B-186. Off-platform notice: staff record the date the tenant actually gave
// notice (at the counter, by phone, by mail), so the move-out screen's
// shortfall figure is computed from something a person confirmed rather than
// silently reading every walk-in as having given none. Blank clears it back
// to unset — a native `type="date"` field submits "" for empty, not a date.
export async function setNoticeGivenAction(formData: FormData): Promise<void> {
  const actor = await requireStaffActor();
  const tenantId = String(formData.get("tenantId") ?? "");
  const leaseId = String(formData.get("leaseId") ?? "");
  const raw = String(formData.get("noticeGivenAt") ?? "").trim();

  await recordNoticeGiven(
    actor,
    leaseId,
    raw ? new Date(`${raw}T00:00:00.000Z`) : null,
  );
  revalidateProfile(tenantId);
}

export async function addNoteAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireStaffActor();
  const tenantId = String(formData.get("tenantId") ?? "");

  const problems = await addTenantNote(
    actor,
    tenantId,
    String(formData.get("body") ?? ""),
  );
  if (Object.keys(problems).length > 0) return fieldError(problems);

  revalidateProfile(tenantId);
  return success("Note added.");
}

export async function setNotePinnedAction(formData: FormData): Promise<void> {
  const actor = await requireStaffActor();
  const tenantId = String(formData.get("tenantId") ?? "");
  const noteId = String(formData.get("noteId") ?? "");
  const pinned = formData.get("pinned") === "yes";

  await setTenantNotePinned(actor, tenantId, noteId, pinned);
  revalidateProfile(tenantId);
}

const LOGGABLE_DOCUMENT_TYPES = new Set<LoggableDocumentType>([
  "id_copy",
  "insurance_proof",
  "other",
]);

export async function logDocumentAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireStaffActor();
  const tenantId = String(formData.get("tenantId") ?? "");
  const type = String(formData.get("type") ?? "");

  if (!LOGGABLE_DOCUMENT_TYPES.has(type as LoggableDocumentType)) {
    return fieldError({ title: "Choose a document type." });
  }

  const problems = await logTenantDocument(actor, tenantId, {
    type: type as LoggableDocumentType,
    title: String(formData.get("title") ?? ""),
    note: String(formData.get("note") ?? ""),
  });
  if (Object.keys(problems).length > 0) return fieldError(problems);

  revalidateProfile(tenantId);
  return success("Document logged.");
}

/// US-21's waiver, from the profile rather than a database client.
///
/// Every gate is `waiveFeeInvoice`'s — the permission, the monetary limit and
/// the reason code all live in the domain function, so this only translates its
/// refusals into sentences a person can act on. An over-limit refusal names the
/// amount rather than saying "not allowed", because RBAC-2 routes it to the
/// next role up and the manager reading it needs to know what to ask for.
export async function waiveFeeAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireStaffActor();
  const tenantId = String(formData.get("tenantId") ?? "");
  const invoiceId = String(formData.get("invoiceId") ?? "");
  const reasonCode = String(formData.get("reasonCode") ?? "");

  const result = await waiveFeeInvoice(actor, invoiceId, {
    reasonCode,
    note: String(formData.get("note") ?? "") || undefined,
  });

  if (!result.ok) {
    switch (result.reason) {
      case "missing_reason":
        return fieldError({
          reasonCode: "Choose why this fee is being waived.",
        });
      case "forbidden":
        return {
          status: "error",
          message: "You do not have permission to waive fees at this facility.",
          fieldErrors: {},
        };
      case "over_limit":
        return {
          status: "error",
          message: `This fee is more than your waiver limit of ${formatCents(result.limitCents ?? 0)}. Ask a manager to approve it.`,
          fieldErrors: {},
        };
      case "already_settled":
        return {
          status: "error",
          message: "That fee has already been paid or waived.",
          fieldErrors: {},
        };
      default:
        return {
          status: "error",
          message: "That fee could not be found.",
          fieldErrors: {},
        };
    }
  }

  revalidateProfile(tenantId);
  return success(
    `${formatCents(result.amountCents)} fee waived. The credit is on the ledger.`,
  );
}

/// PRD 02 §4.5 US-21/US-23 (B-167). Posting a fee.
///
/// Every gate is `postFeeCharge`'s — the `fees:charge` permission, and the
/// fee-waiver limit measured against however far the typed amount departs from
/// the facility's own schedule. This only maps the refusals onto the field the
/// reader has to change, which for an authority refusal is the AMOUNT: putting
/// it on the form as a whole would leave a manager staring at a message with no
/// control attached to it.
///
/// Shared with the move-out screen through `ChargeFeeForm`, so both revalidate.
export async function chargeFeeAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireStaffActor();
  const tenantId = String(formData.get("tenantId") ?? "");
  const leaseId = String(formData.get("leaseId") ?? "");

  // A ceiling as well as a floor, and the ceiling is the point: a fat-fingered
  // "7500" for a $75 cleaning fee is a $7,500 charge on somebody's account, and
  // the authority ladder below would refuse it — but only after the number had
  // been believed. $10,000 is above any fee this catalogue describes.
  const amount = parseScaled(formData.get("amountDollars"), {
    scale: 100,
    min: 0.01,
    max: 10_000,
    unit: "dollars",
  });
  if ("error" in amount) return fieldError({ amountDollars: amount.error });

  const result = await postFeeCharge(actor, {
    leaseId,
    feeType: String(formData.get("feeType") ?? ""),
    amountCents: amount.value,
    note: String(formData.get("note") ?? ""),
  });

  if (!result.ok) {
    switch (result.reason) {
      case "missing_note":
        return fieldError({ note: "Say what this fee is for — the tenant reads it." });
      case "bad_amount":
        return fieldError({ amountDollars: "Enter an amount above zero, like 75.00." });
      case "unknown_fee_type":
        return fieldError({ feeType: "Pick a fee from the facility's schedule." });
      case "override_forbidden":
        return fieldError({
          amountDollars: `That is ${formatCents(result.overrideCents ?? 0)} away from this facility's price for it, and you have no fee-waiver authority. Charge the scheduled amount, or ask a manager.`,
        });
      case "over_limit":
        return fieldError({
          amountDollars: `That is ${formatCents(result.overrideCents ?? 0)} away from this facility's price for it, more than your ${formatCents(result.limitCents ?? 0)} limit.${result.escalateTo ? ` A ${result.escalateTo} can carry it.` : ""}`,
        });
      case "forbidden":
        return {
          status: "error",
          message: "You do not have permission to charge fees at this facility.",
          fieldErrors: {},
        };
      default:
        return {
          status: "error",
          message: "That lease could not be found.",
          fieldErrors: {},
        };
    }
  }

  revalidateProfile(tenantId);
  revalidatePath(`/admin/tenants/${tenantId}/move-out`);
  return success(
    `${formatCents(result.amountCents)} charged on invoice ${result.number}. It collects with autopay, and it can be waived like any other fee.`,
  );
}

/// US-42. Placing a hold — the act that stops collections that night.
export async function placeHoldAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireStaffActor();
  const tenantId = String(formData.get("tenantId") ?? "");

  const result = await placeHold(actor, String(formData.get("leaseId") ?? ""), {
    type: String(formData.get("type") ?? ""),
    reason: String(formData.get("reason") ?? ""),
    effectiveTo: formData.get("effectiveTo")
      ? new Date(String(formData.get("effectiveTo")))
      : null,
    estateContactName: String(formData.get("estateContactName") ?? "") || null,
    estateContactPhone:
      String(formData.get("estateContactPhone") ?? "") || null,
    estateContactEmail:
      String(formData.get("estateContactEmail") ?? "") || null,
  });

  if (!result.ok) {
    switch (result.reason) {
      case "missing_reason":
        return fieldError({
          reason: "Say why this hold is being placed — it is the record.",
        });
      case "missing_estate_contact":
        return fieldError({
          estateContactName:
            "Record who to speak to about this account. That is what this hold type is for.",
        });
      case "unknown_type":
        return fieldError({ type: "Choose a hold type." });
      case "forbidden":
        return {
          status: "error",
          message: "You cannot place a hold on this lease.",
          fieldErrors: {},
        };
      default:
        return {
          status: "error",
          message: "That lease could not be found.",
          fieldErrors: {},
        };
    }
  }

  revalidateProfile(tenantId);
  return success(
    "Hold placed. Automated collections stop on this lease tonight.",
  );
}

/// US-42. Lifting one — which resumes collections against a tenant who may
/// still be protected, hence the reason and the manager gate on SCRA and
/// bankruptcy.
export async function liftHoldAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireStaffActor();
  const tenantId = String(formData.get("tenantId") ?? "");

  const result = await liftHold(
    actor,
    String(formData.get("holdId") ?? ""),
    String(formData.get("liftReason") ?? ""),
  );

  if (!result.ok) {
    switch (result.reason) {
      case "missing_reason":
        return fieldError({ liftReason: "Say why this hold is being lifted." });
      case "needs_manager":
        return {
          status: "error",
          message:
            "Lifting this hold needs a manager or above. Ask one to do it — do not work around it.",
          fieldErrors: {},
        };
      case "already_lifted":
        return {
          status: "error",
          message: "That hold has already been lifted.",
          fieldErrors: {},
        };
      case "forbidden":
        return {
          status: "error",
          message: "You cannot lift a hold on this lease.",
          fieldErrors: {},
        };
      default:
        return {
          status: "error",
          message: "That hold could not be found.",
          fieldErrors: {},
        };
    }
  }

  revalidateProfile(tenantId);
  return success("Hold lifted. Automated collections resume on this lease.");
}

/// PRD 02 §4.6 US-25 / PRD 01 §9 (B-090 part 3). Agreeing a payment plan.
///
/// The form renders `MAX_INSTALLMENTS` fixed date/amount rows rather than a
/// dynamic list (see the ponytail note on that constant); a blank row is
/// dropped here rather than refused, so a plan of two installments does not
/// need the reader to know which unused rows to leave untouched.
export async function createPaymentPlanAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireStaffActor();
  const tenantId = String(formData.get("tenantId") ?? "");
  const leaseId = String(formData.get("leaseId") ?? "");

  const installments: { dueDate: Date; amountCents: number }[] = [];
  // B-192. Which FORM ROW each installment came from. `validateSchedule`
  // numbers its problems by position in the array it was handed, and that
  // array is compacted — a staffer who fills rows 1, 2 and 5 sends three
  // installments, so problem index 2 is row 5. Reporting it against
  // `installment_3` would put the message on an empty group two rows above
  // the field that caused it, which is worse than the page-level sentence it
  // replaces.
  const formRow: number[] = [];
  for (let i = 1; i <= MAX_INSTALLMENTS; i++) {
    const dueDateRaw = formData.get(`dueDate_${i}`);
    const amountRaw = formData.get(`amount_${i}`);
    if (!String(dueDateRaw ?? "").trim() && !String(amountRaw ?? "").trim()) {
      continue; // an unused row
    }

    const date = parseDate(dueDateRaw);
    if ("error" in date) {
      return fieldError({ [`dueDate_${i}`]: date.error });
    }
    const amount = parseScaled(amountRaw, {
      scale: 100,
      min: 0.01,
      max: 100_000,
      unit: "dollars",
    });
    if ("error" in amount) {
      return fieldError({ [`amount_${i}`]: amount.error });
    }
    installments.push({ dueDate: date.value, amountCents: amount.value });
    formRow.push(i);
  }

  const result = await createPaymentPlan(actor, leaseId, {
    installments,
    note: String(formData.get("note") ?? "") || null,
    // D-97. A ticked box is the default, so an absent value means the staffer
    // deliberately untucked it — the tenant asked to pay each installment
    // themselves. An unchecked checkbox posts nothing at all, which is exactly
    // why this reads presence rather than a value.
    autoCollect: formData.get("autoCollect") !== null,
  });

  if (!result.ok) {
    switch (result.reason) {
      case "invalid_schedule": {
        // B-192 / WCAG 3.3.1, 3.3.3. Each `PlanProblem` already carries the
        // installment it is about; this used to join all of them into one
        // page-level sentence and send `fieldErrors: {}`, so a staffer whose
        // fourth date was out of order was told so at the top of a form with
        // twelve identically-named fields and no way to find the one at
        // fault. Problems with no installment (the total mismatch, the day
        // cap, an empty schedule) have no field to land on and stay the
        // summary message — which is right: they are about the plan.
        const fieldErrors = Object.fromEntries(
          [...problemsByRow(result.problems, formRow)].map(([row, problem]) => [
            `installment_${row}`,
            problem,
          ]),
        );
        const summary = result.problems
          .filter((p) => p.index === null)
          .map((p) => p.problem)
          .join(" ");
        return {
          status: "error",
          message:
            summary ||
            "That schedule cannot be agreed — see the installments marked below.",
          fieldErrors,
        };
      }
      case "already_active":
        return {
          status: "error",
          message:
            "This lease already has an active payment plan. Cancel it before starting another.",
          fieldErrors: {},
        };
      case "forbidden":
        return {
          status: "error",
          message: "You cannot set up a payment plan on this lease.",
          fieldErrors: {},
        };
      // D-98 (B-190). Three refusals that each name the number they were
      // measured against, because a staffer standing in front of a tenant has
      // to be able to say what happens next rather than only that it did not.
      case "over_limit":
        return {
          status: "error",
          message: `A payment plan defers everything past due on this lease, and that is more than you can agree to on your own — your limit is ${formatCents(result.limitCents)}.${
            result.escalateTo
              ? ` A ${result.escalateTo} can agree this one.`
              : " Nobody above you has a large enough limit either; the amount has to come down first."
          }`,
          fieldErrors: {},
        };
      case "too_many_plans":
        return {
          status: "error",
          message: `This lease has already had ${result.priorCount} payment ${result.priorCount === 1 ? "plan" : "plans"} in the last twelve months, and this facility allows ${result.limit}. Another one would halt collections again with nothing new agreed — the limit is in facility settings if it is wrong.`,
          fieldErrors: {},
        };
      case "needs_escalation":
        return {
          status: "error",
          message: `This lease has already had ${result.priorCount} payment ${result.priorCount === 1 ? "plan" : "plans"} in the last twelve months, so a second one is agreed a level up.${
            result.escalateTo ? ` Ask a ${result.escalateTo}.` : ""
          }`,
          fieldErrors: {},
        };
      default:
        return {
          status: "error",
          message: "That lease could not be found.",
          fieldErrors: {},
        };
    }
  }

  revalidateProfile(tenantId);
  return success(
    "Payment plan agreed. Automated collections stop on this lease tonight.",
  );
}

export async function cancelPaymentPlanAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireStaffActor();
  const tenantId = String(formData.get("tenantId") ?? "");

  const result = await cancelPaymentPlan(
    actor,
    String(formData.get("planId") ?? ""),
    String(formData.get("cancelReason") ?? ""),
  );

  if (!result.ok) {
    switch (result.reason) {
      case "missing_reason":
        return fieldError({
          cancelReason: "Say why this payment plan is being cancelled.",
        });
      case "not_active":
        return {
          status: "error",
          message: "That payment plan is no longer active.",
          fieldErrors: {},
        };
      case "needs_manager":
        return {
          status: "error",
          message: "Cancelling this plan needs a manager or above.",
          fieldErrors: {},
        };
      case "forbidden":
        return {
          status: "error",
          message: "You cannot cancel a payment plan on this lease.",
          fieldErrors: {},
        };
      default:
        return {
          status: "error",
          message: "That payment plan could not be found.",
          fieldErrors: {},
        };
    }
  }

  revalidateProfile(tenantId);
  return success(
    "Payment plan cancelled. Automated collections resume on this lease.",
  );
}

/// US-23's refund, from the profile.
///
/// Like the waiver above, every gate stays in the domain function — permission,
/// refund limit and reason code — and this only turns its refusals into
/// sentences. The over-limit message names the limit because RBAC-2 routes to
/// the next role up and "not allowed" tells a manager nothing to ask for.
// PRD 02 US-46 / FR-8 (B-146). A payment the bank took back.
//
// Deliberately NOT the refund form with a different reason code: a refund pays
// money out of the drawer and writes a second Payment row the deposits report
// counts as outgoing. Nothing left the building here.
export async function returnPaymentAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireStaffActor();

  const result = await returnPayment(
    actor,
    String(formData.get("paymentId") ?? ""),
    {
      reasonCode: String(formData.get("reasonCode") ?? ""),
      note: String(formData.get("note") ?? "") || undefined,
      // B-178. `chargeFee` yes/no, read through the same table the form
      // renders its options from — the field is no longer named for the
      // opposite of what its answer says.
      waiveFee: waiveFeeFromForm(formData.get("chargeFee")),
    },
  );

  if (!result.ok) {
    switch (result.reason) {
      case "missing_reason":
        return fieldError({ reasonCode: "Choose what the bank said." });
      case "already_returned":
        return fieldError({
          reasonCode: "This payment is already recorded as returned.",
        });
      case "not_settled":
        return fieldError({
          reasonCode:
            "Only a payment that actually settled can be returned. This one never did.",
        });
      case "nothing_posted":
        return fieldError({
          reasonCode:
            "This payment was never posted against a lease, so there is nothing to reverse.",
        });
      default:
        return fieldError({ reasonCode: "That payment could not be found." });
    }
  }

  revalidatePath(`/admin/tenants/${String(formData.get("tenantId") ?? "")}`);
  // Says what actually happened to the money, in one line: the reopened
  // invoices are the part a staffer has to know about before the tenant rings.
  const reopened =
    result.reopenedInvoiceIds.length === 1
      ? "1 invoice is open again"
      : `${result.reopenedInvoiceIds.length} invoices are open again`;
  return success(
    result.feeInvoiceNumber
      ? `Recorded. ${reopened}, and a ${formatCents(result.feeCents)} returned-payment fee was charged on invoice ${result.feeInvoiceNumber}.`
      : `Recorded. ${reopened}. No returned-payment fee was charged.`,
  );
}

export async function refundAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireStaffActor();
  const tenantId = String(formData.get("tenantId") ?? "");
  const amount = parseScaled(formData.get("amountDollars"), {
    scale: 100,
    min: 0.01,
    max: 100_000,
    unit: "dollars",
  });
  if ("error" in amount) return fieldError({ amountDollars: amount.error });

  const method = String(formData.get("method") ?? "card") as
    "card" | "cash" | "check";
  if (method === "check" && !String(formData.get("checkNumber") ?? "").trim()) {
    return fieldError({
      checkNumber: "Enter the check number so this can be reconciled.",
    });
  }

  const result = await refundPayment(
    actor,
    String(formData.get("paymentId") ?? ""),
    {
      amountCents: amount.value,
      reasonCode: String(formData.get("reasonCode") ?? ""),
      note: String(formData.get("note") ?? "") || undefined,
      checkNumber: String(formData.get("checkNumber") ?? "") || null,
      asMethod: method,
    },
  );

  if (!result.ok) {
    switch (result.reason) {
      case "missing_reason":
        return fieldError({ reasonCode: "Choose why this is being refunded." });
      case "over_original":
        return fieldError({
          amountDollars: "That is more than is left on this payment.",
        });
      case "over_limit":
        return {
          status: "error",
          message: `That is more than your refund limit of ${formatCents(result.limitCents ?? 0)}. Ask a manager to approve it.`,
          fieldErrors: {},
        };
      case "forbidden":
        return {
          status: "error",
          message: "You do not have permission to refund payments here.",
          fieldErrors: {},
        };
      case "not_refundable":
        return {
          status: "error",
          message:
            "That payment never completed, so there is nothing to refund.",
          fieldErrors: {},
        };
      case "card_unavailable":
        return {
          status: "error",
          message:
            "Card refunds are unavailable — refund as cash or check and record it here.",
          fieldErrors: {},
        };
      case "provider_error":
        return {
          status: "error",
          message: result.message ?? "The card refund was declined.",
          fieldErrors: {},
        };
      default:
        return {
          status: "error",
          message: "That payment could not be found.",
          fieldErrors: {},
        };
    }
  }

  revalidateProfile(tenantId);
  return success(
    result.method === "card"
      ? `${formatCents(result.amountCents)} refunded to the card. It reaches them in a few days.`
      : `${formatCents(result.amountCents)} recorded as a ${result.method} refund payable — it is not paid until someone hands it over.`,
  );
}

/// PRD 03 US-4 AC3. The 24-hour-access add-on, from the tenant profile.
///
/// A new column that configures behaviour gets its control in the same item —
/// this codebase's first hard-won rule. `extendedHours` would otherwise be
/// reachable only from a database client, which is how `billingPolicy`,
/// `invoiceLeadDays` and the late-fee ladder each cost a clean-up pass.
export async function setExtendedHoursAction(
  formData: FormData,
): Promise<void> {
  const actor = await requireStaffActor();
  const grantId = String(formData.get("grantId") ?? "");
  const facilityId = String(formData.get("facilityId") ?? "");
  const tenantId = String(formData.get("tenantId") ?? "");

  // Same key that governs adding and revoking people on a lease — deciding who
  // gets through the gate at 3am is the same kind of decision.
  requirePermission(actor, "access:manage_grants", facilityId);

  await setExtendedHours(grantId, formData.get("extendedHours") === "on");
  revalidatePath(`/admin/tenants/${tenantId}`);
}
