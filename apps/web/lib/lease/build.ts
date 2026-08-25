import { prisma } from "@storage/db";
import { formatRate } from "@/lib/format";
import { storeGeneratedDocument } from "@/lib/documents/store";
import { renderTemplate } from "@/lib/documents/render";
import { currentPlans } from "@/lib/protection/plans";
import { billingDayFor } from "@storage/core/billing";
import { businessDateFor } from "@storage/core/jobs";
import { minStayTermSummary } from "@storage/core/promotions";
import { LEASE_SUMMARY_TEMPLATE, LEASE_TEMPLATE } from "./template";
import type { CheckoutSessionView } from "@/lib/checkout/session";

// PRD 01 US-501 step 4. Merging a checkout session into a lease.

/// Gathers every merge value from the session and the facility.
///
/// Every field is filled here or the render throws (B-023's FR-6 rule), so a
/// missing rate or an unnamed facility fails before anything is signed rather
/// than producing a lease with a hole in it.
export async function leaseValuesFor(
  session: CheckoutSessionView,
  /// D-53 (B-106 part 5). Which unit this agreement is for. Defaults to the
  /// first line, which for every single-unit checkout is the session's own
  /// unit — so a caller that does not know about baskets still describes the
  /// same lease it always did.
  line: CheckoutSessionView["units"][number] = session.units[0],
): Promise<Record<string, string>> {
  const facility = await prisma.facility.findUniqueOrThrow({
    where: { id: session.facilityId },
    select: {
      name: true,
      addressLine1: true,
      addressLine2: true,
      city: true,
      state: true,
      postalCode: true,
      gateHours: true,
      timezone: true,
      billingPolicy: true,
      prorateOnMoveIn: true,
      // B-175. The lease has to say what happens if the minimum stay is not
      // served, and only this column knows whether anything does.
      promoRecapturePolicy: true,
    },
  });
  const unitType = await prisma.unitType.findUniqueOrThrow({
    where: { id: line.unitTypeId },
    select: { widthFt: true, lengthFt: true },
  });
  const unit = line.unitId
    ? await prisma.unit.findUnique({
        where: { id: line.unitId },
        select: { number: true },
      })
    : null;

  const data = session.data as Record<string, string | number | undefined>;
  const lateFee = await prisma.feeSchedule.findFirst({
    where: { facilityId: session.facilityId, feeType: "late" },
    orderBy: { effectiveFrom: "desc" },
  });

  const protectionTier =
    typeof data.protection === "string" ? data.protection : "waiver";
  const premiumCents =
    typeof data.protectionPremiumCents === "number"
      ? data.protectionPremiumCents
      : 0;
  const plans = await currentPlans(session.facilityId);
  const plan = plans.find((option) => option.tier === protectionTier);

  const protectionSummary = plan
    ? `You have chosen our ${plan.name} protection plan at ${formatRate(plan.premiumCents)} per month, which is added to your rent. This is a protection plan we provide, not an insurance policy.`
    : "You told us you have your own insurance covering these belongings. You must keep that cover in place for as long as you rent, and tell us if it ends.";

  // The day the tenant is moving in, as a calendar date — the same value the
  // lease will carry as `startDate` and the anchor for the billing day.
  //
  // B-106: the renter's chosen date when there is one, and this MATTERS more
  // here than anywhere else it is read. This document is signed. A lease that
  // hardcoded today would state a start date and a first-payment period the
  // tenant is not agreeing to, on the one artefact whose whole purpose is to
  // record what they agreed to.
  const moveInDate = session.requestedStartDate ?? new Date();
  // The facility-local calendar day the anniversary anchors to. A chosen date
  // is ALREADY such a day (UTC-midnight), so it is not converted again — the
  // same double-conversion that put a Chicago lease on the 19th when the
  // renter picked the 20th. See checkout/provision.ts.
  const localToday =
    session.requestedStartDate ??
    businessDateFor(moveInDate, facility.timezone);

  // B-044. What the first payment actually bought, per the facility's billing
  // policy. Under `anniversary` the period starts today and the tenant pays a
  // full one; the old fixed sentence promised proration and would have been a
  // term the operator had signed up to and does not do.
  const firstPaymentSummary =
    facility.billingPolicy === "anniversary"
      ? `Your first payment covers a full month from ${new Intl.DateTimeFormat(
          "en-US",
          {
            dateStyle: "long",
            // UTC when the renter chose the date, because a chosen date is a
            // CALENDAR day already stored at UTC-midnight — rendering it in a
            // western timezone would print the day before, in a signed document.
            // A same-day move-in is a real instant and is rendered locally.
            timeZone: session.requestedStartDate ? "UTC" : facility.timezone,
          },
        ).format(
          moveInDate,
        )}, and every payment after it falls on the same day of the month.`
      : facility.prorateOnMoveIn
        ? "Your first payment covers the days between your move-in and the first of next month, charged pro rata; after that you pay a full month on the 1st."
        : "Your first payment covers a full month; after that you pay on the 1st of each month.";

  // B-144. The minimum stay the promotion on this checkout was given under.
  // Read from the promotion rather than from the session's snapshot, because
  // the snapshot carries the discount SCHEDULE (what is charged) and this is a
  // condition (what is agreed) — and the lease is the artefact that has to say
  // it. `promotionId` is null for the ordinary checkout, which costs no query.
  const promotion = session.promotionId
    ? await prisma.promotion.findUnique({
        where: { id: session.promotionId },
        select: { minStayMonths: true },
      })
    : null;
  const minStayMonths = promotion?.minStayMonths ?? 0;
  // B-175. B-145 landed, so this sentence names the consequence — which is what
  // the comment that stood here said would happen and nothing did. The wording
  // lives beside `recaptureFor` in `@storage/core/promotions`, so the lease and
  // the arithmetic are pinned to each other by a test rather than by intent.
  const termSummary = minStayTermSummary(
    facility.promoRecapturePolicy,
    minStayMonths,
  );

  const tenantName = `${data.firstName ?? ""} ${data.lastName ?? ""}`.trim();
  const tenantAddress = [
    data.addressLine1,
    data.addressLine2,
    data.city,
    data.state,
    data.postalCode,
  ]
    .filter((part) => typeof part === "string" && part.trim() !== "")
    .join(", ");

  return {
    tenantName,
    tenantAddress,
    facilityName: facility.name,
    facilityAddress: [
      facility.addressLine1,
      facility.addressLine2,
      facility.city,
      `${facility.state} ${facility.postalCode}`,
    ]
      .filter(Boolean)
      .join(", "),
    unitNumber: unit?.number ?? "to be assigned",
    unitSize: `${unitType.widthFt} feet by ${unitType.lengthFt} feet`,
    monthlyRate: `${formatRate(line.quotedRateCents + premiumCents)}`,
    protectionSummary,
    moveInDate: new Intl.DateTimeFormat("en-US", {
      dateStyle: "long",
      timeZone: facility.timezone,
    }).format(moveInDate),
    billingDay: String(billingDayFor(facility.billingPolicy, localToday)),
    firstPaymentSummary,
    termSummary,
    lateFeeSummary: lateFee
      ? `If your rent is not paid on time we charge a late fee of ${formatRate(lateFee.amountCents)}.`
      : "If your rent is not paid on time we may charge a late fee.",
    gateHoursSummary:
      "You can reach your unit during the gate hours published for this facility.",
  };
}

