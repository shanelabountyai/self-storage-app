import { prisma, type Prisma } from "@storage/db";
import { recordAudit } from "@storage/core/audit";
import {
  cashNeedsApproval,
  MANAGER_RANK,
  requiresAttribution,
  settleTender,
  type CounterMethod,
  type TenderProblem,
} from "@storage/core/pos";
import {
  assertFacilityAccess,
  can,
  ForbiddenError,
} from "@/lib/rbac/authorize";
import { toAuditActor } from "@/lib/rbac/audit-actor";
import type { Actor } from "@/lib/rbac/actor";
import { restoreAccessIfSettled } from "@/lib/access/delinquency-gate";
import { applyPayment, type AppliedPayment } from "@/lib/billing/allocation";
import { openSessionFor } from "@/lib/admin/drawer";
import {
  createChargeIntent,
  createCustomerSession,
} from "@/lib/payments/intents";
import { paymentsEnabled } from "@/lib/payments/stripe";

// PRD 02 §4.8 US-32. Money taken across the counter.
//
// Deliberately NOT a drawer session: D-1 keeps drawer open/close/over-short in
// Phase 2 (B-078). Everything here is either a column on `Payment` or a read
// over it, which is what the backlog row means by "this is a read over
// Payment; it is not a drawer session."

/// Hands out the next receipt number for a facility.
///
/// Must be called inside the same transaction that writes the payment. The
/// UPDATE takes a row lock that serialises concurrent counter staff, and —
/// unlike a Postgres sequence — a rollback returns the number to the pool, so
/// the series has no holes. That is the whole difference between "unique" and
/// "gapless", and the reason this is not `@default(autoincrement())`.
async function nextReceiptNumber(
  tx: Prisma.TransactionClient,
  facilityId: string,
): Promise<number> {
  const rows = await tx.$queryRaw<{ nextNumber: number }[]>`
    INSERT INTO "receipt_counter" ("facilityId", "nextNumber", "updatedAt")
    VALUES (${facilityId}, 2, NOW())
    ON CONFLICT ("facilityId")
    DO UPDATE SET "nextNumber" = "receipt_counter"."nextNumber" + 1, "updatedAt" = NOW()
    RETURNING "nextNumber" - 1 AS "nextNumber"
  `;
  return rows[0].nextNumber;
}

export type CounterPaymentInput = {
  facilityId: string;
  tenantId: string;
  leaseId: string;
  method: CounterMethod;
  amountCents: number;
  tenderedCents?: number | null;
  checkNumber?: string | null;
};

export type CounterPaymentResult =
  | {
      ok: true;
      paymentId: string;
      receiptNumber: number;
      changeCents: number | null;
      /// US-22: what this payment settled, by category, for the screen and the
      /// receipt.
      allocation: { label: string; amountCents: number }[];
      /// Money the tenant handed over beyond what they owe. Surfaced rather
      /// than silently allocated — see the note in packages/core/billing.
      unappliedCents: number;
    }
  | { ok: false; problem: CounterTenderProblem | "lease_not_found" };

/// Every refusal `counterTenderRefusal` can produce — deliberately WITHOUT
/// `lease_not_found`, which needs a lease lookup and so belongs to
/// `recordCounterPayment` alone. Named so a caller that only runs the preflight
/// gets a union it can exhaust, rather than one carrying a case it can never
/// see.
export type CounterTenderProblem =
  | TenderProblem
  | "needs_manager"
  | "card_not_supported";

