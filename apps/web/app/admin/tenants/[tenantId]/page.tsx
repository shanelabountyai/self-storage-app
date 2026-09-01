import Link from "next/link";
import { getAdminActor } from "@/lib/admin/context";
import {
  tenantProfile,
  type TenantInboundSmsRow,
  type TenantLeaseSummary,
  type TenantMessageRow,
} from "@/lib/admin/tenants";
import { formatCents } from "@/lib/format";
import { AdminForm, Field, FieldSet } from "@/components/admin/form";
import { AnnounceRegion } from "@/components/admin/announce";
import {
  addNoteAction,
  flagAddressReturnedAction,
  logDocumentAction,
  setNoticeGivenAction,
  setNotePinnedAction,
  updateActiveDutyAction,
  updateAddressAction,
  liftHoldAction,
  placeHoldAction,
  cancelPaymentPlanAction,
  refundAction,
  returnPaymentAction,
  setExtendedHoursAction,
  updateContactAction,
  waiveFeeAction,
} from "./actions";
import { startTenantImpersonationAction } from "@/app/admin/impersonation/actions";
import { IMPERSONATION_TTL_MINUTES } from "@/lib/impersonation/service";
import { can, hasPermissionAnywhere } from "@/lib/rbac/authorize";
import { ChargeFeeForm } from "@/components/admin/charge-fee-form";
import { PaymentPlanBuilder } from "@/components/admin/payment-plan-builder";
import { RefundMethodFields } from "@/components/admin/refund-method-fields";
import { chargeableFees, chargeableLeases } from "@/lib/billing/charges";
import { RETURN_FEE_CHOICES } from "@/lib/billing/reversals";
import { scheduledFeeCents } from "@/lib/billing/fee-invoice";
import { HOLD_TYPES, type HoldEffect } from "@storage/core/holds";
import { leaseStatusLabel } from "@storage/core/labels";
import {
  referralsForStaff,
  REFERRAL_STATE_LABELS,
} from "@/lib/referrals/portal";

/// The effects in an operator's words, on the banner. The catalog names them
/// for code; a staffer needs to know what stopped.
const EFFECT_LABELS: Record<HoldEffect, string> = {
  halt_dunning: "collections chasing",
  halt_late_fees: "late fees",
  halt_access_suspension: "gate suspension",
  block_auction: "auction",
  suppress_marketing: "marketing",
  halt_autopay: "automatic card payments",
};

/// The reason vocabulary from the audit catalog, narrowed to the ones that
/// actually explain a waived fee. Free text stays available in the note beside
/// it — the code is what keeps the audit log filterable.
/// B-146. The bank's own words, as a code the audit log can be filtered on —
/// the same discipline `WAIVER_REASONS` uses below. Which one it was decides
/// whether the fee was fair, so it is a field rather than free text.
const RETURN_REASONS = [
  { value: "insufficient_funds", label: "Insufficient funds" },
  { value: "account_closed", label: "Account closed" },
  { value: "stop_payment", label: "Stop payment" },
  { value: "invalid_account", label: "Account details wrong" },
  { value: "dispute_lost", label: "Card dispute lost" },
  { value: "bank_error", label: "Bank error (not the tenant)" },
] as const;

const WAIVER_REASONS = [
  { value: "customer_goodwill", label: "Customer goodwill" },
  { value: "billing_error", label: "Billing error" },
  { value: "system_error", label: "System error" },
  { value: "management_approval", label: "Management approval" },
  { value: "duplicate", label: "Duplicate charge" },
  { value: "other", label: "Other (explain in the note)" },
] as const;

export const metadata = { title: "Tenant profile" };

// PRD 02 §4.4 US-13/US-16. "Any staffer can pick up any conversation" — one
// screen: contact, address history, every lease and its balance, notes,
// logged documents, and what has been sent.

const FIELD_CLASS = "flex flex-col gap-1 text-sm";

/// B-181. How many rows of the two long logs stand open. Five is what fits
/// beside the rest of the page without the log becoming the page; the rest are
/// one disclosure away, never dropped.
const RECENT = 5;

/// B-186. `<input type="date">` needs `YYYY-MM-DD`; `formatDate` below is for
/// reading, not for a form control's `value`/`max`.
function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