/// Renders the summary and the full lease, and stores the lease as a document.
/// The stored document is what gets signed, so it is created before the
/// signature exists rather than assembled afterwards.
/// D-53. One agreement per unit, keyed to the basket line it describes.
///
/// The enforceable object in this codebase is the `Lease` row and it is per
/// unit — delinquency, overlock, lien notices and auction all key on a lease.
/// A single combined agreement would mean auctioning one unit cites a document
/// that also covers the units the tenant still rents.
///
/// Keyed on `CheckoutSessionUnit` rather than the session, so a renter who
/// removes a line and adds another does not inherit the removed unit's
/// agreement. `existingLeaseDocuments` reads the same key back.
export async function buildLeaseDocuments(session: CheckoutSessionView) {
  const built = [];
  for (const line of session.units) {
    const values = await leaseValuesFor(session, line);
    const { id, rendered } = await storeGeneratedDocument({
      facilityId: session.facilityId,
      type: "lease",
      subjectType: "CheckoutSessionUnit",
      subjectId: line.id,
      title: `Storage rental agreement — ${values.facilityName}, unit ${values.unitNumber}`,
      template: LEASE_TEMPLATE,
      values,
    });
    built.push({
      lineId: line.id,
      documentId: id,
      unitName: values.unitNumber,
      // `bodyHtml` for the on-page render; the stored `html` stays the
      // complete, hashed, signed document.
      html: rendered.bodyHtml,
      summaryHtml: renderTemplate(LEASE_SUMMARY_TEMPLATE, values),
    });
  }
  return built;
}

/// The leases already built for this session, one per basket line, in basket
/// order. Re-rendering on every page view would change the hash under a signer
/// mid-step, so the stored document is what comes back.
///
/// A line with no document yet is absent rather than null-padded — the caller
/// treats "fewer documents than lines" as "rebuild", which is what happens when
/// a renter adds a unit after reaching the lease step.
export async function existingLeaseDocuments(session: CheckoutSessionView) {
  const lineIds = session.units.map((line) => line.id);
  const documents = await prisma.document.findMany({
    where: {
      type: "lease",
      deletedAt: null,
      OR: [
        { subjectType: "CheckoutSessionUnit", subjectId: { in: lineIds } },
        // Sessions that reached the lease step before D-53 stored one document
        // against the SESSION. Read so a checkout in flight across the deploy
        // still finds the lease it may already have signed, rather than being
        // handed a fresh unsigned one to sign a second time.
        { subjectType: "CheckoutSession", subjectId: session.id },
      ],
    },
    include: { signature: true },
    orderBy: { createdAt: "asc" },
  });

  // Basket order, and at most one document per line — a rebuild after a removed
  // line can leave an older row behind, and the newest is the one on screen.
  return session.units
    .map((line, index) => {
      const forLine = documents.filter(
        (document) =>
          (document.subjectType === "CheckoutSessionUnit" &&
            document.subjectId === line.id) ||
          // The legacy row can only ever have described the primary unit.
          (document.subjectType === "CheckoutSession" && index === 0),
      );
      const document = forLine[forLine.length - 1];
      return document ? { lineId: line.id, document } : null;
    })
    .filter((entry) => entry !== null);
}