/// Every refusal that can be decided BEFORE anything is written down.
///
/// Split out of `recordCounterPayment` for B-230's walk-in move-in, which has
/// to provision the lease before it can post a payment against it — a ledger
/// entry needs a lease, and at the moment the cash is handed over there is
/// not one yet. That ordering is only safe if the refusals are known first:
/// provisioning and THEN discovering the cash is $200 over this staffer's
/// approval limit is a tenant moved in for free.
///
/// `null` means nothing here refuses it. It is not a promise that the payment
/// will succeed — `recordCounterPayment` still checks the lease, and calls
/// this again itself, so a caller that skipped it changes nothing.
export async function counterTenderRefusal(
  actor: Actor,
  input: {
    facilityId: string;
    method: CounterMethod;
    amountCents: number;
    tenderedCents?: number | null;
    checkNumber?: string | null;
  },
): Promise<{ ok: false; problem: CounterTenderProblem } | null> {
  if (actor.kind !== "staff") throw new ForbiddenError("Staff access required");
  assertFacilityAccess(actor, input.facilityId);
  if (!can(actor, "payments:take", input.facilityId)) {
    throw new ForbiddenError(
      "Missing permission payments:take",
      "payments:take",
      input.facilityId,
    );
  }

  // A card at the counter still cannot be recorded BY HAND — that would create
  // a ledger entry with no money behind it, which is the one thing a payment
  // record must never be. B-230 gave the counter a real card path instead:
  // `startCounterCardPayment` raises a PaymentIntent and the tenant presents
  // the card in Stripe's own Element on the counter screen, so the money is
  // taken by the same webhook-confirmed path the portal uses and no PAN ever
  // reaches this codebase (US-601's SAQ-A boundary). This refusal is the
  // last-line guard behind that, not the product's answer to "they have a
  // card" — `takePaymentAction` sends `card` to the Element before it gets
  // here.
  if (input.method === "card")
    return { ok: false, problem: "card_not_supported" };

  const settled = settleTender(input);
  if (!settled.ok) return { ok: false, problem: settled.problem };

  const facility = await prisma.facility.findUniqueOrThrow({
    where: { id: input.facilityId },
    select: { cashApprovalThresholdCents: true },
  });

  if (
    cashNeedsApproval(
      input.method,
      settled.amountCents,
      facility.cashApprovalThresholdCents,
    )
  ) {
    const rank = Math.max(
      0,
      ...actor.assignments
        .filter(
          (a) => a.facilityId === null || a.facilityId === input.facilityId,
        )
        .map((a) => a.rank),
    );
    if (rank < MANAGER_RANK) return { ok: false, problem: "needs_manager" };
  }

  return null;
}

