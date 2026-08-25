import Link from "next/link";
import { getAdminActor } from "@/lib/admin/context";
import { previewMoveOut } from "@/lib/admin/move-out";
import { formatCents, formatDay } from "@/lib/format";
import { AdminForm, Field } from "@/components/admin/form";
import { REASON_CODES } from "@storage/core/audit";
import { completeMoveOutAction } from "./actions";
import { ChargeFeeForm } from "@/components/admin/charge-fee-form";
import { chargeableFees } from "@/lib/billing/charges";
import { can } from "@/lib/rbac/authorize";

export const metadata = { title: "Move out" };

// PRD 02 US-14 (move-out). The figure staff confirm is the figure that posts:
// the settlement is previewed from the same function the action re-runs, so
// there is no second calculation to drift.

const FIELD_CLASS = "flex flex-col gap-1 text-sm";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export default async function MoveOutPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantId: string }>;
  searchParams: Promise<{ lease?: string; date?: string }>;
}) {
  const { tenantId } = await params;
  const { lease: leaseId, date } = await searchParams;
  const actor = await getAdminActor();

  if (!leaseId) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-lg font-semibold">Move out</h1>
        <p className="text-sm">
          Choose a unit from the tenant&apos;s profile to move out.
        </p>
        <Link
          href={`/admin/tenants/${tenantId}`}
          className="text-sm underline underline-offset-2"
        >
          ← Back to the profile
        </Link>
      </div>
    );
  }

  let preview = await previewMoveOut(
    actor,
    leaseId,
    new Date(`${date ?? todayIso()}T00:00:00.000Z`),
  );

  // No explicit date in the URL yet: default to what the tenant already
  // requested (B-041), if anything, rather than today — the whole point of a
  // portal request is that staff see it pre-filled, not a blank form that
  // happens to ignore what the tenant already told them.
  if (!date && preview.requestedMoveOutDate) {
    preview = await previewMoveOut(
      actor,
      leaseId,
      preview.requestedMoveOutDate,
    );
  }
  const moveOutDate =
    date ??
    (preview.requestedMoveOutDate
      ? isoDate(preview.requestedMoveOutDate)
      : todayIso());
  const { settlement } = preview;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href={`/admin/tenants/${tenantId}`}
          className="text-sm underline underline-offset-2"
        >
          ← Back to the profile
        </Link>
        <h1 className="mt-1 text-lg font-semibold">
          Move out — {preview.tenantName}, unit {preview.unitNumber}
        </h1>
      </div>

      {preview.requestedMoveOutDate && (
        <p
          role="status"
          className="border-input rounded-md border p-3 text-sm text-pretty"
        >
          The tenant requested this move-out from their account. Verify the unit
          is empty and clean, then finalize below.
        </p>
      )}

      {/* B-167. The charge control ON the move-out screen, which is where a
          cleaning or damage fee is actually discovered — somebody has just
          walked the unit. Above the Complete button rather than below it: post
          the fee first and the settlement below re-reads with it in, which is
          the whole reason it is on this screen and not only on the profile.
          Charging after completing still works; it just means the tenant gets a
          second statement.

          B-173 moved it ABOVE the date picker rather than below the figures,
          because the committing form now starts at the picker and a <form>
          cannot be nested inside another one. What B-167 wanted is unchanged:
          it is still above the settlement, so posting a fee and reloading shows
          it in the figures underneath. */}
      {can(actor, "fees:charge", preview.facilityId) && (
        <details className="border-input rounded-lg border p-4">
          <summary className="cursor-pointer text-sm font-medium">
            Charge a fee for this unit
          </summary>
          <p className="text-muted-foreground mt-2 mb-3 max-w-prose text-xs text-pretty">
            Cleaning, damage, a cut lock. Posts as its own invoice and lands in
            the settlement below — reload the page after charging to see it in
            the figures.
          </p>
          <ChargeFeeForm
            tenantId={tenantId}
            leaseId={leaseId}
            fees={await chargeableFees(preview.facilityId)}
            unitLabel={`unit ${preview.unitNumber}`}
          />
        </details>
      )}

      {/* B-173. One form, one truth.

          The date used to sit in its own `method="GET"` form whose only submit
          was "Recalculate", while this form carried a hidden `moveOutDate` built
          from the URL — so changing Sep 1 to Sep 5 and pressing Complete
          move-out closed the lease on Sep 1, silently, after showing the tenant
          a Sep 5 settlement. Nothing on the screen said the picker was inert
          until a second button was pressed: a 3.3.4 failure on a screen that
          ends a tenancy.

          The picker is a field OF the committing form now, so what posts is what
          is on screen, and `stalePreview` refuses while the picker and the
          priced date disagree — without that half the defect only mirrors, and
          commits a date the figures above were never worked out for.
          "Recalculate" is a native GET submit of this same form: a submit button
          whose `formAction` is a STRING is the one case React hands back to the
          browser, so there is still exactly one date control on the page.

          The form starts here, above the figures, because everything below the
          picker is priced from it. `max-w-lg` moved to the tail group so the
          settlement keeps its full width. */}
      <AdminForm
        action={completeMoveOutAction}
        label="Complete move-out"
        className="flex flex-col gap-6"
      >
        <input type="hidden" name="tenantId" value={tenantId} />
        <input type="hidden" name="leaseId" value={leaseId} />
        <input type="hidden" name="lease" value={leaseId} />
        <input type="hidden" name="previewed_date" value={moveOutDate} />

        <div className="flex flex-wrap items-end gap-2">
          <Field
            name="date"
            label="Move-out date"
            type="date"
            defaultValue={moveOutDate}
            className={FIELD_CLASS}
          />
          <button
            type="submit"
            formMethod="get"
            formAction={`/admin/tenants/${tenantId}/move-out`}
            className="border-input hover:bg-accent inline-flex min-h-11 items-center rounded-md border px-4 text-sm font-medium"
          >
            Recalculate
          </button>
        </div>

      {preview.noticeShortfallDays > 0 && (
        <p
          role="status"
          className="border-input rounded-md border p-3 text-sm text-pretty"
        >
          This is {preview.noticeShortfallDays} day
          {preview.noticeShortfallDays === 1 ? "" : "s"} short of the notice the
          lease asks for. Recorded, not blocked — the lease&apos;s remedy is a
          charge, not a refusal.
        </p>
      )}

      <dl className="border-input flex flex-col gap-2 rounded-lg border p-4 text-sm">
        <div className="flex justify-between gap-4">
          <dt>Balance today</dt>
          <dd className="tabular-nums">{formatCents(preview.balanceCents)}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt>
            Proration credit
            {!preview.prorateOnMoveOut && (
              <span className="text-muted-foreground">
                {" "}
                — this facility does not prorate
              </span>
            )}
          </dt>
          <dd className="tabular-nums">
            −{formatCents(settlement.prorationCreditCents)}
          </dd>
        </div>
        {preview.ruledRecaptureCents > 0 && (
          <div className="flex justify-between gap-4">
            <dt>
              Promotional discount recovered
              <span className="text-muted-foreground block text-pretty">
                {preview.recapture.reason}
              </span>
              {/* B-168. Its own settleable line, not a share of a residual:
                  it posts as its own invoice, so it can be paid, chased,
                  disputed and waived on its own after the tenant has gone. */}
              <span className="text-muted-foreground block text-pretty">
                Charged as its own invoice, so it can be paid or waived on its
                own.
              </span>
            </dt>
            <dd className="tabular-nums">
              {formatCents(settlement.recaptureCents)}
            </dd>
          </div>
        )}
        <div className="flex justify-between gap-4 border-t pt-2 font-medium">
          <dt>
            {settlement.refundDueCents > 0
              ? "Refund due to tenant"
              : settlement.amountDueCents > 0
                ? "Still owed by tenant"
                : "Settled in full"}
          </dt>
          <dd className="tabular-nums">
            {formatCents(
              settlement.refundDueCents || settlement.amountDueCents,
            )}
          </dd>
        </div>
      </dl>

      {settlement.needsManagerOverride && (
        <p
          role="alert"
          className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-pretty text-red-900"
        >
          This lease owes more than the{" "}
          {formatCents(preview.writeOffThresholdCents)} write-off threshold. A
          manager has to close it.
        </p>
      )}

        <div className="flex max-w-lg flex-col gap-3">
        <Field
          name="reason"
          label="Reason"
          as="select"
          defaultValue="tenant_request"
          className={FIELD_CLASS}
        >
          <option value="tenant_request">Tenant moved out</option>
          <option value="abandonment">
            Abandoned — dated to last occupancy evidence
          </option>
        </Field>

        {/* B-168. Reducing the recapture is its own lever, separate from the
            write-off below, and that separation IS the fix: `writeOff` is all
            or nothing across the entire residual, so forgiving a disputed $60
            recapture also forgave $400 of genuine arrears under one reason
            code. What is forgiven here is measured against the fee-waiver
            limit, so a counter staffer cannot quietly give the term away. */}
        {preview.ruledRecaptureCents > 0 && (
          <fieldset className="border-input flex flex-col gap-3 rounded-lg border p-4">
            <legend className="px-1 text-sm font-medium">
              Promotional recapture
            </legend>
            <p className="text-muted-foreground max-w-prose text-xs text-pretty">
              The promotion&apos;s minimum stay entitles this facility to{" "}
              {formatCents(preview.ruledRecaptureCents)}. Leave the amount alone
              to charge it. Charging less forgives the difference, needs a
              reason, and counts against your fee-waiver limit.
            </p>
            <Field
              name="recaptureChargeDollars"
              label="Charge instead ($)"
              inputMode="decimal"
              defaultValue={(preview.ruledRecaptureCents / 100).toFixed(2)}
              className={FIELD_CLASS}
              hint="Enter 0 to waive it in full."
            />
            <Field
              name="recaptureReason"
              label="Why it is being reduced"
              as="select"
              defaultValue=""
              className={FIELD_CLASS}
            >
              <option value="">Not being reduced</option>
              {REASON_CODES.map((code) => (
                <option key={code} value={code}>
                  {code.replace(/_/g, " ")}
                </option>
              ))}
            </Field>
          </fieldset>
        )}

        {settlement.canWriteOff && (
          <>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                name="writeOff"
                value="yes"
                className="mt-1"
              />
              <span>
                Write off the remaining {formatCents(settlement.amountDueCents)}{" "}
                and close the account
              </span>
            </label>
            <Field
              name="reasonCode"
              label="Write-off reason"
              as="select"
              className={FIELD_CLASS}
            >
              {REASON_CODES.map((code) => (
                <option key={code} value={code}>
                  {code.replace(/_/g, " ")}
                </option>
              ))}
            </Field>
          </>
        )}

        <p className="text-muted-foreground text-sm text-pretty">
          The unit goes to maintenance, not straight back on sale. Someone has
          to confirm it is empty and clean before it can be rented again.
        </p>

        {/* B-173. The button restates the day it is about to act on, so the
            date is in its own accessible name rather than only in a control the
            reader passed several fields ago. */}
        <button
          type="submit"
          className="bg-primary text-primary-foreground inline-flex min-h-11 items-center justify-center self-start rounded-md px-4 text-sm font-medium"
        >
          Complete move-out on {formatDay(moveOutDate)}
        </button>
        </div>
      </AdminForm>
    </div>
  );
}