function formatWhen(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export default async function TenantProfilePage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;
  const actor = await getAdminActor();
  const profile = await tenantProfile(actor, tenantId);

  // B-167. The charge control, one per lease this tenant has — ended leases
  // included, because the walk that finds the damage happens after they have
  // gone. The fee schedule is per FACILITY, so a tenant with units at two sites
  // gets the price each site set.
  const chargeable = (await chargeableLeases(tenantId)).filter((lease) =>
    can(actor, "fees:charge", lease.facilityId),
  );
  const feeSchedules = new Map(
    await Promise.all(
      [...new Set(chargeable.map((lease) => lease.facilityId))].map(
        async (facilityId) =>
          [facilityId, await chargeableFees(facilityId)] as const,
      ),
    ),
  );
  // B-178. What this facility charges for a returned payment, per facility a
  // returnable payment sits at. `assessNsfFee` reads the same schedule when the
  // return is recorded, so the figure on the control is the figure that posts —
  // and a null means the facility has priced none, which is a sentence rather
  // than a dropdown offering to charge nothing.
  const nsfFees = new Map(
    await Promise.all(
      [...new Set(profile.returnable.map((p) => p.facilityId))].map(
        async (facilityId) =>
          [facilityId, await scheduledFeeCents(facilityId, "nsf")] as const,
      ),
    ),
  );

  // PRD 10 §5.7 (B-101). Both sides — this tenant may be the referrer on one
  // and the referee on another.
  const referrals = await referralsForStaff(tenantId);

  // B-143. One list, newest first. Two stacked maps would have put every
  // inbound text above every outbound one whatever their dates said, which is
  // a worse lie than the truncation it replaced.
  const comms: ({ at: Date } & (
    | { sms: TenantInboundSmsRow; message?: undefined }
    | { sms?: undefined; message: TenantMessageRow }
  ))[] = [
    ...profile.inboundSms.map((sms) => ({ at: sms.createdAt, sms })),
    ...profile.messages.map((message) => ({ at: message.createdAt, message })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());

  // B-181. Both long logs render the same row in two places — the first
  // `RECENT`, and the disclosure holding everything older — so each row is a
  // function rather than a block copied twice. Declared in the component
  // rather than at module scope because both element types are inferred from
  // data this page already loaded; naming them would mean exporting two more
  // types for no reader's benefit.
  const gateEvent = (event: (typeof profile.accessHistory)[number]) => (
    <li
      key={event.id}
      className="border-input flex flex-wrap justify-between gap-2 rounded-lg border p-3 text-sm"
    >
      <span>
        {event.result === "granted" ? "Opened" : "Denied"}
        <span className="text-muted-foreground"> · {event.facilityName}</span>
        {event.unitNumber && (
          <span className="text-muted-foreground"> · {event.unitNumber}</span>
        )}
      </span>
      <span className="text-muted-foreground">
        {event.flags.length > 0 && <span>{event.flags.join(", ")} · </span>}
        {formatWhen(event.occurredAt)}
      </span>
    </li>
  );

  const commsItem = (entry: (typeof comms)[number]) =>
    entry.sms ? (
      <li
        key={entry.sms.id}
        className="border-input border-l-primary rounded-lg border border-l-4 p-3 text-sm"
      >
        {/* No <details>: the words are the reason the staffer is here.
                      Collapsing them behind a click is the defect B-143 fixed. */}
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span>
            {/* The direction in words, not only the border colour (1.4.1). */}
            <span className="font-medium">Text from this tenant</span>{" "}
            <span className="text-muted-foreground uppercase">sms</span>
          </span>
          <span className="text-muted-foreground">
            Received · {formatWhen(entry.sms.createdAt)}
          </span>
        </div>
        <dl className="text-muted-foreground mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          <dt>From</dt>
          <dd className="text-foreground">{entry.sms.phoneMasked}</dd>
        </dl>
        <pre className="bg-muted mt-2 max-h-64 overflow-auto rounded-md p-3 text-xs whitespace-pre-wrap">
          {entry.sms.body}
        </pre>
      </li>
    ) : (
      <li
        key={entry.message.id}
        className="border-input rounded-lg border p-3 text-sm"
      >
        {/* A native <details>: the exact text that went out is what makes
                      this a record rather than a summary, but twenty full bodies on
                      one page is unreadable. No JS, keyboard-operable as shipped. */}
        <details>
          <summary className="flex cursor-pointer flex-wrap items-baseline justify-between gap-2">
            <span>
              <span className="font-medium">
                {entry.message.subjectSnapshot ?? entry.message.templateKey}
              </span>{" "}
              <span className="text-muted-foreground uppercase">
                {entry.message.channel}
              </span>
            </span>
            <span className="text-muted-foreground capitalize">
              {entry.message.status} · {formatWhen(entry.message.createdAt)}
            </span>
          </summary>
          <dl className="text-muted-foreground mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
            <dt>To</dt>
            <dd className="text-foreground">{entry.message.toAddressMasked}</dd>
            <dt>Template</dt>
            <dd className="text-foreground">
              {entry.message.templateKey} · v{entry.message.templateVersion}
            </dd>
            <dt>Triggered by</dt>
            <dd className="text-foreground">
              {entry.message.eventType ?? "Sent directly by staff"}
            </dd>
            {entry.message.sentAt && (
              <>
                <dt>Handed to provider</dt>
                <dd className="text-foreground">
                  {formatWhen(entry.message.sentAt)}
                </dd>
              </>
            )}
          </dl>
          {entry.message.problem && (
            <p
              role="note"
              className="mt-2 rounded-md border border-red-300 bg-red-50 p-2 text-xs text-red-900"
            >
              {entry.message.problem}
            </p>
          )}
          <pre className="bg-muted mt-2 max-h-64 overflow-auto rounded-md p-3 text-xs whitespace-pre-wrap">
            {entry.message.bodySnapshot}
          </pre>
        </details>
      </li>
    );

  return (
    <div className="flex flex-col gap-8">
      <div>
        <Link
          href="/admin/tenants"
          className="text-sm underline underline-offset-2"
        >
          ← Back to search
        </Link>
        <h1 className="mt-1 text-lg font-semibold">
          {profile.firstName} {profile.lastName}
        </h1>
        {/* "Profile shows delinquency status prominently" — but nothing sets
            Lease.status to delinquent yet (B-057), so the real signal today is
            the ledger, same as the portal dashboard. */}
        {profile.totalBalanceCents > 0 && (
          <p
            role="alert"
            className="mt-2 inline-block rounded-md border border-red-300 bg-red-50 px-3 py-1 text-sm text-red-900"
          >
            Balance due: {formatCents(profile.totalBalanceCents)}
          </p>
        )}
      </div>

      {/* US-45's plain-English access line. Beside the hold banner because
          they answer the same question — why can this tenant not get in — and a
          staffer on the phone should not have to hunt for either. */}
      {profile.accessState.length > 0 && (
        <section
          aria-labelledby="access-heading"
          className="flex flex-col gap-2"
        >
          <h2 id="access-heading" className="sr-only">
            Gate access
          </h2>
          {profile.accessState.map((row) => (
            <p
              key={row.facilityName}
              className={
                row.suspended
                  ? "rounded-lg border-2 border-red-600 bg-red-50 p-3 text-sm font-medium text-red-950"
                  : "text-muted-foreground text-sm"
              }
            >
              {/* 1.4.1: the words carry it, not the border. */}
              {row.suspended
                ? "Gate access suspended"
                : "Gate access active"} — {row.facilityName}
              {row.summary ? `. ${row.summary}` : ""}
              {row.suspended
                ? ". It turns back on automatically when the balance reaches zero."
                : ""}
            </p>
          ))}
        </section>
      )}

      {/* US-42's persistent banner. First thing under the heading, before any
          control that could act on the account — a manager must never be able
          to approve a sale, or send a notice, without the hold in view. Never
          colour alone (1.4.1): the label and the note carry the meaning. */}
      {profile.emailUndeliverableAt && (
        // FR-15. Not colour alone (WCAG 1.4.1): the heading says "cannot be
        // reached", which is the whole message even in greyscale.
        <div
          role="note"
          className="rounded-lg border-2 border-red-500 bg-red-50 p-4 text-red-950"
        >
          <p className="font-semibold">Email cannot be reached</p>
          <p className="mt-1 text-sm text-pretty">
            Mail to {profile.email} bounced on{" "}
            {formatWhen(profile.emailUndeliverableAt)} and is now suppressed, so
            no further notices will go out by email. There is an open task for
            this. Reach them by phone; once the address is working again, lift
            the suppression under Settings → Suppressions and this clears.
          </p>
        </div>
      )}

      {profile.holds.length > 0 && (
        <section
          aria-labelledby="holds-heading"
          className="flex flex-col gap-3"
        >
          <h2 id="holds-heading" className="sr-only">
            Holds on this account
          </h2>
          {profile.holds.map((hold) => (
            <div
              key={hold.id}
              role="note"
              className="rounded-lg border-2 border-amber-500 bg-amber-50 p-4 text-amber-950"
            >
              <p className="font-semibold">
                On hold — {hold.label} · Unit {hold.unitNumber}
              </p>
              <p className="mt-1 text-sm text-pretty">{hold.bannerNote}</p>
              <p className="mt-2 text-sm text-pretty">
                <span className="font-medium">Reason given:</span> {hold.reason}
              </p>
              {hold.estateContactName && (
                <p className="mt-1 text-sm text-pretty">
                  <span className="font-medium">Estate contact:</span>{" "}
                  {hold.estateContactName}
                  {hold.estateContactPhone
                    ? ` · ${hold.estateContactPhone}`
                    : ""}
                  {hold.estateContactEmail
                    ? ` · ${hold.estateContactEmail}`
                    : ""}
                </p>
              )}
              <p className="mt-2 text-xs">
                Placed by {hold.placedByName} on{" "}
                {formatWhen(hold.effectiveFrom)}
                {hold.effectiveTo
                  ? ` · ends ${formatWhen(hold.effectiveTo)}`
                  : " · no end date"}
              </p>
              <p className="mt-1 text-xs">
                Stops:{" "}
                {hold.effects
                  .map((effect) => EFFECT_LABELS[effect] ?? effect)
                  .join(", ")}
              </p>

              <AdminForm
                action={liftHoldAction}
                label={`Lift the ${hold.label} hold`}
                className="mt-3 flex flex-wrap items-end gap-2"
              >
                <input type="hidden" name="tenantId" value={profile.tenantId} />
                <input type="hidden" name="holdId" value={hold.id} />
                <Field name="liftReason" label="Reason for lifting" />
                <button
                  type="submit"
                  className="border-input hover:bg-accent inline-flex min-h-11 items-center justify-center rounded-md border bg-white px-4 text-sm font-medium"
                >
                  Lift hold
                  <span className="sr-only">
                    {" "}
                    — {hold.label} on unit {hold.unitNumber}
                  </span>
                </button>
                {hold.liftRequiresManager && (
                  <p className="w-full text-xs">
                    Lifting this hold needs a manager or above.
                  </p>
                )}
              </AdminForm>
            </div>
          ))}
        </section>
      )}

      <section aria-labelledby="leases-heading" className="flex flex-col gap-3">
        <h2 id="leases-heading" className="font-medium">
          Leases
        </h2>
        {profile.leases.length === 0 ? (
          <p className="text-muted-foreground text-sm">No leases on file.</p>
        ) : (
          /* B-217. Two renderings of the same leases, and the UX call B-199
             left open. B-199 gave this table the scroll wrapper and the
             `min-w-2xl` floor that made its four action links reachable at
             375px — reachable by scrolling a 672px table sideways on a phone,
             which is what counter staff hold away from a desk. Below `sm`
             each lease is a card instead. The table and its floor stand
             unchanged above `sm`, and the floor stays load-bearing wherever a
             wrapper stays: `w-full` on its own sizes the table to exactly the
             wrapper's width, so the wrapper never scrolls and seven columns
             are crushed instead — reachable but unusable.

             Both renderings call `NoticeGiven` and `LeaseActions` rather than
             repeating them, because two copies of a four-link action set is
             how one of them acquires a fifth link the other never gets. */
          <>
          <div tabIndex={0} className="hidden overflow-x-auto sm:block">
            <table className="w-full min-w-2xl text-sm">
              <caption className="sr-only">Leases held by this tenant</caption>
              <thead>
                <tr className="border-b text-left">
                  <th scope="col" className="py-2 font-medium">
                    Facility / Unit
                  </th>
                  <th scope="col" className="py-2 font-medium">
                    Status
                  </th>
                  <th scope="col" className="py-2 font-medium">
                    Rate
                  </th>
                  {/* B-212. "Total balance", not "Balance": the plan builder
                      below shows a SECOND money figure for the same lease —
                      what is past due — and a staffer who typed this one into
                      the installments was refused with no way to tell which
                      number the form meant. The builder names both; this names
                      itself the same way. */}
                  <th scope="col" className="py-2 text-right font-medium">
                    Total balance
                  </th>
                  <th scope="col" className="py-2 font-medium">
                    Started
                  </th>
                  <th scope="col" className="py-2 font-medium">
                    Notice given
                  </th>
                  <th scope="col" className="py-2 font-medium">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {profile.leases.map((lease) => (
                  <tr key={lease.leaseId} className="border-b">
                    <td className="py-2">
                      {lease.facilityName} — {lease.unitNumber}
                    </td>
                    <td className="py-2 capitalize">
                      {leaseStatusLabel(lease.status)}
                    </td>
                    <td className="py-2">
                      {formatCents(lease.monthlyRateCents)}/mo
                    </td>
                    <td
                      className={`py-2 text-right tabular-nums ${lease.balanceCents > 0 ? "font-medium text-red-800" : ""}`}
                    >
                      {formatCents(lease.balanceCents)}
                    </td>
                    <td className="py-2">{formatDate(lease.startDate)}</td>
                    <td className="py-2">
                      <NoticeGiven lease={lease} tenantId={tenantId} />
                    </td>
                    <td className="py-2">
                      <LeaseActions
                        lease={lease}
                        tenantId={tenantId}
                        className="flex flex-wrap items-center gap-3"
                        linkClassName="underline underline-offset-2"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="flex flex-col gap-3 sm:hidden">
            {profile.leases.map((lease) => (
              <li
                key={lease.leaseId}
                className="border-input rounded-lg border p-4"
              >
                <h3 className="font-medium">
                  {lease.facilityName} — {lease.unitNumber}
                </h3>
                {/* The table's column headers are what named these figures;
                    a card has none, so each one is a labelled pair rather
                    than a bare number in a stack of numbers. */}
                <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                  <dt className="text-muted-foreground">Status</dt>
                  <dd className="capitalize">
                    {leaseStatusLabel(lease.status)}
                  </dd>
                  <dt className="text-muted-foreground">Total balance</dt>
                  <dd
                    className={`tabular-nums ${lease.balanceCents > 0 ? "font-medium text-red-800" : ""}`}
                  >
                    {formatCents(lease.balanceCents)}
                  </dd>
                  <dt className="text-muted-foreground">Rate</dt>
                  <dd>{formatCents(lease.monthlyRateCents)}/mo</dd>
                  <dt className="text-muted-foreground">Started</dt>
                  <dd>{formatDate(lease.startDate)}</dd>
                </dl>
                <div className="mt-2 text-sm">
                  <p className="text-muted-foreground">Notice given</p>
                  <NoticeGiven lease={lease} tenantId={tenantId} />
                </div>
                {/* 2.5.5-sized targets rather than the table's inline text
                    links: this is the rendering a thumb gets. */}
                <LeaseActions
                  lease={lease}
                  tenantId={tenantId}
                  className="mt-3 flex flex-wrap gap-2"
                  linkClassName="border-input hover:bg-accent inline-flex min-h-11 items-center rounded-md border px-3 text-sm font-medium"
                />
              </li>
            ))}
          </ul>
          </>
        )}
      </section>

      {/* PRD 02 §4.6 US-25 / PRD 01 §9 (B-090 part 3). The `payment_plan`
          hold has halted collections since B-096 with no schedule behind
          it — this is the schedule, per lease. */}
      {/* B-192. Gated on there being a plan, now that the builder has moved
          into `Actions`: what is left here is the READ half, and a heading
          with nothing under it is one more of the seventeen D-95 counted.
          Every chain comes from a plan, so `paymentPlans` is the whole test. */}
      {profile.paymentPlans.length > 0 && (
      <section aria-labelledby="payment-plans-heading" className="flex flex-col gap-3">
        <h2 id="payment-plans-heading" className="font-medium">
          Payment plans
        </h2>

        {/* D-98 (B-190). Repeats are the thing worth seeing, so they are said
            in words at the top rather than left to be counted off the cards.
            Not colour-carried (WCAG 1.4.1) and not a badge: it is a sentence.

            B-212. REPEATS — so a chain of one no longer renders. "Unit 104 has
            had 1 payment plan in the last twelve months, $0.00 has been
            collected across it" is the single card directly below it, said
            again in worse words, in a box that looks like a warning. */}
        {profile.planChains
          .filter((chain) => chain.count > 1)
          .map((chain) => (
            <p key={chain.leaseId} role="note" className="border-input rounded-lg border p-3 text-sm text-pretty">
              Unit {chain.unitNumber} has had{" "}
              <strong>{chain.count} payment plans</strong> in the last twelve
              months, and each one halted dunning, late fees and access
              suspension while it ran. {formatCents(chain.collectedCents)} has
              been collected across them.
            </p>
          ))}

        {profile.paymentPlans.map((plan) => (
          <div
            key={plan.id}
            role="note"
            className={`rounded-lg border-2 p-4 ${
              plan.status === "active"
                ? "border-blue-500 bg-blue-50 text-blue-950"
                : "border-input bg-muted"
            }`}
          >
            <p className="font-semibold">
              {plan.status === "active"
                ? "On a payment plan"
                : plan.status === "completed"
                  ? "Payment plan completed"
                  : plan.status === "broken"
                    ? "Payment plan broken — collections resumed"
                    : "Payment plan cancelled"}{" "}
              · Unit {plan.unitNumber} · agreed {formatDate(plan.createdAt)}
            </p>
            {/* D-98 (B-190). What this plan actually retired, beside what it
                promised. A replacement plan is agreed over the arrears that
                were LEFT, so its own progress restarts at zero and is right to
                — but without this line the money the previous plan collected
                is invisible, and a chain of five reads as five failures. */}
            <p className="mt-1 text-xs">
              {formatCents(plan.collectedCents)} collected of{" "}
              {formatCents(plan.totalCents)} deferred.
            </p>
            <table className="mt-2 w-full text-sm">
              <caption className="sr-only">
                Installment schedule for unit {plan.unitNumber}
              </caption>
              <thead>
                <tr className="border-b text-left">
                  <th scope="col" className="py-1 font-medium">
                    Due
                  </th>
                  <th scope="col" className="py-1 text-right font-medium">
                    Amount
                  </th>
                  {/* B-192. What a staffer and a tenant both read a schedule
                      for is "how much is left after this one", and neither
                      table showed it — six amounts and a total, with the
                      subtraction left to the reader on the phone. */}
                  <th scope="col" className="py-1 text-right font-medium">
                    Left after
                  </th>
                  <th scope="col" className="py-1 font-medium">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {plan.installments.map((installment, index) => (
                  <tr key={installment.position} className="border-b last:border-0">
                    <td className="py-1">{formatDate(installment.dueDate)}</td>
                    <td className="py-1 text-right tabular-nums">
                      {formatCents(installment.amountCents)}
                    </td>
                    <td className="py-1 text-right tabular-nums">
                      {formatCents(
                        plan.totalCents -
                          plan.installments
                            .slice(0, index + 1)
                            .reduce((sum, i) => sum + i.amountCents, 0),
                      )}
                    </td>
                    {/* B-210. Inside D-98's grace the plan is still alive,
                        and the counter has to be able to say so with the
                        deadline in it — a staffer reading "Missed" to a tenant
                        who has three days left is quoting a rule the product
                        does not run. */}
                    <td className="py-1 capitalize">
                      {installment.status === "missed" ? (
                        <span className="font-medium text-red-800">Missed</span>
                      ) : installment.status === "late" ? (
                        <span className="font-medium normal-case">
                          Late — pay by {formatDate(installment.graceEndsOn)}
                        </span>
                      ) : (
                        installment.status
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {/* D-97. Which of the two kinds of plan this is, in words rather
                than an icon — a staffer reading the schedule to a tenant on
                the phone is answering "what happens on the 15th", and the
                answer is different for each. `autoCollectEffective` rather
                than `autoCollect` because a plan agreed as auto-collect
                against a tenant who has since removed their card will not
                collect anything, and saying it will is worse than saying
                nothing. */}
            <p className="mt-2 text-xs text-pretty">
              {plan.autoCollectEffective
                ? "Each installment is charged to the card on file on its due date."
                : plan.autoCollect
                  ? "Agreed as automatic, but nothing will be charged — this lease has autopay off or no card on file. The tenant has to pay each installment themselves."
                  : "The tenant pays each installment themselves — nothing is charged automatically."}
            </p>
            {plan.note && (
              <p className="mt-2 text-xs">
                <span className="font-medium">Note:</span> {plan.note}
              </p>
            )}
          </div>
        ))}
      </section>
      )}

      {profile.waivableFees.length > 0 && (
        <section aria-labelledby="fees-heading" className="flex flex-col gap-3">
          <h2 id="fees-heading" className="font-medium">
            Outstanding fees
          </h2>
          <p className="text-muted-foreground max-w-prose text-xs text-pretty">
            Waiving posts a credit and voids the fee — the charge and the credit
            both stay on the ledger. It is audited with your name and the reason
            you pick.
          </p>
          <ul className="flex flex-col gap-3">
            {profile.waivableFees.map((fee) => (
              <li
                key={fee.invoiceId}
                className="border-input rounded-lg border p-4"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium">
                    {formatCents(fee.outstandingCents)}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    Invoice {fee.number} · Unit {fee.unitNumber} ·{" "}
                    {formatWhen(fee.issuedOn)}
                  </span>
                </div>
                <p className="text-muted-foreground mt-1 text-sm text-pretty">
                  {fee.description}
                </p>

                <AdminForm
                  action={waiveFeeAction}
                  label={`Waive fee ${fee.number}`}
                  className="mt-3 flex flex-wrap items-end gap-2"
                >
                  <input
                    type="hidden"
                    name="tenantId"
                    value={profile.tenantId}
                  />
                  <input type="hidden" name="invoiceId" value={fee.invoiceId} />
                  <Field
                    name="reasonCode"
                    label="Reason"
                    as="select"
                    defaultValue=""
                  >
                    <option value="">Choose a reason…</option>
                    {WAIVER_REASONS.map((reason) => (
                      <option key={reason.value} value={reason.value}>
                        {reason.label}
                      </option>
                    ))}
                  </Field>
                  <Field name="note" label="Note (optional)" />
                  <button
                    type="submit"
                    className="border-input hover:bg-accent inline-flex min-h-11 items-center justify-center rounded-md border px-4 text-sm font-medium"
                  >
                    Waive
                    <span className="sr-only">
                      {" "}
                      fee {fee.number} of {formatCents(fee.outstandingCents)}
                    </span>
                  </button>
                </AdminForm>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section
        aria-labelledby="contact-heading"
        className="flex flex-col gap-3"
      >
        <h2 id="contact-heading" className="font-medium">
          Contact
        </h2>
        {/* B-181. Read first. What a staffer reads down a phone line is four
            facts, and they were four filled-in inputs — a form is a worse way
            to read a phone number than a phone number is. The form is the same
            form, one disclosure away. */}
        <dl className="grid max-w-lg grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted-foreground">Email</dt>
          <dd>{profile.email}</dd>
          <dt className="text-muted-foreground">Phone</dt>
          <dd>
            {profile.phone ?? (
              <span className="text-muted-foreground">Not recorded</span>
            )}
          </dd>
          {(profile.altContactName ||
            profile.altContactPhone ||
            profile.altContactEmail) && (
            <>
              <dt className="text-muted-foreground">Alternate contact</dt>
              <dd>
                {[
                  profile.altContactName,
                  profile.altContactPhone,
                  profile.altContactEmail,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </dd>
            </>
          )}
        </dl>
        <details className="border-input rounded-lg border p-4">
          {/* Named after its content, not after the act (2.4.6): a rotor full
              of summaries reading "Edit" tells nobody which record. */}
          <summary className="cursor-pointer text-sm font-medium">
            Edit contact details
          </summary>
          <AdminForm
            action={updateContactAction}
            label="Contact details"
            className="mt-3 grid max-w-lg grid-cols-2 gap-3"
          >
            <input type="hidden" name="tenantId" value={tenantId} />
            <Field
              name="phone"
              label="Phone"
              type="tel"
              defaultValue={profile.phone ?? ""}
              className={FIELD_CLASS}
            />
            <Field
              name="altContactName"
              label="Alternate contact name"
              defaultValue={profile.altContactName ?? ""}
              className={FIELD_CLASS}
            />
            <Field
              name="altContactPhone"
              label="Alternate contact phone"
              type="tel"
              defaultValue={profile.altContactPhone ?? ""}
              className={FIELD_CLASS}
            />
            <Field
              name="altContactEmail"
              label="Alternate contact email"
              type="email"
              defaultValue={profile.altContactEmail ?? ""}
              className={FIELD_CLASS}
            />
            <button
              type="submit"
              className="border-input hover:bg-accent col-span-2 inline-flex min-h-11 items-center justify-center self-start rounded-md border px-4 text-sm font-medium"
            >
              Save contact details
            </button>
          </AdminForm>
        </details>
      </section>

      <section
        aria-labelledby="address-heading"
        className="flex flex-col gap-3"
      >
        <h2 id="address-heading" className="font-medium">
          Address of record
        </h2>
        {profile.address?.returnedMailAt && (
          <p
            role="alert"
            className="border-input rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900"
          >
            Mail sent to this address was returned on{" "}
            {formatDate(profile.address.returnedMailAt)}. Confirm a current
            address before relying on it.
          </p>
        )}
        {/* B-181. The address, as an address. Editing it is a few-times-a-month
            act and had five inputs standing where the one line belongs. */}
        {profile.address ? (
          <p className="max-w-lg text-sm">
            {profile.address.addressLine1}
            {profile.address.addressLine2
              ? `, ${profile.address.addressLine2}`
              : ""}
            <br />
            {profile.address.city} {profile.address.state}{" "}
            {profile.address.postalCode}
          </p>
        ) : (
          <p className="text-muted-foreground text-sm">No address on record.</p>
        )}
        {/* Stays in the open, deliberately. It is not an edit — it is the
            counterpart to the alert above, one click, and the thing a staffer
            does the moment a letter comes back. Behind "Edit address of
            record" it would be filed under the wrong verb. */}
        {profile.address && !profile.address.returnedMailAt && (
          <form action={flagAddressReturnedAction}>
            <input type="hidden" name="tenantId" value={tenantId} />
            <input type="hidden" name="addressId" value={profile.address.id} />
            <button
              type="submit"
              className="text-sm underline underline-offset-2"
            >
              Flag as returned mail
            </button>
          </form>
        )}
        <details className="border-input rounded-lg border p-4">
          <summary className="cursor-pointer text-sm font-medium">
            Edit address of record
          </summary>
          <AdminForm
            action={updateAddressAction}
            label="Address of record"
            className="mt-3 grid max-w-lg grid-cols-2 gap-3"
          >
            <input type="hidden" name="tenantId" value={tenantId} />
            <Field
              name="addressLine1"
              label="Street address"
              defaultValue={profile.address?.addressLine1 ?? ""}
              required
              className={`${FIELD_CLASS} col-span-2`}
            />
            <Field
              name="addressLine2"
              label="Apartment or unit"
              defaultValue={profile.address?.addressLine2 ?? ""}
              className={`${FIELD_CLASS} col-span-2`}
            />
            <Field
              name="city"
              label="City"
              defaultValue={profile.address?.city ?? ""}
              required
              className={FIELD_CLASS}
            />
            <Field
              name="state"
              label="State"
              defaultValue={profile.address?.state ?? ""}
              maxLength={2}
              required
              className={FIELD_CLASS}
            />
            <Field
              name="postalCode"
              label="ZIP code"
              defaultValue={profile.address?.postalCode ?? ""}
              required
              className={FIELD_CLASS}
            />
            <button
              type="submit"
              className="border-input hover:bg-accent col-span-2 inline-flex min-h-11 items-center justify-center self-start rounded-md border px-4 text-sm font-medium"
            >
              Save address
            </button>
          </AdminForm>
        </details>

        {profile.addressHistory.length > 1 && (
          <details className="border-input rounded-lg border p-4">
            <summary className="cursor-pointer text-sm font-medium">
              Address history
            </summary>
            <ul className="mt-3 flex flex-col gap-2 text-sm">
              {profile.addressHistory.map((row) => (
                <li key={row.id} className="text-muted-foreground">
                  {row.addressLine1}
                  {row.addressLine2 ? `, ${row.addressLine2}` : ""}, {row.city}{" "}
                  {row.state} {row.postalCode} — {formatDate(row.createdAt)} (
                  {row.source}){row.returnedMailAt && " · returned mail"}
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      {referrals.length > 0 && (
        // PRD 10 §5.7 (B-101). "A referral record is visible on both tenants'
        // profiles, with the reward state and, when refused, the rule that
        // refused it." The AC behind it is the one that matters: "a tenant
        // asking 'why didn't I get my $50' must be answerable at the counter
        // in one screen."
        <section
          aria-labelledby="referrals-heading"
          className="flex flex-col gap-3"
        >
          <h2 id="referrals-heading" className="font-medium">
            Referrals
          </h2>
          <div tabIndex={0} className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <caption className="sr-only">
                Referrals this tenant made or arrived on, with the reward state
                and the rule that refused any that did not pay
              </caption>
              <thead>
                <tr className="border-input border-b text-left">
                  <th scope="col" className="py-2 pr-4">
                    Who
                  </th>
                  <th scope="col" className="py-2 pr-4">
                    State
                  </th>
                  <th scope="col" className="py-2 pr-4">
                    Rewards
                  </th>
                </tr>
              </thead>
              <tbody>
                {referrals.map((referral) => (
                  <tr
                    key={referral.id}
                    className="border-input border-b align-top"
                  >
                    <th scope="row" className="py-2 pr-4 text-left font-medium">
                      {referral.role === "referrer"
                        ? `Referred ${referral.refereeName ?? "nobody yet"}`
                        : `Referred by ${referral.referrerName}`}
                    </th>
                    <td className="py-2 pr-4">
                      {/* In words, never a colour alone — the same 1.4.1 rule
                          the portal table follows. */}
                      {REFERRAL_STATE_LABELS[referral.state]}
                      {referral.refusedReason && (
                        <>
                          <span className="text-muted-foreground mt-1 block text-xs text-pretty">
                            {referral.refusedReason}
                          </span>
                          {/* The rule's own key beside the sentence: the
                              staffer reads the sentence to the tenant and can
                              match the key to the rule in the PRD. */}
                          <span className="text-muted-foreground block font-mono text-xs">
                            {referral.refusedRule}
                          </span>
                        </>
                      )}
                    </td>
                    <td className="py-2 pr-4 tabular-nums">
                      {referral.state === "earned" ? (
                        <>
                          {formatCents(referral.referrerRewardCents)} referrer ·{" "}
                          {formatCents(referral.refereeRewardCents)} new tenant
                        </>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section aria-labelledby="notes-heading" className="flex flex-col gap-3">
        <h2 id="notes-heading" className="font-medium">
          Notes
        </h2>
        <ul className="flex flex-col gap-2">
          {profile.notes.map((note) => (
            <li
              key={note.id}
              className="border-input rounded-lg border p-3 text-sm"
            >
              <p className="text-pretty">{note.body}</p>
              {/* A <div>, not a <p>: a <form> is block-level and cannot
                  legally nest inside a paragraph — the browser was silently
                  closing the <p> early and re-parenting it, which is exactly
                  the kind of DOM mismatch that fails hydration. */}
              <div className="text-muted-foreground mt-1 flex items-center gap-2 text-xs">
                <span>
                  {note.authorName} · {formatWhen(note.createdAt)}
                  {note.pinned && (
                    <span className="font-medium"> · Pinned</span>
                  )}
                </span>
                <form action={setNotePinnedAction} className="inline">
                  <input type="hidden" name="tenantId" value={tenantId} />
                  <input type="hidden" name="noteId" value={note.id} />
                  <input
                    type="hidden"
                    name="pinned"
                    value={note.pinned ? "no" : "yes"}
                  />
                  <button
                    type="submit"
                    className="underline underline-offset-2"
                  >
                    {note.pinned ? "Unpin" : "Pin"}
                  </button>
                </form>
              </div>
            </li>
          ))}
          {profile.notes.length === 0 && (
            <li className="text-muted-foreground text-sm">No notes yet.</li>
          )}
        </ul>
        <details className="border-input rounded-lg border p-4">
          <summary className="cursor-pointer text-sm font-medium">
            Add a note
          </summary>
          <AdminForm
            action={addNoteAction}
            label="Add a note"
            className="mt-3 flex max-w-lg flex-col gap-2"
          >
            <input type="hidden" name="tenantId" value={tenantId} />
            <label htmlFor="note-body" className="text-sm">
              New note
            </label>
            <textarea
              id="note-body"
              name="body"
              rows={3}
              className="border-input bg-background rounded-md border p-2 text-sm"
            />
            <p className="text-muted-foreground text-xs">
              Corrections are new notes — an existing note can&apos;t be edited
              once saved.
            </p>
            <button
              type="submit"
              className="border-input hover:bg-accent inline-flex min-h-11 items-center justify-center self-start rounded-md border px-4 text-sm font-medium"
            >
              Add note
            </button>
          </AdminForm>
        </details>
      </section>

      <section
        aria-labelledby="documents-heading"
        className="flex flex-col gap-3"
      >
        <h2 id="documents-heading" className="font-medium">
          Documents
        </h2>
        <ul className="flex flex-col gap-2">
          {profile.documents.map((document) => (
            <li
              key={document.id}
              className="border-input flex justify-between gap-2 rounded-lg border p-3 text-sm"
            >
              <span>
                {document.downloadable ? (
                  <a
                    href={`/admin/documents/${document.id}/file`}
                    className="font-medium underline underline-offset-2"
                  >
                    {document.title}
                  </a>
                ) : (
                  <span className="font-medium">{document.title}</span>
                )}{" "}
                <span className="text-muted-foreground capitalize">
                  ({document.type.replace("_", " ")})
                </span>
              </span>
              <span className="text-muted-foreground">
                {formatDate(document.createdAt)}
              </span>
            </li>
          ))}
          {profile.documents.length === 0 && (
            <li className="text-muted-foreground text-sm">No documents yet.</li>
          )}
        </ul>
        <details className="border-input rounded-lg border p-4">
          <summary className="cursor-pointer text-sm font-medium">
            Log a document
          </summary>
          <AdminForm
            action={logDocumentAction}
            label="Log a document"
            className="mt-3 flex max-w-lg flex-col gap-3"
          >
            <input type="hidden" name="tenantId" value={tenantId} />
            <Field
              name="type"
              label="Type"
              as="select"
              defaultValue="other"
              className={FIELD_CLASS}
            >
              <option value="id_copy">ID copy</option>
              <option value="insurance_proof">Insurance proof</option>
              <option value="other">Other / correspondence</option>
            </Field>
            <Field
              name="title"
              label="Title"
              required
              className={FIELD_CLASS}
            />
            <label htmlFor="doc-note" className="text-sm">
              Note (optional)
            </label>
            <textarea
              id="doc-note"
              name="note"
              rows={2}
              className="border-input bg-background rounded-md border p-2 text-sm"
            />
            <p className="text-muted-foreground text-xs">
              This records that a document exists and what it says —
              there&apos;s nowhere to attach a file yet.
            </p>
            <button
              type="submit"
              className="border-input hover:bg-accent inline-flex min-h-11 items-center justify-center self-start rounded-md border px-4 text-sm font-medium"
            >
              Log document
            </button>
          </AdminForm>
        </details>
      </section>

      <section
        aria-labelledby="gate-history-heading"
        className="flex flex-col gap-3"
      >
        <h2 id="gate-history-heading" className="font-medium">
          Recent gate activity
        </h2>
        <ul className="flex flex-col gap-2">
          {profile.accessHistory.slice(0, RECENT).map(gateEvent)}
          {profile.accessHistory.length > RECENT && (
            <li>
              <details>
                {/* Named by what is behind it, not "Show more" (2.4.6): a
                    rotor listing two identical "Show more" controls on one
                    page tells nobody which list they open. */}
                <summary className="cursor-pointer text-sm font-medium">
                  Show {profile.accessHistory.length - RECENT} older gate events
                </summary>
                <ul className="mt-2 flex flex-col gap-2">
                  {profile.accessHistory.slice(RECENT).map(gateEvent)}
                </ul>
              </details>
            </li>
          )}
          {profile.accessHistory.length === 0 && (
            <li className="text-muted-foreground text-sm">
              No gate activity recorded.
            </li>
          )}
        </ul>
      </section>

      <section aria-labelledby="comms-heading" className="flex flex-col gap-3">
        <h2 id="comms-heading" className="font-medium">
          Communication history
        </h2>
        <ul className="flex flex-col gap-2">
          {/* B-143. Inbound texts interleaved with what we sent, newest first.
              They have no `Message` row — D-83 keeps the words in the domain
              event — and the `inbound_sms_review` task links to this page, so
              this list is the only place the body is legible in full. */}
          {comms.slice(0, RECENT).map(commsItem)}
          {comms.length > RECENT && (
            <li>
              <details>
                <summary className="cursor-pointer text-sm font-medium">
                  Show {comms.length - RECENT} older messages
                </summary>
                <ul className="mt-2 flex flex-col gap-2">
                  {comms.slice(RECENT).map(commsItem)}
                </ul>
              </details>
            </li>
          )}
          {profile.messages.length === 0 && profile.inboundSms.length === 0 && (
            <li className="text-muted-foreground text-sm">
              Nothing sent to or received from this tenant yet.
            </li>
          )}
        </ul>
      </section>

      {/* B-181. One region for the writes a staffer reaches for a few times
          a month, all closed. They used to stand between the banner stack and
          the units — the support-session form was the THIRD thing on the page
          and the leases were the ninth. Nothing here is new and nothing is
          gone; a real <summary> exposes each one's state without script
          (4.1.2) and names what it opens rather than the act (2.4.6). */}
      <section
        aria-labelledby="actions-heading"
        className="flex flex-col gap-3"
      >
        <h2 id="actions-heading" className="font-medium">
          Actions
        </h2>
        {hasPermissionAnywhere(actor, ["impersonation:tenant"]) && (
          // PRD 09 FR-1/FR-2 (B-091 part 2). Started from the profile of somebody
          // you are already looking at, with a reason, and never from a box you
          // type an email into.
          //
          // Whether this actor may impersonate THIS tenant is decided by the
          // escalation guard on submit, not here: `hasPermissionAnywhere` only
          // asks whether the control is worth rendering at all, which is the
          // distinction lib/rbac/authorize.ts draws between it and `can()`.
          <details className="border-input rounded-lg border p-4">
            <summary className="cursor-pointer font-medium">
              View the portal as this tenant
            </summary>
            <div className="mt-3 flex flex-col gap-3">
              <p className="text-muted-foreground max-w-prose text-sm text-pretty">
                Opens their portal, exactly as they see it, for{" "}
                {IMPERSONATION_TTL_MINUTES} minutes and read-only — nothing can
                be changed, sent, or paid, and gate codes stay hidden. The
                tenant is not notified, and the reason you give is written to
                the audit log with your name against every screen you open.
              </p>
              <AdminForm
                action={startTenantImpersonationAction}
                label="Start a support session as this tenant"
                className="grid max-w-2xl gap-3 sm:grid-cols-2"
              >
                <input type="hidden" name="subjectId" value={tenantId} />
                <Field
                  name="reason"
                  label="Reason"
                  type="text"
                  required
                  hint="What you are trying to see, in a sentence."
                  className={FIELD_CLASS}
                />
                <Field
                  name="ticketRef"
                  label="Ticket reference (optional)"
                  type="text"
                  className={FIELD_CLASS}
                />
                <div className="sm:col-span-2">
                  <button
                    type="submit"
                    className="border-input hover:bg-accent inline-flex min-h-11 items-center justify-center rounded-md border px-4 text-sm font-medium"
                  >
                    Start support session
                  </button>
                </div>
              </AdminForm>
            </div>
          </details>
        )}

        <details className="border-input rounded-lg border p-4">
          <summary className="cursor-pointer font-medium">Place a hold</summary>
          <div className="mt-3 flex flex-col gap-3">
            <p className="text-muted-foreground max-w-prose text-xs text-pretty">
              A hold stops automated collections on one lease from tonight. What
              each type stops is fixed — it is shown on the banner once placed.
              Placing and lifting are both audited.
            </p>
            <AdminForm
              action={placeHoldAction}
              label="Place a hold"
              className="flex flex-wrap items-end gap-3"
            >
              <input type="hidden" name="tenantId" value={profile.tenantId} />
              <Field
                name="leaseId"
                label="Unit"
                as="select"
                defaultValue={profile.leases[0]?.leaseId ?? ""}
              >
                {profile.leases.map((lease) => (
                  <option key={lease.leaseId} value={lease.leaseId}>
                    {lease.unitNumber} — {lease.facilityName}
                  </option>
                ))}
              </Field>
              <Field name="type" label="Type" as="select" defaultValue="">
                <option value="">Choose a type…</option>
                {HOLD_TYPES.map((type) => (
                  <option key={type.type} value={type.type}>
                    {type.label}
                  </option>
                ))}
              </Field>
              <Field
                name="reason"
                label="Reason"
                hint="What you were told, and by whom."
              />
              <Field
                name="effectiveTo"
                label="Ends (optional)"
                type="date"
                hint="Leave empty for open-ended."
              />
              <Field
                name="estateContactName"
                label="Estate contact"
                hint="Required for a deceased tenant."
              />
              <Field
                name="estateContactPhone"
                label="Estate contact phone"
                type="tel"
              />
              <button
                type="submit"
                className="border-input hover:bg-accent inline-flex min-h-11 items-center justify-center rounded-md border px-4 text-sm font-medium"
              >
                Place hold
              </button>
            </AdminForm>
          </div>
        </details>

        {chargeable.length > 0 && (
          <details className="border-input rounded-lg border p-4">
            <summary className="cursor-pointer font-medium">
              Charge a fee
            </summary>
            <div className="mt-3 flex flex-col gap-3">
              <p className="text-muted-foreground max-w-prose text-xs text-pretty">
                Posts the fee as its own invoice, so autopay collects it and it
                can be waived like any other. The amount starts at this
                facility&apos;s own price — changing it is subject to your
                fee-waiver limit, in either direction. Your name, the price and
                what you charged are all recorded.
              </p>
              <ul className="flex flex-col gap-3">
                {chargeable.map((lease) => (
                  <li
                    key={lease.leaseId}
                    className="border-input rounded-lg border p-4"
                  >
                    <p className="mb-3 text-sm font-medium">
                      Unit {lease.unitNumber} · {lease.facilityName}
                      {/* 1.4.1: the ended state is words, not a greyed row. */}
                      {lease.ended && (
                        <span className="text-muted-foreground font-normal">
                          {" "}
                          · moved out
                        </span>
                      )}
                    </p>
                    <ChargeFeeForm
                      tenantId={profile.tenantId}
                      leaseId={lease.leaseId}
                      fees={feeSchedules.get(lease.facilityId) ?? []}
                      unitLabel={`unit ${lease.unitNumber} at ${lease.facilityName}`}
                    />
                  </li>
                ))}
              </ul>
            </div>
          </details>
        )}

        {profile.refundable.length > 0 && (
          <details className="border-input rounded-lg border p-4">
            <summary className="cursor-pointer font-medium">
              Refund a payment
            </summary>
            <div className="mt-3 flex flex-col gap-3">
              <p className="text-muted-foreground max-w-prose text-xs text-pretty">
                A card refund goes back to the card the tenant paid with. Cash
                and check refunds are recorded as a payable — the money is not
                paid until someone hands it over. Refunding unwinds what the
                payment settled, so the invoices reopen.
              </p>
              <ul className="flex flex-col gap-3">
                {profile.refundable.map((payment) => (
                  <li
                    key={payment.paymentId}
                    className="border-input rounded-lg border p-4"
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="font-medium">
                        {formatCents(payment.refundableCents)} refundable
                      </span>
                      <span className="text-muted-foreground text-xs">
                        {formatCents(payment.amountCents)} by {payment.method}{" "}
                        on {formatWhen(payment.receivedAt)}
                        {payment.receiptNumber
                          ? ` · receipt #${payment.receiptNumber}`
                          : ""}
                        {payment.refundedCents > 0
                          ? ` · ${formatCents(payment.refundedCents)} already refunded`
                          : ""}
                      </span>
                    </div>

                    <AdminForm
                      action={refundAction}
                      label={`Refund payment ${payment.paymentId}`}
                      className="mt-3 flex flex-wrap items-end gap-2"
                    >
                      <input
                        type="hidden"
                        name="tenantId"
                        value={profile.tenantId}
                      />
                      <input
                        type="hidden"
                        name="paymentId"
                        value={payment.paymentId}
                      />
                      <Field
                        name="amountDollars"
                        label="Amount ($)"
                        type="text"
                        inputMode="decimal"
                        defaultValue={(payment.refundableCents / 100).toFixed(
                          2,
                        )}
                      />
                      <RefundMethodFields
                        defaultMethod={
                          payment.method === "card" ? "card" : "cash"
                        }
                      />
                      <Field
                        name="reasonCode"
                        label="Reason"
                        as="select"
                        defaultValue=""
                      >
                        <option value="">Choose a reason…</option>
                        {WAIVER_REASONS.map((reason) => (
                          <option key={reason.value} value={reason.value}>
                            {reason.label}
                          </option>
                        ))}
                      </Field>
                      <Field name="note" label="Note (optional)" />
                      <button
                        type="submit"
                        className="border-input hover:bg-accent inline-flex min-h-11 items-center justify-center rounded-md border px-4 text-sm font-medium"
                      >
                        Refund
                        <span className="sr-only">
                          {" "}
                          up to {formatCents(payment.refundableCents)}
                        </span>
                      </button>
                    </AdminForm>
                  </li>
                ))}
              </ul>
            </div>
          </details>
        )}

        {profile.returnable.length > 0 &&
          // `returnPayment` re-checks per facility and throws; this only decides
          // whether to render a form the actor could never submit — the same
          // shape the impersonation block above uses and for the same reason.
          hasPermissionAnywhere(actor, ["refunds:approve"]) && (
            <details className="border-input rounded-lg border p-4">
              <summary className="cursor-pointer font-medium">
                Record a returned payment
              </summary>
              <div className="mt-3 flex flex-col gap-3">
                <p className="text-muted-foreground max-w-prose text-xs text-pretty">
                  For a check that bounced, an ACH return or a lost dispute —
                  money we recorded and the bank took back.{" "}
                  <strong>This is not a refund.</strong> No money leaves the
                  drawer and the deposit slip it was banked on is unchanged;
                  what happens is that the original entry is reversed, the
                  invoices it settled reopen with their original due dates, and
                  the facility&apos;s returned-payment fee is charged if one is
                  configured. The tenant sees it on their own payment list.
                </p>
                <AnnounceRegion>
                  <ul className="flex flex-col gap-3">
                    {profile.returnable.map((payment) => (
                      <li
                        key={payment.paymentId}
                        className="border-input rounded-lg border p-3"
                      >
                        <p className="text-sm">
                          <span className="font-medium">
                            {formatCents(payment.amountCents)}
                          </span>{" "}
                          <span className="text-muted-foreground">
                            {payment.method.replace("_", " ")} ·{" "}
                            {formatWhen(payment.receivedAt)}
                            {payment.receiptNumber !== null &&
                              ` · receipt #${payment.receiptNumber}`}
                          </span>
                        </p>
                        <AdminForm
                          action={returnPaymentAction}
                          label={`Record a return of ${formatCents(payment.amountCents)}`}
                          // B-170. Recording the return removes this payment from
                          // `profile.returnable`, so the row reporting the outcome is
                          // the row the outcome deletes — and the message says which
                          // invoices reopened, which is the part a staffer needs
                          // before the tenant rings.
                          announceOutside
                          className="mt-3 flex flex-wrap items-end gap-3"
                        >
                          <input
                            type="hidden"
                            name="tenantId"
                            value={tenantId}
                          />
                          <input
                            type="hidden"
                            name="paymentId"
                            value={payment.paymentId}
                          />
                          <Field
                            name="reasonCode"
                            label="What the bank said"
                            as="select"
                            className={FIELD_CLASS}
                          >
                            {RETURN_REASONS.map((reason) => (
                              <option key={reason.value} value={reason.value}>
                                {reason.label}
                              </option>
                            ))}
                          </Field>
                          <Field
                            name="note"
                            label="Note"
                            className={FIELD_CLASS}
                          />
                          {/* B-178. Named after its subject rather than the
                          action (2.4.6), and the amount is IN the option,
                          because the amount is the decision being taken here.
                          When the facility has priced no returned-payment fee
                          there is no control: a dropdown offering to charge
                          nothing is a question with no answer, and the sentence
                          says what happens instead. */}
                          {nsfFees.get(payment.facilityId) == null ? (
                            <p className="text-muted-foreground max-w-prose self-end text-xs text-pretty">
                              This facility has not priced a returned-payment
                              fee, so none is charged.
                            </p>
                          ) : (
                            <Field
                              name="chargeFee"
                              label="Returned-payment fee"
                              as="select"
                              defaultValue="yes"
                              className={FIELD_CLASS}
                            >
                              {RETURN_FEE_CHOICES.map((choice) => (
                                <option key={choice.value} value={choice.value}>
                                  {choice.label.replace(
                                    "{amount}",
                                    formatCents(
                                      nsfFees.get(payment.facilityId) ?? 0,
                                    ),
                                  )}
                                </option>
                              ))}
                            </Field>
                          )}
                          <button
                            type="submit"
                            className="border-input hover:bg-accent inline-flex min-h-11 items-center justify-center rounded-md border px-4 text-sm font-medium"
                          >
                            Record the return
                          </button>
                        </AdminForm>
                      </li>
                    ))}
                  </ul>
                </AnnounceRegion>
              </div>
            </details>
          )}


        {/* B-192 / D-95. The payment-plan WRITES belong here, not beside the
            schedule they act on. D-95 settled — the day before B-090c shipped
            — that the read stack runs uninterrupted and every occasional
            write sits in this one closed region; a builder and a cancel form
            inserted between Leases and Outstanding fees is exactly the
            reversal that decision exists to stop. The plan's status, its
            chain and its schedule stay up there, where they are read.

            The `AnnounceRegion` is mounted unconditionally around both, and
            that is the point (B-170): each of these forms is REMOVED by its
            own success — cancelling unmounts the cancel disclosure, agreeing
            filters the builder out — so a `role="status"` inside either one
            is populated in the same commit React unmounts it, announcing
            nothing and dropping focus to <body> (4.1.3, 2.4.3). */}
        <AnnounceRegion>
          {profile.paymentPlans
            .filter((plan) => plan.status === "active")
            .filter((plan) =>
              can(
                actor,
                "delinquency:execute_step",
                profile.leases.find((l) => l.leaseId === plan.leaseId)?.facilityId ?? "",
              ),
            )
            .map((plan) => (
              <details key={plan.id} className="border-input rounded-lg border p-4">
                <summary className="cursor-pointer font-medium">
                  Cancel the payment plan on unit {plan.unitNumber}
                </summary>
                <div className="mt-3 flex flex-col gap-3">
                  <p className="text-muted-foreground max-w-prose text-xs text-pretty">
                    Cancelling lifts the hold tonight — dunning, late fees and
                    access suspension resume on this lease, and everything the
                    plan deferred is past due again in full. The tenant is
                    emailed straight away, with your reason in it. It counts
                    towards the number of plans this lease may have in a year,
                    so agreeing a replacement may need a manager.
                  </p>
                  <AdminForm
                    action={cancelPaymentPlanAction}
                    label={`Cancel the payment plan on unit ${plan.unitNumber}`}
                    className="flex flex-wrap items-end gap-2"
                    announceOutside
                  >
                    <input type="hidden" name="tenantId" value={profile.tenantId} />
                    <input type="hidden" name="planId" value={plan.id} />
                    {/* B-192. Named after its subject, not after the act: a
                        multi-unit tenant renders one of these per plan, and
                        "Reason for cancelling" beside "Cancel plan" is
                        indistinguishable from its neighbour out of context
                        (2.4.6). The server refuses `missing_reason`, so the
                        field says so and carries `required` rather than
                        letting the refusal be the first the staffer hears of
                        it (3.3.2).

                        B-206: the hint said "audit log" and only that, which
                        was true until this reason started being emailed to the
                        tenant. A staffer typing an internal shorthand into a
                        field they believe only colleagues read is the whole
                        hazard, so the tenant is named first. */}
                    <Field
                      name="cancelReason"
                      label={`Reason for cancelling the plan on unit ${plan.unitNumber}`}
                      hint="Required. The tenant is emailed this wording, so write it to them. It is also written to the audit log with your name."
                      required
                      className={FIELD_CLASS}
                    />
                    <button
                      type="submit"
                      className="border-input hover:bg-accent inline-flex min-h-11 items-center justify-center rounded-md border bg-white px-4 text-sm font-medium"
                    >
                      Cancel the plan on unit {plan.unitNumber}
                    </button>
                  </AdminForm>
                </div>
              </details>
            ))}

          {profile.leases
            .filter((lease) => lease.status !== "ended")
            .filter(
              (lease) =>
                !profile.paymentPlans.some(
                  (plan) => plan.leaseId === lease.leaseId && plan.status === "active",
                ),
            )
            /* B-212. Nothing past due, no plan to agree. The disclosure used to
               render for every non-ended lease with no active plan, so on a
               current tenant it opened to "$0.00 is past due" over twelve
               fields and refused every submit — `validateSchedule` returns
               "There is nothing past due on this lease to put on a plan"
               before it looks at anything else. A control that can never
               succeed is worse than an absent one. */
            .filter((lease) => lease.arrearsCents > 0)
            .filter((lease) => can(actor, "delinquency:execute_step", lease.facilityId))
            .map((lease) => (
              <details key={lease.leaseId} className="border-input rounded-lg border p-4">
                <summary className="cursor-pointer font-medium">
                  Set up a payment plan — unit {lease.unitNumber}
                </summary>
                <div className="mt-3">
                  {/* B-212. The other control that can never succeed: D-98's
                      rolling-year cap is checked by `createPaymentPlan` BEFORE
                      the schedule, so at the limit every one of these twelve
                      fields is filled in for nothing. The count comes from
                      `planCapFor` — the same function the server refuses with,
                      not a recount off the cards below — so this cannot refuse
                      a plan the server would take. The wording matches that
                      refusal, including where the limit is changed. */}
                  {lease.planCap.priorCount >= lease.planCap.limit ? (
                    <p role="note" className="max-w-prose text-sm text-pretty">
                      This lease has already had {lease.planCap.priorCount} payment{" "}
                      {lease.planCap.priorCount === 1 ? "plan" : "plans"} in the last
                      twelve months, and this facility allows {lease.planCap.limit}.
                      Another one would halt collections again with nothing new
                      agreed — the limit is in facility settings if it is wrong.
                    </p>
                  ) : (
                    <PaymentPlanBuilder
                      tenantId={profile.tenantId}
                      leaseId={lease.leaseId}
                      unitNumber={lease.unitNumber}
                      arrearsCents={lease.arrearsCents}
                      balanceCents={lease.balanceCents}
                      planGraceDays={lease.planGraceDays}
                    />
                  )}
                </div>
              </details>
            ))}
        </AnnounceRegion>

        {/* B-121 / D-49. Its own section, not a fifth box in the contact grid:
            this is a legal-status declaration with automatic consequences on
            every lease the tenant holds, and filing it beside "alternate contact
            email" would read as one more optional detail. */}
        <details className="border-input rounded-lg border p-4">
          <summary className="cursor-pointer font-medium">
            Military service
          </summary>
          <div className="mt-3 flex flex-col gap-3">
            <AdminForm
              action={updateActiveDutyAction}
              label="Military service"
              className="flex max-w-lg flex-col gap-3"
            >
              <input type="hidden" name="tenantId" value={tenantId} />
              <FieldSet
                name="activeDutyMilitary"
                legend="Active-duty military (SCRA)"
                hint={
                  profile.activeDutyMilitary === null
                    ? "Nobody has recorded an answer for this tenant. Recording yes stops collections, late fees, gate suspension, auction and marketing on every lease they hold — including at other facilities."
                    : "Recording yes stops collections, late fees, gate suspension, auction and marketing on every lease they hold — including at other facilities."
                }
              >
                <div className="mt-3 flex flex-col gap-2">
                  <label className="border-input flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border p-3">
                    <input
                      type="radio"
                      name="activeDutyMilitary"
                      value="yes"
                      defaultChecked={profile.activeDutyMilitary === true}
                      className="mt-1"
                    />
                    <span>
                      <span className="font-medium">Yes — on active duty</span>
                      <span className="text-muted-foreground block text-sm">
                        Places an SCRA hold on every current lease straight
                        away.
                      </span>
                    </span>
                  </label>
                  <label className="border-input flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border p-3">
                    <input
                      type="radio"
                      name="activeDutyMilitary"
                      value="no"
                      defaultChecked={profile.activeDutyMilitary === false}
                      className="mt-1"
                    />
                    <span>
                      <span className="font-medium">No</span>
                      <span className="text-muted-foreground block text-sm">
                        Corrects the record only. A hold already in force stays
                        until a manager lifts it on the lease below.
                      </span>
                    </span>
                  </label>
                </div>
              </FieldSet>
              <button
                type="submit"
                className="border-input hover:bg-accent inline-flex min-h-11 items-center justify-center self-start rounded-md border px-4 text-sm font-medium"
              >
                Save military service
              </button>
            </AdminForm>
          </div>
        </details>

        {profile.gateAccess.length > 0 && (
          <details className="border-input rounded-lg border p-4">
            <summary className="cursor-pointer font-medium">
              Gate access — 24-hour
            </summary>
            <div className="mt-3 flex flex-col gap-3">
              {profile.gateAccess.map((grant) => (
                <form
                  key={grant.grantId}
                  action={setExtendedHoursAction}
                  className="border-input flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 text-sm"
                >
                  <input type="hidden" name="grantId" value={grant.grantId} />
                  <input
                    type="hidden"
                    name="facilityId"
                    value={grant.facilityId}
                  />
                  <input
                    type="hidden"
                    name="tenantId"
                    value={profile.tenantId}
                  />
                  <span>
                    <span className="font-medium">{grant.facilityName}</span>
                    <span className="text-muted-foreground">
                      {" "}
                      · {grant.state}
                    </span>
                  </span>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      name="extendedHours"
                      defaultChecked={grant.extendedHours}
                      className="size-4"
                    />
                    24-hour access (paid add-on)
                  </label>
                  <button
                    type="submit"
                    className="border-input hover:bg-accent inline-flex min-h-11 items-center rounded-md border px-4 text-sm font-medium"
                  >
                    Save
                  </button>
                </form>
              ))}
              <p className="text-muted-foreground text-xs text-pretty">
                Off means this tenant&apos;s code works only during the
                facility&apos;s published gate hours. Saving queues the change
                to the gate controller — it is not instant if the controller is
                offline.
              </p>
            </div>
          </details>
        )}
      </section>
    </div>
  );
}

/* B-217. The leases table renders twice — as a table above `sm`, as a card
   list below it — so each lease's two interactive cells are defined once
   here. Two copies of a four-link action set is how one of them ends up with
   a fifth link the other never got.

   The links carry no spacing or styling of their own: the caller supplies
   both, because the row wants inline text links and the card wants tap
   targets, and that is the only thing that differs between the two. */
function LeaseActions({
  lease,
  tenantId,
  className,
  linkClassName,
}: {
  lease: TenantLeaseSummary;
  tenantId: string;
  className: string;
  linkClassName: string;
}) {
  return (
    <div className={className}>
      {lease.status !== "ended" && (
        <>
          <Link
            href={`/admin/tenants/${tenantId}/move-out?lease=${lease.leaseId}`}
            className={linkClassName}
          >
            Move out
            <span className="sr-only"> from unit {lease.unitNumber}</span>
          </Link>
          <Link
            href={`/admin/tenants/${tenantId}/transfer?lease=${lease.leaseId}`}
            className={linkClassName}
          >
            Transfer
            <span className="sr-only"> out of unit {lease.unitNumber}</span>
          </Link>
        </>
      )}
      <Link
        href={`/admin/tenants/${tenantId}/ledger/${lease.leaseId}`}
        className={linkClassName}
      >
        Ledger
        <span className="sr-only"> for unit {lease.unitNumber}</span>
      </Link>
      <Link
        href={`/admin/tenants/${tenantId}/notices/${lease.leaseId}`}
        className={linkClassName}
      >
        Notices
        <span className="sr-only"> for unit {lease.unitNumber}</span>
      </Link>
    </div>
  );
}

function NoticeGiven({
  lease,
  tenantId,
}: {
  lease: TenantLeaseSummary;
  tenantId: string;
}) {
  return (
    <>
    {/* B-186. Off-platform notice, recorded rather than
        inferred. A walk-in who gave notice at the counter has
        no other way onto this field, and a blank date must
        stay blank until someone actually confirms one — never
        defaulted to today. */}
    {lease.status === "ended" ? (
      lease.noticeGivenAt ? (
        formatDate(lease.noticeGivenAt)
      ) : (
        <span className="text-muted-foreground">—</span>
      )
    ) : (
      /* B-194. `AdminForm` rather than a bare void `<form>`:
         `recordNoticeGiven` refuses a future date and an ended
         lease, and this caller used to discard both and
         revalidate regardless, so the row re-rendered
         identically whether it saved or not (3.3.1 A, 4.1.3
         AA). One form per row, so one row's refusal cannot
         appear against another's date.

         Named by FACILITY and unit, not unit alone: an
         `aria-label` makes each of these a `form` landmark,
         and a tenant renting unit 101 at two sites would
         otherwise give the page two landmarks with one name
         (axe `landmark-unique`). The first column of this
         table already reads the same pair. */
      <AdminForm
        action={setNoticeGivenAction}
        label={`Notice given on, ${lease.facilityName} unit ${lease.unitNumber}`}
        className="flex flex-wrap items-center gap-1"
      >
        <input type="hidden" name="tenantId" value={tenantId} />
        <input
          type="hidden"
          name="leaseId"
          value={lease.leaseId}
        />
        <Field
          name="noticeGivenAt"
          label={
            <span className="sr-only">
              Notice given on, {lease.facilityName} unit{" "}
              {lease.unitNumber}
            </span>
          }
          type="date"
          max={isoDate(new Date())}
          defaultValue={
            lease.noticeGivenAt
              ? isoDate(lease.noticeGivenAt)
              : ""
          }
          className="flex flex-col gap-1 text-xs"
        />
        <button
          type="submit"
          className="text-xs underline underline-offset-2"
        >
          Save
        </button>
      </AdminForm>
    )}
    </>
  );
}