/// Records a payment taken at the counter, posts it to the ledger, and issues
/// a receipt number — all in one transaction, so a failure anywhere leaves no
/// half-recorded money and no consumed receipt number.
export async function recordCounterPayment(
  actor: Actor,
  input: CounterPaymentInput,
): Promise<CounterPaymentResult> {
  if (actor.kind !== "staff") throw new ForbiddenError("Staff access required");
  assertFacilityAccess(actor, input.facilityId);
  if (!can(actor, "payments:take", input.facilityId)) {
    throw new ForbiddenError(
      "Missing permission payments:take",
      "payments:take",
      input.facilityId,
    );
  }

  const preflight = await counterTenderRefusal(actor, input);
  if (preflight) return preflight;

  // Re-run rather than threaded down from the preflight: `settleTender` is
  // pure and cheap, and the alternative is a settled tender travelling as a
  // parameter through a function that could then be called without one.
  const settled = settleTender(input);
  if (!settled.ok) return { ok: false, problem: settled.problem };

  const lease = await prisma.lease.findFirst({
    where: {
      id: input.leaseId,
      tenantId: input.tenantId,
      facilityId: input.facilityId,
    },
    select: { id: true },
  });
  // Checked rather than trusted: the lease id comes from a form, and posting
  // to a lease that is not this tenant's at this facility is the same
  // mis-crediting bug B-035 fixed on the webhook side.
  if (!lease) return { ok: false, problem: "lease_not_found" };

  // A one-element box rather than a `let`: TypeScript narrows a variable only
  // ever assigned inside a callback to `never` where it is read. Same shape as
  // the settlement path in lib/payments/reconcile.ts.
  const allocation: AppliedPayment[] = [];

  // B-078 / US-33: "cash and check payments post to the drawer session where
  // one exists" (US-32's own AC, written to anticipate this). Read outside
  // the transaction because it is a plain lookup, and null is a legal answer
  // — a counter payment taken with no session open still records, and the
  // deposits report is what surfaces it as unreconciled rather than a refusal
  // here that would stop somebody taking money.
  const drawerSession = requiresAttribution(input.method)
    ? await openSessionFor(input.facilityId)
    : null;

  const result = await prisma.$transaction(async (tx) => {
    const receiptNumber = await nextReceiptNumber(tx, input.facilityId);

    const payment = await tx.payment.create({
      data: {
        facilityId: input.facilityId,
        tenantId: input.tenantId,
        amountCents: settled.amountCents,
        method: input.method,
        // Cash in hand is settled the moment it is taken — unlike a card,
        // there is no asynchronous confirmation to wait for.
        status: "succeeded",
        tenderedCents: settled.tenderedCents,
        changeCents: settled.changeCents,
        checkNumber: input.checkNumber?.trim() || null,
        // From the session actor, never a form field (US-32's own wording).
        receivedByStaffId: requiresAttribution(input.method)
          ? actor.staffUserId
          : null,
        receiptNumber,
        drawerSessionId: drawerSession?.id ?? null,
      },
    });

    await tx.ledgerEntry.create({
      data: {
        facilityId: input.facilityId,
        leaseId: lease.id,
        type: "payment",
        // Signed: a payment reduces what is owed.
        amountCents: -settled.amountCents,
        description: `${input.method.replace("_", " ")} payment, receipt #${receiptNumber}`,
        paymentId: payment.id,
      },
    });

    // US-22 (B-048). Counter payments were posting to the ledger and nothing
    // else, so every invoice stayed open however much cash came across the
    // desk — the balance moved and the invoices did not, which is exactly the
    // split that makes autopay re-charge and AR ageing lie. Allocated here in
    // the same transaction as the payment.
    //
    // `status: 'succeeded'` is already set on a counter payment (money is in
    // hand), so the recompute counts it immediately.
    allocation.push(
      await applyPayment(tx, {
        id: payment.id,
        tenantId: input.tenantId,
        facilityId: input.facilityId,
        amountCents: settled.amountCents,
      }),
    );

    await recordAudit(
      {
        actor: toAuditActor(actor),
        facilityId: input.facilityId,
        action: "payment.recorded",
        entityType: "Payment",
        entityId: payment.id,
        context: {
          method: input.method,
          amountCents: settled.amountCents,
          receiptNumber,
          leaseId: lease.id,
        },
      },
      tx,
    );

    return { paymentId: payment.id, receiptNumber };
  });

  // US-45's ~2-minute restore. A tenant who has just paid at the counter must
  // be able to reach their unit before they have walked back to the car —
  // waiting for the 4am pass is the version of this that generates a phone
  // call. Best-effort and outside the transaction: a gate controller being
  // unreachable must never roll back money already in the drawer.
  try {
    await restoreAccessIfSettled(input.tenantId, input.facilityId);
  } catch {
    // Swallowed deliberately; the nightly pass is the net.
  }

  return {
    ok: true,
    ...result,
    changeCents: settled.changeCents,
    allocation: allocation[0]?.summary ?? [],
    unappliedCents: allocation[0]?.unappliedCents ?? 0,
  };
}

export type DailySummaryRow = {
  paymentId: string;
  receiptNumber: number | null;
  method: string;
  amountCents: number;
  checkNumber: string | null;
  receivedAt: Date;
  tenantName: string;
  staffName: string | null;
};

export type DailySummary = {
  businessDate: string;
  facilityName: string;
  rows: DailySummaryRow[];
  totalsByMethod: { method: string; count: number; totalCents: number }[];
  totalCents: number;
};

