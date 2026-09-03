import Link from "next/link";
import { Button } from "@/components/ui/button";
import { AdminForm, Field } from "@/components/admin/form";
import { DayScheduleRow } from "@/components/admin/day-schedule-row";
import { getSwitcherData } from "@/lib/admin/context";
import { resolveSelectedFacility } from "@/lib/admin/facility-selection-logic";
import { hasPermissionAnywhere } from "@/lib/rbac/authorize";
import { getFacilitySettings } from "@/lib/admin/facility-settings";
import { formatCents } from "@/lib/format";
import { CLOSED_ALL_WEEK, DAYS_OF_WEEK } from "@storage/core/facility-settings";
import { currentPlans } from "@/lib/protection/plans";
import { facilityCameras } from "@/lib/access/cameras";
import { webhookSecretStatus } from "@/lib/access/webhook-secrets";
import {
  addFeeScheduleEntryAction,
  addLateFeeStepAction,
  updateBillingPolicyAction,
  updateEmailIdentityAction,
  updateSmsSettingsAction,
  updateGateAdapterAction,
  addCameraAction,
  removeCameraAction,
  rotateWebhookSecretAction,
  updateOperationsPolicyAction,
  addProtectionPlanAction,
  setProtectionPolicyAction,
  addTaxComponentAction,
  updateFacilityDetailsAction,
  updateFacilityHoursAction,
} from "./actions";

import { ALLOCATION_CATEGORIES } from "@storage/core/billing";
import { ScrollRegion } from "@/components/ui/scroll-region"
import { FacilityReadinessBanner } from "@/components/admin/facility-readiness-banner";

const ALLOCATION_LABELS: Record<string, string> = {
  tax: "Tax",
  fee: "Fees",
  protection: "Protection plan",
  rent: "Rent",
};

const TIMEZONES = Intl.supportedValuesOf("timeZone");
// The full catalogue B-047 added to the enum. `late` stays listed because a
// flat late amount is still a fee a facility may want on the schedule for
// reference, but the ladder above is what actually charges it.
const FEE_TYPES = [
  "admin",
  "late",
  "nsf",
  "lien",
  "lock_cut",
  "cleaning",
  "damage",
  "transfer",
  "certified_mail",
  "auction_cost",
] as const;

const FEE_TYPE_LABELS: Record<(typeof FEE_TYPES)[number], string> = {
  admin: "Admin fee",
  late: "Late fee (reference amount)",
  nsf: "Returned payment (NSF)",
  lien: "Lien processing",
  lock_cut: "Lock cut",
  cleaning: "Cleaning",
  damage: "Damage",
  transfer: "Unit transfer",
  certified_mail: "Certified mail",
  auction_cost: "Auction costs",
};

/// The ladder row in the operator's own words, not the enum's.
function describeLateFee(row: {
  basis: string;
  amountCents: number;
  percentBasisPoints: number;
}): string {
  const amount = formatCents(row.amountCents);
  const percent = `${row.percentBasisPoints / 100}%`;
  switch (row.basis) {
    case "flat":
      return amount;
    case "percent":
      return `${percent} of the overdue balance`;
    case "greater":
      return `the greater of ${amount} or ${percent}`;
    default:
      return `the lesser of ${amount} or ${percent}`;
  }
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatDate(value: Date): string {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(
    value,
  );
}

function formatDateTime(value: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: timezone,
  }).format(value);
}