/// US-32's deposit slip: every payment taken on one facility-local day.
///
/// The window is computed in the facility's own timezone, not UTC — a payment
/// taken at 7pm in Austin belongs to that day's deposit, and a UTC day
/// boundary would file it under tomorrow.
export async function dailyPaymentsSummary(
  actor: Actor,
  facilityId: string,
  businessDate: string,
): Promise<DailySummary> {
  assertFacilityAccess(actor, facilityId);
  if (
    !can(actor, "payments:take", facilityId) &&
    !can(actor, "reports:financial", facilityId)
  ) {
    throw new ForbiddenError(
      "Missing permission to read the day’s payments",
      "payments:take",
      facilityId,
    );
  }

  const facility = await prisma.facility.findUniqueOrThrow({
    where: { id: facilityId },
    select: { name: true, timezone: true },
  });

  const { start, end } = facilityDayBounds(businessDate, facility.timezone);

  const payments = await prisma.payment.findMany({
    where: {
      facilityId,
      // B-146: the day's takings as they were taken. A payment that bounced
      // later still crossed the counter that day and has a receipt number in
      // the book.
      status: {
        in: ["succeeded", "partially_refunded", "refunded", "returned"],
      },
      receivedAt: { gte: start, lt: end },
    },
    orderBy: { receivedAt: "asc" },
    select: {
      id: true,
      receiptNumber: true,
      method: true,
      amountCents: true,
      checkNumber: true,
      receivedAt: true,
      tenant: { select: { firstName: true, lastName: true } },
      receivedByStaff: { select: { firstName: true, lastName: true } },
    },
  });

  const rows: DailySummaryRow[] = payments.map((payment) => ({
    paymentId: payment.id,
    receiptNumber: payment.receiptNumber,
    method: payment.method,
    amountCents: payment.amountCents,
    checkNumber: payment.checkNumber,
    receivedAt: payment.receivedAt,
    tenantName: `${payment.tenant.firstName} ${payment.tenant.lastName}`,
    staffName: payment.receivedByStaff
      ? `${payment.receivedByStaff.firstName} ${payment.receivedByStaff.lastName}`
      : null,
  }));

  const byMethod = new Map<string, { count: number; totalCents: number }>();
  for (const row of rows) {
    const current = byMethod.get(row.method) ?? { count: 0, totalCents: 0 };
    byMethod.set(row.method, {
      count: current.count + 1,
      totalCents: current.totalCents + row.amountCents,
    });
  }

  return {
    businessDate,
    facilityName: facility.name,
    rows,
    totalsByMethod: [...byMethod.entries()]
      .map(([method, totals]) => ({ method, ...totals }))
      .sort((a, b) => a.method.localeCompare(b.method)),
    totalCents: rows.reduce((sum, row) => sum + row.amountCents, 0),
  };
}

/// The UTC instants bounding one facility-local calendar day.
///
/// Derived by asking Intl what the facility's offset actually was on that
/// date, rather than assuming a fixed one — the alternative silently files an
/// hour of payments under the wrong day twice a year.
export function facilityDayBounds(
  businessDate: string,
  timezone: string,
): { start: Date; end: Date } {
  const [year, month, day] = businessDate.split("-").map(Number);
  const guess = Date.UTC(year, month - 1, day);
  const offsetMs = timezoneOffsetMs(new Date(guess), timezone);
  const start = new Date(guess + offsetMs);
  // Recomputed from the day's real start so a DST transition inside the day
  // still lands on the following midnight rather than 23 or 25 hours later.
  const nextGuess = Date.UTC(year, month - 1, day + 1);
  const end = new Date(
    nextGuess + timezoneOffsetMs(new Date(nextGuess), timezone),
  );
  return { start, end };
}

function timezoneOffsetMs(at: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const get = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return at.getTime() - asUtc;
}

// ── B-230. Card at the counter ───────────────────────────────────────────────
//
// The counter used to refuse a card outright and tell the tenant to go and use
// the online payment screen — a deflection to email aimed at precisely the
// person least likely to read it, standing at the desk wanting their gate to
// reopen. What was missing was never a terminal: a card-not-present charge
// through the same `createChargeIntent` the portal uses needs no hardware.
//
// **The card is presented in Stripe's own Payment Element, on the counter
// screen.** Never a PAN typed into a form of ours, and there is no version of
// this that types one: US-601's SAQ-A boundary is exactly "card details go
// from the browser to Stripe and nothing in this repo receives them", and a
// staff-operated screen does not get an exemption from it — it is the surface
// where a written-down number is most likely to end up on a sticky note.
//
// Both functions below stop at RAISING the charge. Nothing here marks a
// payment succeeded, posts a ledger entry or allocates an invoice: the webhook
// (`applyStripeEvent`) does all of it, for the reason `createChargeIntent`
// states — a client that never comes back must not lose the payment.

export type CounterCharge = {
  leaseId: string;
  tenantId: string;
  facilityId: string;
  tenantName: string;
  unitNumber: string;
  balanceCents: number;
};

/// The lease a staffer is allowed to take money for, with what it owes.
///
/// Authorization and lookup in one query, the shape `payableLease` uses in the
/// portal and for the same reason: a version that returned the lease first and
/// checked access second is the one that eventually ships with the check
/// dropped. The FACILITY comes from the lease rather than from the admin
/// facility switcher — the tenant profile links here for a lease that may be
/// at another site, and a charge raised against the wrong facility is money
/// posted to the wrong deposit.
export async function chargeableLease(
  actor: Actor,
  leaseId: string,
): Promise<CounterCharge | null> {
  if (actor.kind !== "staff") throw new ForbiddenError("Staff access required");

  const lease = await prisma.lease.findFirst({
    where: { id: leaseId, status: { not: "ended" } },
    select: {
      id: true,
      facilityId: true,
      tenantId: true,
      unit: { select: { number: true } },
      tenant: { select: { firstName: true, lastName: true } },
    },
  });
  if (!lease) return null;

  assertFacilityAccess(actor, lease.facilityId);
  if (!can(actor, "payments:take", lease.facilityId)) {
    throw new ForbiddenError(
      "Missing permission payments:take",
      "payments:take",
      lease.facilityId,
    );
  }

  const balance = await prisma.ledgerEntry.aggregate({
    where: { leaseId: lease.id },
    _sum: { amountCents: true },
  });

  return {
    leaseId: lease.id,
    tenantId: lease.tenantId,
    facilityId: lease.facilityId,
    tenantName: `${lease.tenant.firstName} ${lease.tenant.lastName}`,
    unitNumber: lease.unit.number,
    balanceCents: balance._sum.amountCents ?? 0,
  };
}

export type CounterCardSetup =
  | { available: false }
  | {
      available: true;
      clientSecret: string;
      customerSessionSecret: string | null;
      paymentId: string;
      amountCents: number;
    };

/// Raises the PaymentIntent for a card presented at the counter.
///
/// The idempotency key is the lease, the amount AND the balance the amount was
/// chosen against — `startPortalPayment`'s key, deliberately the same shape,
/// because the failure it prevents is the same one: reloading the counter
/// screen must return the intent already raised rather than a second charge,
/// while a genuine second payment of the same amount gets a different key
/// because the first one moved the balance.
///
/// Namespaced `counter:` rather than `portal:` so a tenant paying the same
/// figure online and at the desk within Stripe's 24-hour window is not
/// deduplicated into one payment. They are two payments and the second must be
/// taken; a shared key would silently return the first one's intent, which the
/// Element then refuses as already succeeded — a decline with money in hand
/// and nothing wrong.
export async function startCounterCardPayment(
  actor: Actor,
  lease: CounterCharge,
  amountCents: number,
): Promise<CounterCardSetup> {
  if (actor.kind !== "staff") throw new ForbiddenError("Staff access required");
  assertFacilityAccess(actor, lease.facilityId);
  if (!can(actor, "payments:take", lease.facilityId)) {
    throw new ForbiddenError(
      "Missing permission payments:take",
      "payments:take",
      lease.facilityId,
    );
  }
  if (!paymentsEnabled()) return { available: false };

  const [intent, customerSessionSecret] = await Promise.all([
    createChargeIntent({
      facilityId: lease.facilityId,
      tenantId: lease.tenantId,
      leaseId: lease.leaseId,
      amountCents,
      reference: `counter:${lease.leaseId}:${amountCents}:${lease.balanceCents}`,
      description: `Counter payment — unit ${lease.unitNumber}`,
      // The tenant handed over a card to settle a balance, not to enrol in
      // anything. Autopay enrolment has its own disclosure (D-11a) and its own
      // screen; retaining a card because it passed through a staff-operated
      // terminal would be consent nobody gave.
      saveMethod: false,
      // Card and Link only. B-230's note on `methodsFor`: a bank debit that
      // clears in four business days does not reopen a gate today, and the
      // person at the desk would leave believing they had paid.
      surface: "counter",
    }),
    createCustomerSession(lease.tenantId),
  ]);

  return {
    available: true,
    clientSecret: intent.clientSecret,
    customerSessionSecret,
    paymentId: intent.paymentId,
    amountCents,
  };
}