// Facility settings CRUD (PRD 02 US-3, FR-9). Unlike the dashboard, there is
// no "all facilities" story here — settings are inherently per-facility, so
// this page just asks for one to be picked.
export default async function AdminSettingsPage() {
  const { actor, facilities, cookieValue, canSeeAll } = await getSwitcherData();
  const selected = resolveSelectedFacility(cookieValue, facilities, canSeeAll);

  if (selected.mode !== "single") {
    return (
      <p className="text-muted-foreground text-sm">
        Pick a specific facility above to edit its settings.
      </p>
    );
  }

  if (!hasPermissionAnywhere(actor, ["facility:settings"])) {
    return (
      <p className="text-muted-foreground text-sm">
        You don&apos;t have access to facility settings.
      </p>
    );
  }

  const facilityId = selected.facility.id;
  const settings = await getFacilitySettings(facilityId);
  const { facility } = settings;
  const plans = await currentPlans(facilityId);
  const [cameras, secretStatus] = await Promise.all([
    facilityCameras(facilityId),
    webhookSecretStatus(facilityId),
  ]);
  const lateFeeSteps = settings.currentLateFeeSteps;
  const officeHours = settings.officeHours ?? CLOSED_ALL_WEEK;
  const gateHours = settings.gateHours ?? CLOSED_ALL_WEEK;

  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <h1 className="text-lg font-semibold">{facility.name} settings</h1>

      {/* B-237. Every link below points into this page or a sibling of it, so
          the fix is one click from the sentence that says why it matters. */}
      <FacilityReadinessBanner facilityId={facilityId} />

      <section
        aria-labelledby="details-heading"
        className="flex flex-col gap-3"
      >
        <h2 id="details-heading" className="text-base font-medium">
          Facility details
        </h2>
        <AdminForm
          action={updateFacilityDetailsAction}
          label="Facility details"
          className="grid grid-cols-1 gap-3 sm:grid-cols-2"
        >
          <input type="hidden" name="facilityId" value={facilityId} />

          <Field
            name="name"
            label="Name"
            defaultValue={facility.name}
            required
            className="flex flex-col gap-1 text-sm sm:col-span-2"
          />
          <Field
            name="addressLine1"
            label="Address line 1"
            defaultValue={facility.addressLine1}
            required
            className="flex flex-col gap-1 text-sm sm:col-span-2"
          />
          <Field
            name="addressLine2"
            label="Address line 2"
            defaultValue={facility.addressLine2 ?? ""}
            className="flex flex-col gap-1 text-sm sm:col-span-2"
          />
          <Field
            name="city"
            label="City"
            defaultValue={facility.city}
            required
          />
          <Field
            name="state"
            label="State"
            defaultValue={facility.state}
            required
            maxLength={2}
            hint="Two-letter code, for example TX."
          />
          <Field
            name="postalCode"
            label="Postal code"
            defaultValue={facility.postalCode}
            required
          />
          <Field
            name="timezone"
            label="Timezone"
            as="select"
            defaultValue={facility.timezone}
            required
          >
            {TIMEZONES.map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </Field>
          {/* B-237. Geo had no control anywhere in the product, and a site
              with either coordinate missing is skipped by renter search
              entirely. */}
          <Field
            name="latitude"
            label="Latitude"
            defaultValue={facility.latitude ?? ""}
            hint="Leave both blank to use the centre of the postal code. Without a position this site is left out of renter searches."
          />
          <Field
            name="longitude"
            label="Longitude"
            defaultValue={facility.longitude ?? ""}
          />
          <Field
            name="phone"
            label="Phone"
            type="tel"
            defaultValue={facility.phone ?? ""}
          />
          <Field
            name="email"
            label="Email"
            type="email"
            defaultValue={facility.email ?? ""}
          />

          <div className="sm:col-span-2">
            <Button type="submit">Save details</Button>
          </div>
        </AdminForm>
      </section>

      <section aria-labelledby="hours-heading" className="flex flex-col gap-3">
        <h2 id="hours-heading" className="text-base font-medium">
          Office &amp; gate hours
        </h2>
        <AdminForm
          action={updateFacilityHoursAction}
          label="Office and gate hours"
          className="flex flex-col gap-6"
        >
          <input type="hidden" name="facilityId" value={facilityId} />

          <div>
            <h3 className="mb-2 text-sm font-medium">Office hours</h3>
            <ScrollRegion aria-label="Office hours">
              <table className="w-full min-w-max text-left">
                <thead className="sr-only">
                  <tr>
                    <th scope="col">Day</th>
                    <th scope="col">Closed</th>
                    <th scope="col">Opens</th>
                    <th scope="col">Closes</th>
                  </tr>
                </thead>
                <tbody>
                  {DAYS_OF_WEEK.map((day) => (
                    <DayScheduleRow
                      key={day}
                      namePrefix="officeHours"
                      day={day}
                      value={officeHours[day]}
                    />
                  ))}
                </tbody>
              </table>
            </ScrollRegion>
          </div>

          <div>
            <h3 className="mb-2 text-sm font-medium">Gate hours</h3>
            <ScrollRegion aria-label="Gate hours">
              <table className="w-full min-w-max text-left">
                <thead className="sr-only">
                  <tr>
                    <th scope="col">Day</th>
                    <th scope="col">Closed</th>
                    <th scope="col">Opens</th>
                    <th scope="col">Closes</th>
                  </tr>
                </thead>
                <tbody>
                  {DAYS_OF_WEEK.map((day) => (
                    <DayScheduleRow
                      key={day}
                      namePrefix="gateHours"
                      day={day}
                      value={gateHours[day]}
                    />
                  ))}
                </tbody>
              </table>
            </ScrollRegion>
            <p className="text-muted-foreground mt-2 text-xs">
              Exposed at{" "}
              <code className="break-all">
                /api/facilities/{facilityId}/gate-hours
              </code>{" "}
              for the hardware module (PRD 03).
            </p>
          </div>

          <div>
            <Button type="submit">Save hours</Button>
          </div>
        </AdminForm>
      </section>

      <section aria-labelledby="tax-heading" className="flex flex-col gap-3">
        <h2 id="tax-heading" className="text-base font-medium">
          Tax components
        </h2>
        <p className="text-muted-foreground text-xs">
          Effective-dated: adding a new rate never changes invoices already
          generated under the old one (PRD 02 US-3).
        </p>

        {settings.currentTaxComponents.length > 0 && (
          <ScrollRegion aria-label="Tax components">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-muted-foreground">
                  <th scope="col" className="pb-1 font-normal">
                    Jurisdiction
                  </th>
                  <th scope="col" className="pb-1 font-normal">
                    Rate
                  </th>
                  <th scope="col" className="pb-1 font-normal">
                    Effective from
                  </th>
                </tr>
              </thead>
              <tbody>
                {settings.currentTaxComponents.map((tax) => (
                  <tr key={tax.jurisdiction}>
                    <th
                      scope="row"
                      className="py-1 text-left font-normal capitalize"
                    >
                      {tax.jurisdiction}
                    </th>
                    <td className="py-1">
                      {(tax.rateBasisPoints / 100).toFixed(2)}%
                    </td>
                    <td className="py-1">
                      {tax.effectiveFrom.toISOString().slice(0, 10)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollRegion>
        )}

        <AdminForm
          action={addTaxComponentAction}
          label="Add a tax component"
          className="flex flex-wrap items-end gap-3"
        >
          <input type="hidden" name="facilityId" value={facilityId} />
          <Field
            name="jurisdiction"
            label="Jurisdiction"
            placeholder="state, county, city…"
            required
          />
          <Field
            name="ratePercent"
            label="Rate (%)"
            type="number"
            step="0.01"
            min="0"
            max="100"
            required
            className="flex w-32 flex-col gap-1 text-sm"
          />
          <Field
            name="effectiveFrom"
            label="Effective from"
            type="date"
            defaultValue={todayIso()}
            required
          />
          <Button type="submit">Add rate</Button>
        </AdminForm>
      </section>

      <section aria-labelledby="fees-heading" className="flex flex-col gap-3">
        <h2 id="fees-heading" className="text-base font-medium">
          Fee schedule
        </h2>
        <p className="text-muted-foreground text-xs">
          Baseline amounts only. Late-fee rules — caps, grace periods and the
          ladder — are on{" "}
          <Link
            href="/admin/settings/delinquency"
            className="underline underline-offset-4"
          >
            Delinquency settings
          </Link>
          .
        </p>

        {settings.currentFeeSchedule.length > 0 && (
          <ScrollRegion aria-label="Fee schedule">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-muted-foreground">
                  <th scope="col" className="pb-1 font-normal">
                    Fee
                  </th>
                  <th scope="col" className="pb-1 font-normal">
                    Amount
                  </th>
                  <th scope="col" className="pb-1 font-normal">
                    Effective from
                  </th>
                </tr>
              </thead>
              <tbody>
                {settings.currentFeeSchedule.map((fee) => (
                  <tr key={fee.feeType}>
                    <th
                      scope="row"
                      className="py-1 text-left font-normal capitalize"
                    >
                      {fee.feeType}
                    </th>
                    <td className="py-1">{formatCents(fee.amountCents)}</td>
                    <td className="py-1">
                      {fee.effectiveFrom.toISOString().slice(0, 10)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollRegion>
        )}

        <AdminForm
          action={addFeeScheduleEntryAction}
          label="Add a fee schedule entry"
          className="flex flex-wrap items-end gap-3"
        >
          <input type="hidden" name="facilityId" value={facilityId} />
          <Field
            name="feeType"
            label="Fee type"
            as="select"
            required
            className="flex flex-col gap-1 text-sm capitalize"
          >
            {FEE_TYPES.map((type) => (
              <option key={type} value={type}>
                {FEE_TYPE_LABELS[type]}
              </option>
            ))}
          </Field>
          <Field
            name="amountDollars"
            label="Amount ($)"
            type="number"
            step="0.01"
            min="0"
            required
            className="flex w-32 flex-col gap-1 text-sm"
          />
          <Field
            name="effectiveFrom"
            label="Effective from"
            type="date"
            defaultValue={todayIso()}
            required
          />
          <Button type="submit">Add fee</Button>
        </AdminForm>
      </section>

      <section
        aria-labelledby="billing-heading"
        className="flex flex-col gap-3"
      >
        <h2 id="billing-heading" className="text-base font-medium">
          Billing policy
        </h2>
        <p className="text-muted-foreground max-w-prose text-xs text-pretty">
          When rent is billed, how far ahead the invoice goes out, and what
          happens when a card fails. These drive the nightly jobs — you can see
          every run on the Billing runs screen.
        </p>

        <AdminForm
          action={updateBillingPolicyAction}
          label="Billing policy"
          className="flex flex-wrap items-end gap-3"
        >
          <input type="hidden" name="facilityId" value={facilityId} />
          <Field
            name="billingPolicy"
            label="Billing day"
            as="select"
            defaultValue={facility.billingPolicy}
            hint="Anniversary means each lease bills on the day that tenant moved in."
          >
            <option value="anniversary">
              Each lease on its own move-in day
            </option>
            <option value="first_of_month">Every lease on the 1st</option>
          </Field>
          <Field
            name="invoiceLeadDays"
            label="Invoice this many days ahead"
            hint="Also how far ahead a payment-plan installment reminder goes out — one number for both, so shortening it moves those reminders too."
            type="number"
            min={0}
            max={28}
            defaultValue={facility.invoiceLeadDays}
          />
          <Field
            name="prorateOnMoveOut"
            label="On move-out"
            as="select"
            defaultValue={facility.prorateOnMoveOut ? "yes" : "no"}
          >
            <option value="no">Charge the full period they are in</option>
            <option value="yes">Charge only the days used</option>
          </Field>
          {/* B-103. A money-risk switch, so it sits with the other ones rather
              than beside the Stripe keys. Portal bank payments are always on
              and deliberately not configurable — there the tenant already has
              the unit. */}
          <Field
            name="achAtCheckoutEnabled"
            label="Accept bank payments at checkout"
            as="select"
            defaultValue={facility.achAtCheckoutEnabled ? "yes" : "no"}
            hint="A bank payment can reverse up to four business days after it is accepted, and a move-in hands over a unit and a gate code straight away. Off means new renters pay by card; tenants can always pay by bank from the portal."
          >
            <option value="no">No — card only at checkout</option>
            <option value="yes">Yes — allow bank payments</option>
          </Field>
          {/* B-145. Beside `prorateOnMoveOut` because it is the other money
              rule that only ever fires on the way out, and because leaving it
              unreachable would have repeated exactly the mistake B-144 was
              raised to fix. */}
          <Field
            name="promoRecapturePolicy"
            label="If a tenant leaves inside a promotion's minimum stay"
            as="select"
            defaultValue={facility.promoRecapturePolicy}
            hint="Only ever applies to a promotion that carries a minimum stay, and only to the discount already given — never to months that were promised but never reached. The tenant sees the amount and the reason before they confirm the move-out."
          >
            <option value="none">
              Nothing — the discount is theirs to keep
            </option>
            <option value="prorated">
              Recover the share of the minimum they did not serve
            </option>
            <option value="full">Recover the whole discount given</option>
          </Field>
          {/* B-162 / D-93. Beside the other rent rules, because it decides what
              a tenant pays and because "street" is a rent increase served with
              none of US-11's notice, approval or record. */}
          <Field
            name="transferRatePolicy"
            label="When a tenant moves to another unit here"
            as="select"
            defaultValue={facility.transferRatePolicy}
            hint="Staff can still type a different figure on the transfer screen; this is what it starts at. Keeping their discount means a like-for-like move costs exactly what they pay now — the other two either raise the rent with no notice period, or charge 10×20 money for a 5×10."
          >
            <option value="preserve_discount">
              Keep their discount off street — scaled to the new unit
            </option>
            <option value="street">
              Charge the new unit&apos;s street rate, as a new tenant would
            </option>
            <option value="in_place">
              Carry the same rate they pay now, whatever they move to
            </option>
          </Field>
          <Field
            name="prorateOnMoveIn"
            label="On move-in"
            as="select"
            defaultValue={facility.prorateOnMoveIn ? "yes" : "no"}
            hint="Only applies when every lease bills on the 1st."
          >
            <option value="yes">Charge only the days used</option>
            <option value="no">Charge a full month</option>
          </Field>
          <Field
            name="paymentRetryDays"
            label="Retry a failed card on days"
            defaultValue={facility.paymentRetryDays.join(", ")}
            hint="Days after the original due date, increasing. Leave empty for no retries."
          />
          <fieldset className="w-full">
            <legend className="text-sm font-medium">
              A partial payment pays off, in this order
            </legend>
            <p className="text-muted-foreground mt-1 text-xs text-pretty">
              Shipped as tax first (money held for the state rather than
              earned), then fees (an unpaid fee is what ages into the next one),
              then the protection plan, then rent — oldest first within each.
            </p>
            <div className="mt-2 flex flex-wrap gap-3">
              {[1, 2, 3, 4].map((position) => (
                <Field
                  key={position}
                  name={`allocation${position}`}
                  label={`${position}${position === 1 ? "st" : position === 2 ? "nd" : position === 3 ? "rd" : "th"}`}
                  as="select"
                  defaultValue={
                    facility.paymentAllocationOrder[position - 1] ??
                    ALLOCATION_CATEGORIES[position - 1]
                  }
                >
                  {ALLOCATION_CATEGORIES.map((category) => (
                    <option key={category} value={category}>
                      {ALLOCATION_LABELS[category]}
                    </option>
                  ))}
                </Field>
              ))}
            </div>
          </fieldset>
          <Field
            name="dunningDays"
            label="Chase a past-due balance on days"
            defaultValue={facility.dunningDays.join(", ")}
            hint="Days past due, increasing. Empty means no automated chasing. The wording gets firmer at each step."
          />
          <Field
            name="accessSuspendDaysPastDue"
            label="Suspend gate access at"
            type="number"
            min={0}
            max={180}
            defaultValue={facility.accessSuspendDaysPastDue}
            hint="Days past due. Enter 0 to never suspend for non-payment."
          />
          <Field
            name="surplusHoldDays"
            label="Hold an auction surplus for"
            type="number"
            min={1}
            max={3650}
            defaultValue={facility.surplusHoldDays}
            hint="Days after a lien sale before the surplus must be paid out or remitted to the state. This is a placeholder, not a legal figure — ask your attorney what your state requires."
          />
          <Field
            name="surplusNoticeLeadDays"
            label="Start chasing the surplus this many days before that"
            type="number"
            min={1}
            max={365}
            defaultValue={facility.surplusNoticeLeadDays}
            hint="How much warning staff get before the hold above runs out. A cheque or a comptroller filing takes time, so this is about your office, not about the law."
          />
          <Field
            name="accessRestoreAtOrBelowDollars"
            label="Restore access once the balance is at or below ($)"
            type="text"
            inputMode="decimal"
            defaultValue={(facility.accessRestoreAtOrBelowCents / 100).toFixed(
              2,
            )}
            hint="0.00 means the balance must be fully paid."
          />
          {/* D-98 (B-190). A payment plan is what STOPS everything above it —
              dunning, late fees, access suspension — so its three limits sit
              directly under them. Their own fieldset because a group of three
              numbers about one subject, each labelled with a bare noun, is
              otherwise three unrelated fields (WCAG 1.3.1). */}
          <fieldset className="border-input w-full rounded-lg border p-3">
            <legend className="px-1 text-sm font-medium">
              What a payment plan may commit to
            </legend>
            <p className="text-muted-foreground mt-1 max-w-prose text-xs text-pretty">
              Agreeing a plan halts everything above for as long as it runs.
              Without a limit, a plan broken last night can be replaced this
              morning, indefinitely, and the lien clock never runs. How much a
              member of staff may defer is set by their role, not here.
            </p>
            <div className="mt-2 flex flex-wrap gap-3">
              <Field
                name="planMaxDays"
                label="Longest plan (days)"
                type="number"
                min={1}
                max={730}
                defaultValue={facility.planMaxDays}
                hint="How far out the last installment may fall. A plan is capped at six installments whatever this says; six spaced sixty days apart is a year on hold."
              />
              <Field
                name="planMaxPerRollingYear"
                label="Plans per lease per year"
                type="number"
                min={1}
                max={12}
                defaultValue={facility.planMaxPerRollingYear}
                hint="Counted over the last twelve months, including plans that broke or were cancelled. The second one has to be agreed a level up; the one past this limit is refused."
              />
              <Field
                name="planGraceDays"
                label="Grace on a missed installment (days)"
                type="number"
                min={0}
                max={30}
                defaultValue={facility.planGraceDays}
                hint="Days after the due date before the plan breaks and collections resume. 0 breaks it that night, including over a payment made that afternoon."
              />
            </div>
          </fieldset>
          <p className="text-muted-foreground w-full max-w-prose text-xs text-pretty">
            Suspending stops a tenant reaching their own unit, so it is the
            setting on this page worth being sure about. It never applies to a
            lease on hold, and access comes back automatically within a couple
            of minutes of the balance clearing — no one has to do anything.
          </p>
          <Button type="submit">Save billing policy</Button>
        </AdminForm>
      </section>

      <section
        aria-labelledby="latefee-heading"
        className="flex flex-col gap-3"
      >
        <h2 id="latefee-heading" className="text-base font-medium">
          Late fees
        </h2>
        <p className="text-muted-foreground max-w-prose text-xs text-pretty">
          Charged automatically overnight once a lease reaches the days past due
          below, counted from the oldest unpaid rent invoice&apos;s original due
          date. Late fees never earn late fees, and a fee never exceeds what is
          owed. With no steps configured, nothing is charged.
        </p>

        {lateFeeSteps.length > 0 && (
          <ScrollRegion aria-label="Late-fee ladder">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">
                The late-fee ladder in force today
              </caption>
              <thead>
                <tr className="text-muted-foreground">
                  <th scope="col" className="pb-1 font-normal">
                    Step
                  </th>
                  <th scope="col" className="pb-1 font-normal">
                    Charged at
                  </th>
                  <th scope="col" className="pb-1 font-normal">
                    Amount
                  </th>
                  <th scope="col" className="pb-1 font-normal">
                    Cap
                  </th>
                  <th scope="col" className="pb-1 font-normal">
                    Since
                  </th>
                </tr>
              </thead>
              <tbody>
                {lateFeeSteps.map((row) => (
                  <tr key={row.step}>
                    <th scope="row" className="py-1 text-left font-normal">
                      {row.step}
                    </th>
                    <td className="py-1">{row.daysPastDue} days past due</td>
                    <td className="py-1">{describeLateFee(row)}</td>
                    <td className="py-1">
                      {row.capCents === null
                        ? "none"
                        : formatCents(row.capCents)}
                    </td>
                    <td className="py-1 tabular-nums">
                      {row.effectiveFrom.toISOString().slice(0, 10)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollRegion>
        )}

        <AdminForm
          action={addLateFeeStepAction}
          label="Add a late-fee step"
          className="flex flex-wrap items-end gap-3"
        >
          <input type="hidden" name="facilityId" value={facilityId} />
          <Field
            name="step"
            label="Step"
            type="number"
            min={1}
            max={5}
            defaultValue={1}
          />
          <Field
            name="daysPastDue"
            label="Days past due"
            type="number"
            min={1}
            max={180}
            defaultValue={5}
          />
          <Field name="basis" label="Charge" as="select" defaultValue="greater">
            <option value="greater">
              The greater of the amount or the percentage
            </option>
            <option value="lesser">
              The lesser of the amount or the percentage
            </option>
            <option value="flat">A flat amount</option>
            <option value="percent">A percentage of what is overdue</option>
          </Field>
          <Field
            name="amountDollars"
            label="Amount ($)"
            type="text"
            inputMode="decimal"
            defaultValue="20"
          />
          <Field
            name="percent"
            label="Percentage (%)"
            type="text"
            inputMode="decimal"
            defaultValue="10"
          />
          <Field
            name="capDollars"
            label="Cap ($)"
            type="text"
            inputMode="decimal"
            defaultValue="50"
            hint="Required for anything using a percentage."
          />
          <Field
            name="effectiveFrom"
            label="Effective from"
            type="date"
            defaultValue={todayIso()}
            required
          />
          <Button type="submit">Add step</Button>
        </AdminForm>
      </section>

      <section
        aria-labelledby="identity-heading"
        className="flex flex-col gap-3"
      >
        <h2 id="identity-heading" className="text-base font-medium">
          Email identity
        </h2>
        <p className="text-muted-foreground max-w-prose text-xs text-pretty">
          Tenants see this name in their inbox. The sending address itself stays
          on the shared authenticated domain — SPF and DKIM are set up there,
          and a per-facility address would need its own DNS before mail from it
          stopped landing in spam — so replies are routed by reply-to instead.
          Every email also carries this facility&apos;s postal address in the
          footer automatically.
        </p>
        <AdminForm
          action={updateEmailIdentityAction}
          label="Email identity"
          className="flex flex-wrap items-end gap-3"
        >
          <input type="hidden" name="facilityId" value={facilityId} />
          <Field
            name="emailFromName"
            label="From name"
            defaultValue={facility.emailFromName ?? ""}
            hint={`Empty uses the facility name: ${facility.name}`}
          />
          <Field
            name="emailReplyTo"
            label="Reply-to address"
            type="email"
            defaultValue={facility.emailReplyTo ?? ""}
            hint="Where a tenant's reply lands. Empty means replies go nowhere useful."
          />
          <Button type="submit">Save email identity</Button>
        </AdminForm>
        <p className="flex flex-wrap gap-4 text-sm">
          <Link
            href="/admin/settings/templates"
            className="underline underline-offset-2"
          >
            Edit message templates
          </Link>
          <Link
            href="/admin/settings/suppressions"
            className="underline underline-offset-2"
          >
            Suppressions — who we no longer write to
          </Link>
          <Link
            href="/admin/settings/marketing"
            className="underline underline-offset-2"
          >
            Marketing profile — copy, photos, FAQs, Google
          </Link>
          <Link
            href="/admin/settings/marketing/cities"
            className="underline underline-offset-2"
          >
            City page copy — the intro on each city landing page
          </Link>
          <Link
            href="/admin/settings/promotions"
            className="underline underline-offset-2"
          >
            Promotions — discounts and codes
          </Link>
          <Link
            href="/admin/settings/delinquency"
            className="underline underline-offset-2"
          >
            Delinquency timeline — what happens, and when
          </Link>
          <Link
            href="/admin/settings/notices"
            className="underline underline-offset-2"
          >
            Notice templates — the pre-lien and lien text this site sends
          </Link>
          <Link
            href="/admin/settings/reviews"
            className="underline underline-offset-2"
          >
            Reviews — manual entry and the review-request link
          </Link>
          <Link
            href="/admin/settings/facilities/new"
            className="underline underline-offset-2"
          >
            Add a facility — a new site, with your org defaults pushed into it
          </Link>
          <Link
            href="/admin/settings/org"
            className="underline underline-offset-2"
          >
            Org defaults — one fee schedule, ladder and timeline for the
            portfolio
          </Link>
          <Link
            href="/admin/settings/roles"
            className="underline underline-offset-2"
          >
            Role limits — the most each role may waive, refund, credit or defer
          </Link>
          <Link
            href="/admin/settings/staff"
            className="underline underline-offset-2"
          >
            Staff security — who has two-factor authentication switched on
          </Link>
        </p>
      </section>

      <section aria-labelledby="sms-heading" className="flex flex-col gap-3">
        <h2 id="sms-heading" className="text-base font-medium">
          SMS
        </h2>
        <p className="text-muted-foreground max-w-prose text-xs text-pretty">
          Leave the Messaging Service SID empty to keep SMS off for this
          facility — every reminder that would text still emails instead,
          exactly as if this section did not exist. Setting it up in Twilio (a
          phone number pool, A2P 10DLC brand and campaign registration, and
          Advanced Opt-Out on the Messaging Service) is a one-time console step
          this screen does not do for you.
        </p>
        <AdminForm
          action={updateSmsSettingsAction}
          label="SMS settings"
          className="flex flex-wrap items-end gap-3"
        >
          <input type="hidden" name="facilityId" value={facilityId} />
          <Field
            name="smsMessagingServiceSid"
            label="Twilio Messaging Service SID"
            defaultValue={facility.smsMessagingServiceSid ?? ""}
            hint="Starts with MG. Empty means SMS is off for this facility."
            className="flex flex-col gap-1 text-sm sm:col-span-2"
          />
          <Field
            name="smsQuietHoursStartHour"
            label="Sending window opens at (24h, facility-local)"
            type="number"
            min={0}
            max={23}
            defaultValue={facility.smsQuietHoursStartHour}
            hint="No SMS sends before this hour. TCPA's default is 8 (8am)."
          />
          <Field
            name="smsQuietHoursEndHour"
            label="Sending window closes at (24h, facility-local)"
            type="number"
            min={1}
            max={24}
            defaultValue={facility.smsQuietHoursEndHour}
            hint="No SMS sends at or after this hour. TCPA's default is 21 (9pm); a stricter state — Florida's mini-TCPA — needs 20 (8pm)."
          />
          <Button type="submit">Save SMS settings</Button>
        </AdminForm>
      </section>

      <section
        aria-labelledby="gate-adapter-heading"
        className="flex flex-col gap-3"
      >
        <h2 id="gate-adapter-heading" className="text-base font-medium">
          Gate controller
        </h2>
        <p className="text-muted-foreground max-w-prose text-xs text-pretty">
          How access changes reach the keypad. On <strong>manual</strong>,
          nothing is sent to a controller — every change becomes a task in the{" "}
          <Link
            href="/admin/access/queue"
            className="underline underline-offset-2"
          >
            keypad queue
          </Link>{" "}
          for somebody to key in. Switching back hands outstanding changes to
          the controller and cancels their tasks; grants and codes are never
          touched either way.
        </p>
        <AdminForm
          action={updateGateAdapterAction}
          label="Gate controller"
          className="flex flex-col gap-3"
        >
          <input type="hidden" name="facilityId" value={facility.id} />
          <Field
            name="gateAdapter"
            label="Controller"
            as="select"
            defaultValue={facility.gateAdapter}
          >
            <option value="simulated">Integrated controller</option>
            <option value="manual">Manual — staff key changes in</option>
            {/* B-080 / D-18. The one vendor stub, driving an in-repo emulator
                of the vendor's API — a real driver against a fake vendor. It
                proves the port survives a differently-shaped third-party API,
                which is the whole reason it exists; it is not a real
                integration and must not be selected for a live site. */}
            <option value="pti_cloud">
              PTI Cloud — vendor emulation (not a real integration)
            </option>
          </Field>
          <Field
            name="manualTaskSlaHours"
            label="Escalate a keypad task after"
            type="number"
            min={0}
            max={72}
            defaultValue={String(facility.manualTaskSlaHours)}
            hint="Business hours, counted against the office hours above — a change raised after closing is not late until somebody has had a chance to do it. 0 never escalates."
          />
          <Button type="submit" className="self-start">
            Save gate controller
          </Button>
        </AdminForm>

        <h3 className="text-sm font-medium">Webhook signing secret</h3>
        <p className="text-muted-foreground max-w-prose text-xs text-pretty">
          {secretStatus.unavailable
            ? "Rotation is unavailable because no access encryption key is configured — a signing key would have to be stored in the clear, which is worse than not offering the button."
            : secretStatus.configured
              ? `This site has its own signing secret, active since ${formatDate(secretStatus.activeSince!)}.`
              : "This site uses the shared default secret. Rotating gives it one of its own."}
          {secretStatus.retiring.length > 0 &&
            ` The previous secret is still accepted until ${formatDateTime(secretStatus.retiring[0].retiresAt, facility.timezone)} — paste the new one into the vendor portal before then.`}
        </p>
        {!secretStatus.unavailable && (
          <AdminForm
            action={rotateWebhookSecretAction}
            label="Rotate the webhook signing secret"
            className="flex flex-col gap-2"
          >
            <input type="hidden" name="facilityId" value={facility.id} />
            <div>
              <Button type="submit" variant="outline">
                Rotate signing secret
              </Button>
            </div>
            <p className="text-muted-foreground text-xs text-pretty">
              The new secret is shown once and never again. The old one keeps
              working for 24 hours so a vendor portal can be updated without
              dropping the gate events in flight.
            </p>
          </AdminForm>
        )}
      </section>

      <section
        aria-labelledby="cameras-heading"
        className="flex flex-col gap-3"
      >
        <h2 id="cameras-heading" className="text-base font-medium">
          Cameras
        </h2>
        <p className="text-muted-foreground max-w-prose text-xs text-pretty">
          Labelled links to your camera vendor&apos;s own viewer. We store a
          name and an address and nothing else — no credentials, no video, no
          proxying. Links open in a new tab rather than embedding, because most
          vendor viewers refuse to be framed and a blank box is
          indistinguishable from a dead camera.
        </p>

        {cameras.length === 0 ? (
          <p className="text-muted-foreground text-sm">No camera links yet.</p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {cameras.map((camera) => (
              <li key={camera.id} className="flex flex-wrap items-center gap-3">
                <a
                  href={camera.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-2"
                >
                  {camera.label}
                </a>
                <span className="text-muted-foreground text-xs">
                  {new URL(camera.url).host}
                </span>
                <AdminForm
                  action={removeCameraAction}
                  label={`Remove ${camera.label}`}
                >
                  <input type="hidden" name="cameraId" value={camera.id} />
                  <button
                    type="submit"
                    className="text-xs underline underline-offset-2"
                  >
                    Remove
                  </button>
                </AdminForm>
              </li>
            ))}
          </ul>
        )}

        <AdminForm
          action={addCameraAction}
          label="Add a camera link"
          className="grid gap-3 sm:grid-cols-3"
        >
          <input type="hidden" name="facilityId" value={facility.id} />
          <Field
            name="label"
            label="Name"
            type="text"
            required
            hint="What staff call it: “Front gate”."
          />
          <Field
            name="url"
            label="Viewer address"
            type="url"
            required
            hint="Must start with https:// and contain no username or password."
          />
          <div className="flex items-end">
            <Button type="submit">Add camera</Button>
          </div>
        </AdminForm>
      </section>

      <section
        aria-labelledby="operations-heading"
        className="flex flex-col gap-3"
      >
        <h2 id="operations-heading" className="text-base font-medium">
          Operations policy
        </h2>
        <p className="text-muted-foreground max-w-prose text-xs text-pretty">
          The limits this facility puts on its own staff and tenants. Texas
          practice as shipped — configuration, not law.
        </p>
        <AdminForm
          action={updateOperationsPolicyAction}
          label="Operations policy"
          className="flex flex-wrap items-end gap-3"
        >
          <input type="hidden" name="facilityId" value={facilityId} />
          <Field
            name="authorizedAccessCap"
            label="Named people per lease"
            type="number"
            min={1}
            max={20}
            defaultValue={facility.authorizedAccessCap}
            hint="Besides the tenant themselves."
          />
          <Field
            name="cashApprovalThresholdDollars"
            label="Cash needing a manager, at or above ($)"
            type="text"
            inputMode="decimal"
            defaultValue={(facility.cashApprovalThresholdCents / 100).toFixed(
              2,
            )}
            hint="0.00 means every cash payment needs one."
          />
          <Field
            name="writeOffThresholdDollars"
            label="Write off a leftover balance up to ($)"
            type="text"
            inputMode="decimal"
            defaultValue={(facility.writeOffThresholdCents / 100).toFixed(2)}
            hint="Anything above this needs a manager at move-out."
          />
          <Field
            name="moveOutNoticeDays"
            label="Notice required to move out (days)"
            type="number"
            min={0}
            max={90}
            defaultValue={facility.moveOutNoticeDays}
            hint="0 means none. The portal enforces this; staff can override."
          />
          <Field
            name="reservationHoldGraceDays"
            label="Keep a free hold this long after the move-in date (days)"
            type="number"
            min={0}
            max={30}
            defaultValue={facility.reservationHoldGraceDays}
            hint="1 is the default: the unit is held through the day after the date the renter picked. 0 releases it at the end of the move-in day itself."
          />
          <Field
            name="maxCheckoutStartDaysAhead"
            label="Let a paid checkout schedule a move-in up to (days ahead)"
            type="number"
            min={0}
            max={365}
            defaultValue={facility.maxCheckoutStartDaysAhead}
            hint="0 means same-day only. Separate from the free-hold window above: a paid booking does not tie up a unit for nothing, so it does not need the same short limit."
          />
          <Field
            name="leadFollowUpHours"
            label="Call an inquiry back within"
            type="number"
            min={1}
            max={168}
            defaultValue={facility.leadFollowUpHours}
            hint="Hours. A phone or walk-in inquiry with no disposition after this becomes a task on the morning sweep — US-43's “never silently ageing in new”."
          />
          {/* PRD 10 (B-100). Refer a friend — eight columns, eight controls,
              in the item that adds them. OFF by default: the program pays real
              money on a rule set the attorney pass has not reviewed (§9), so
              an operator turns it on knowingly rather than discovering it is
              already running. */}
          <Field
            name="referralEnabled"
            as="checkbox"
            label="Run the refer-a-friend program at this facility"
            defaultChecked={facility.referralEnabled}
            hint="Off by default. Nothing is minted, attributed or paid while this is off."
          />
          <Field
            name="referralRewardDollars"
            label="Reward the referrer ($)"
            type="text"
            inputMode="decimal"
            defaultValue={(facility.referralRewardCents / 100).toFixed(2)}
            hint="Comes off their next invoice after the referral qualifies."
          />
          <Field
            name="refereeRewardDollars"
            label="Reward the new tenant ($)"
            type="text"
            inputMode="decimal"
            defaultValue={(facility.refereeRewardCents / 100).toFixed(2)}
            hint="Comes off their first invoice. Separate from the referrer's, so “$75 to them, $25 to you” is possible."
          />
          <Field
            name="referralAnnualCap"
            label="Most referrals one tenant can earn (12 months)"
            type="number"
            min={1}
            max={1000}
            defaultValue={facility.referralAnnualCap}
            hint="Bounds what a single farmed account can cost."
          />
          <Field
            name="referralOpenInviteCap"
            label="Unused invites a tenant may hold at once"
            type="number"
            min={1}
            max={100}
            defaultValue={facility.referralOpenInviteCap}
            hint="Minting a hundred codes and posting them is the same attack as one permanent code."
          />
          <Field
            name="referralInviteExpiryDays"
            label="An unused invite expires after (days)"
            type="number"
            min={1}
            max={365}
            defaultValue={facility.referralInviteExpiryDays}
            hint="Gives outstanding exposure a horizon instead of letting it accumulate for the life of the tenancy."
          />
          <Field
            name="referralMinimumStayDays"
            label="Minimum stay before a reward is safe (days)"
            type="number"
            min={0}
            max={365}
            defaultValue={facility.referralMinimumStayDays}
            hint="0 means none. An unapplied reward is cancelled if they leave sooner; one already applied is never clawed back."
          />
          <Field
            name="referralCrossFacility"
            as="checkbox"
            label="Pay a referral when the friend rents at a different location"
            defaultChecked={facility.referralCrossFacility}
            hint="Off by default — referrals are local, and cross-facility is a different economic bet."
          />
          <Field
            name="drawerVarianceThresholdDollars"
            label="Drawer over/short needing a note ($)"
            type="text"
            inputMode="decimal"
            defaultValue={(facility.drawerVarianceThresholdCents / 100).toFixed(
              2,
            )}
            hint="A close-out out by more than this cannot be saved without an explanation. 0.00 means every penny needs one."
          />
          <Field
            name="rateIncreaseNoticeDays"
            label="Notice before a rate increase (days)"
            type="number"
            min={1}
            max={365}
            defaultValue={facility.rateIncreaseNoticeDays}
            hint="The minimum an increase's effective date has to be from the day it is scheduled. 30 is the common lease term — what your state and lease actually require is a question for your attorney."
          />
          {/* PRD 02 US-11 (B-165), D-94. How far a rule-based batch moves an
              existing tenant. Until these existed the answer was "all the way
              to street, in one letter" and nothing could change it. */}
          <Field
            name="ecriPercentStep"
            label="Rate increase step (% of what they pay now)"
            type="text"
            inputMode="decimal"
            defaultValue={(facility.ecriPercentBasisPoints / 100).toFixed(2)}
            hint="A tenant judges an increase against their own rent, not against street. 10% is the common step."
          />
          <Field
            name="ecriMinStepDollars"
            label="Smallest increase worth sending ($)"
            type="text"
            inputMode="decimal"
            defaultValue={(facility.ecriMinStepCents / 100).toFixed(2)}
            hint="A step smaller than this is raised to it. Stops a cheap unit's percentage from being a letter that costs more to post than it collects."
          />
          <Field
            name="ecriMaxStepDollars"
            label="Largest increase in one step ($)"
            type="text"
            inputMode="decimal"
            defaultValue={(facility.ecriMaxStepCents / 100).toFixed(2)}
            hint="The control that actually bounds the letter. A tenant far below street closes the gap over several cycles instead of one."
          />
          <Field
            name="ecriCapAtStreet"
            as="checkbox"
            label="Never raise an existing tenant above the street rate"
            defaultChecked={facility.ecriCapAtStreet}
            hint="On by default. Charging a sitting tenant more than a walk-in would pay today is not defensible on a retention call."
          />
          <Field
            name="ecriMinMonthsSinceChange"
            label="Months since their last rate change (minimum)"
            type="number"
            min={1}
            max={60}
            defaultValue={facility.ecriMinMonthsSinceChange}
            hint="How long a lease must sit untouched before the rule will pick it."
          />
          <Field
            name="ecriMinGapDollars"
            label="Minimum gap to street before raising ($)"
            type="text"
            inputMode="decimal"
            defaultValue={(facility.ecriMinGapCents / 100).toFixed(2)}
            hint="A lease already close to street has nothing worth raising."
          />
          <Field
            name="abandonmentFollowUpHours"
            label="Email a checkout that stalls, at these hours"
            defaultValue={facility.abandonmentFollowUpHours.join(", ")}
            hint="Exactly three, increasing — hours after checkout starts. Only sends with marketing consent, and stops the moment the booking completes."
          />
          <Button type="submit">Save operations policy</Button>
        </AdminForm>
      </section>

      <section
        aria-labelledby="protection-heading"
        className="flex flex-col gap-3"
      >
        <h2 id="protection-heading" className="text-base font-medium">
          Protection plans
        </h2>
        <p className="text-muted-foreground text-xs text-pretty">
          What we sell is a <strong>protection plan</strong>, not insurance —
          &ldquo;insurance&rdquo; describes cover a tenant already holds
          elsewhere (PRD 02 US-44). Tiers are effective-dated: changing a
          premium adds a new row and never repricing an existing lease.
        </p>

        <AdminForm
          action={setProtectionPolicyAction}
          label="Protection policy"
          className="flex flex-wrap items-end gap-3"
        >
          <input type="hidden" name="facilityId" value={facilityId} />
          <Field
            name="protectionRequired"
            label="Policy at this facility"
            as="select"
            defaultValue={facility.protectionRequired ? "yes" : "no"}
          >
            <option value="yes">
              Required — a plan, or proof of the tenant&apos;s own cover
            </option>
            <option value="no">Optional</option>
          </Field>
          {/* D-17. Off by default and deliberately worded as what it does to
              the tenant's bill, not as a toggle name. */}
          <Field
            name="autoEnrolProtectionOnLapse"
            label="When a tenant's proof of insurance lapses"
            as="select"
            defaultValue={facility.autoEnrolProtectionOnLapse ? "yes" : "no"}
          >
            <option value="no">Raise a staff task — charge nothing</option>
            <option value="yes">
              Enrol the lease in the default tier and charge for it
            </option>
          </Field>
          <Field
            name="defaultProtectionTier"
            label="Tier a lapsed proof enrols into"
            as="select"
            defaultValue={facility.defaultProtectionTier ?? ""}
          >
            <option value="">None chosen</option>
            {plans.map((plan) => (
              <option key={plan.tier} value={plan.tier}>
                {plan.name} — {formatCents(plan.premiumCents)}/mo
              </option>
            ))}
          </Field>
          <Button type="submit">Save policy</Button>
        </AdminForm>
        <p className="text-muted-foreground max-w-prose text-xs text-pretty">
          Enrolling on lapse charges a tenant for cover their lease may not have
          explicitly agreed to. It is off until someone turns it on, per
          facility, and the wording of the notice and the lease clause behind it
          need a lawyer&apos;s eyes before it runs against a real tenant. Either
          way the tenant is notified, and the lapse raises a task for staff.
        </p>

        {plans.length > 0 && (
          <ScrollRegion aria-label="Protection plans">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-muted-foreground">
                  <th scope="col" className="pb-1 font-normal">
                    Tier
                  </th>
                  <th scope="col" className="pb-1 font-normal">
                    Covers up to
                  </th>
                  <th scope="col" className="pb-1 font-normal">
                    Premium
                  </th>
                </tr>
              </thead>
              <tbody>
                {plans.map((plan) => (
                  <tr key={plan.tier}>
                    <th scope="row" className="py-1 text-left font-normal">
                      {plan.name}{" "}
                      <span className="text-muted-foreground">
                        ({plan.tier})
                      </span>
                    </th>
                    <td className="py-1">{formatCents(plan.coverageCents)}</td>
                    <td className="py-1">
                      {formatCents(plan.premiumCents)}/mo
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollRegion>
        )}

        <AdminForm
          action={addProtectionPlanAction}
          label="Add a protection tier"
          className="flex flex-wrap items-end gap-3"
        >
          <input type="hidden" name="facilityId" value={facilityId} />
          <Field
            name="tier"
            label="Tier key"
            placeholder="standard"
            required
            hint="Lowercase, never changes."
          />
          <Field
            name="name"
            label="Name customers see"
            placeholder="$3,000 cover"
            required
          />
          <Field
            name="coverageDollars"
            label="Covers up to ($)"
            type="number"
            step="1"
            min="0"
            required
            className="flex w-36 flex-col gap-1 text-sm"
          />
          <Field
            name="premiumDollars"
            label="Premium ($/mo)"
            type="number"
            step="0.01"
            min="0"
            required
            className="flex w-32 flex-col gap-1 text-sm"
          />
          <Field
            name="effectiveFrom"
            label="Effective from"
            type="date"
            defaultValue={todayIso()}
            required
          />
          <Button type="submit">Add tier</Button>
        </AdminForm>
      </section>
    </div>
  );
}