export type CardOnFileResult =
  | { ok: true; paymentId: string; amountCents: number }
  | { ok: false; problem: "unavailable" | "no_method" | "declined"; message?: string };

/// US-32 / B-230. Charges the card the tenant already has on file.
///
/// The commonest counter request there is — "just put it on the card you have"
/// — and the tenant profile carried no payment control at all before this.
///
/// Off-session, because the cardholder is authorising by voice rather than by
/// re-presenting the card, and that is what Stripe's `off_session` flag means.
/// The consequence is that a decline arrives SYNCHRONOUSLY (Stripe throws, no
/// `payment_intent.payment_failed` webhook follows, because the confirmation
/// happened inside this request) — the same trap `runAutopay` documents, and
/// the reason this returns a `declined` problem rather than assuming a webhook
/// will explain itself later. `createChargeIntent` has already marked its own
/// Payment row failed with the reason before it rethrows.
///
/// The staffer is named on the audit entry, never on the Payment row's
/// `receivedByStaffId`: that column is US-32's attribution for money physically
/// received across a counter and a card charge is not that. Recording a staffer
/// as having received a card payment would put a name on a drawer count that
/// has no note behind it.
export async function chargeCardOnFile(
  actor: Actor,
  lease: CounterCharge,
  amountCents: number,
): Promise<CardOnFileResult> {
  if (actor.kind !== "staff") throw new ForbiddenError("Staff access required");
  assertFacilityAccess(actor, lease.facilityId);
  if (!can(actor, "payments:take", lease.facilityId)) {
    throw new ForbiddenError(
      "Missing permission payments:take",
      "payments:take",
      lease.facilityId,
    );
  }
  if (!paymentsEnabled()) return { ok: false, problem: "unavailable" };

  const tenant = await prisma.tenant.findUniqueOrThrow({
    where: { id: lease.tenantId },
    select: { stripeDefaultPaymentMethodId: true },
  });
  if (!tenant.stripeDefaultPaymentMethodId) {
    return { ok: false, problem: "no_method" };
  }

  try {
    const charge = await createChargeIntent({
      facilityId: lease.facilityId,
      tenantId: lease.tenantId,
      leaseId: lease.leaseId,
      amountCents,
      // Same key shape as the on-session counter charge above and for the same
      // reason, in its own namespace: a staffer who presses this twice while
      // the first round trip is in flight charges the card once.
      reference: `counter-cof:${lease.leaseId}:${amountCents}:${lease.balanceCents}`,
      description: `Counter payment — unit ${lease.unitNumber}`,
      offSession: true,
      paymentMethodId: tenant.stripeDefaultPaymentMethodId,
    });

    await recordAudit({
      actor: toAuditActor(actor),
      facilityId: lease.facilityId,
      action: "payment.card_on_file_charged",
      entityType: "Payment",
      entityId: charge.paymentId,
      context: {
        amountCents,
        leaseId: lease.leaseId,
        // The whole point of the audit row: a charge nobody was standing in
        // front of, made by a named person on a stored card.
        offSession: true,
        deduplicated: charge.deduplicated,
      },
    });

    return { ok: true, paymentId: charge.paymentId, amountCents };
  } catch (error) {
    return {
      ok: false,
      problem: "declined",
      message: error instanceof Error ? error.message : undefined,
    };
  }
}
