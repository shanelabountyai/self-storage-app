import Link from "next/link";
import { requireTenantActor } from "@/lib/rbac/session";
import {
  lienMoveOutRefusal,
  MAX_MOVE_OUT_DAYS_AHEAD,
  PORTAL_MOVE_OUT_PROBLEM_COPY,
  previewTenantMoveOut,
  tenantMoveOutLeases,
} from "@/lib/portal/move-out";
import { formatRate } from "@/lib/format";
import { AdminForm, Field } from "@/components/admin/form";
import { CallLink, phoneFor } from "@/components/marketing/call-link";
import { cancelMoveOutAction, requestMoveOutAction } from "./actions";

export const metadata = { title: "Request a move-out" };

// PRD 01 US-707. Pick a unit → pick a date → see what it settles to →
// confirm. Nothing here finalizes anything — that is still entirely B-040's,
// gated behind a human actually checking the unit is empty.

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// B-174. UTC day math, matching the server-side ceiling in `moveOutDateProblem`
// — not local-time `setDate`, which can drift a day off a UTC boundary
// depending on the server's own timezone. The same shape `portal/transfer`'s
// `maxDateIso` already uses for its own ceiling.
function maxMoveOutDate(): Date {
  const today = new Date();
  const startOfTodayUtc = Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate(),
  );
  return new Date(
    startOfTodayUtc + MAX_MOVE_OUT_DAYS_AHEAD * 24 * 60 * 60 * 1000,
  );
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

export default async function PortalMoveOutPage({
  searchParams,
}: {
  searchParams: Promise<{ lease?: string; date?: string }>;
}) {
  const { lease: leaseId, date } = await searchParams;
  const actor = await requireTenantActor();
  const leases = await tenantMoveOutLeases(actor.tenantId);

  if (leases.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-xl font-semibold">Request a move-out</h1>
        <p className="text-sm text-pretty">
          We don&apos;t see an active unit on this account.
        </p>
        <Link href="/portal" className="text-sm underline underline-offset-4">
          Back to my account
        </Link>
      </div>
    );
  }

  const selectedId =
    leaseId ?? (leases.length === 1 ? leases[0].leaseId : undefined);

  if (!selectedId) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-xl font-semibold">Request a move-out</h1>
        <p className="text-sm">Which unit?</p>
        <ul className="flex flex-col gap-2">
          {leases.map((lease) => (
            <li key={lease.leaseId}>
              {/* B-164 / D-85. A lien-pipeline unit is LISTED and not
                  actionable, rather than hidden: hiding it tells a tenant with
                  one unit that we see no unit on their account, which is false
                  and a dead end. The reason is stated in text rather than shown
                  as a control that silently refuses (3.3.1 A), and nothing here
                  depends on colour (1.4.1 A). */}
              {lease.schedulable ? (
                <Link
                  href={`/portal/move-out?lease=${lease.leaseId}`}
                  className="border-input hover:bg-accent inline-flex min-h-11 items-center rounded-md border px-4 text-sm font-medium"
                >
                  {lease.facilityName} — Unit {lease.unitNumber}
                </Link>
              ) : (
                <p className="text-muted-foreground text-sm text-pretty">
                  {lease.facilityName} — {lienMoveOutRefusal(lease.unitNumber)}{" "}
                  <CallLink
                    phone={phoneFor(lease.facilityPhone || null)}
                    className="underline underline-offset-4"
                  />
                </p>
              )}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  const lease = leases.find((l) => l.leaseId === selectedId);
  if (!lease) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-xl font-semibold">Request a move-out</h1>
        <p className="text-sm text-pretty">
          We couldn&apos;t find that unit on your account.
        </p>
        <Link
          href="/portal/move-out"
          className="text-sm underline underline-offset-4"
        >
          Choose a unit
        </Link>
      </div>
    );
  }

  // In the lien pipeline (B-164, D-85): no date picker, no preview, no
  // confirm. The office is the only route and saying so is the whole screen.
  //
  // `role="alert"` and mounted WITH the page rather than inserted on submit
  // (4.1.3 AA): a tenant who navigated here expecting a form is told at once,
  // by a screen reader as well as by eye, instead of tabbing through a page
  // whose only content is a refusal they have not been read yet.
  if (!lease.schedulable) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-xl font-semibold">Request a move-out</h1>
        <p
          role="alert"
          className="border-input rounded-lg border p-4 text-sm text-pretty"
        >
          {lienMoveOutRefusal(lease.unitNumber)}{" "}
          <CallLink
            phone={phoneFor(lease.facilityPhone || null)}
            className="underline underline-offset-4"
          />
          .
        </p>
        <Link href="/portal" className="text-sm underline underline-offset-4">
          Back to my account
        </Link>
      </div>
    );
  }

  // Already requested: show the scheduled state and a cancel button, not the
  // date picker again.
  if (lease.pendingMoveOutDate) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-xl font-semibold">Move-out scheduled</h1>
        <p className="text-sm text-pretty">
          Unit {lease.unitNumber} at {lease.facilityName} is scheduled to move
          out on <strong>{formatDate(lease.pendingMoveOutDate)}</strong>. Your
          gate code keeps working and your account stays active until then. Our
          team will verify the unit and finish closing your account after that
          date.
        </p>
        <AdminForm action={cancelMoveOutAction} label="Cancel move-out">
          <input type="hidden" name="leaseId" value={lease.leaseId} />
          <button
            type="submit"
            className="border-input hover:bg-accent inline-flex min-h-11 items-center rounded-md border px-4 text-sm font-medium"
          >
            Cancel this move-out
          </button>
        </AdminForm>
        <Link href="/portal" className="text-sm underline underline-offset-4">
          Back to my account
        </Link>
      </div>
    );
  }

  const requestedDate = date
    ? new Date(`${date}T00:00:00.000Z`)
    : lease.minMoveOutDate;
  const previewResult = await previewTenantMoveOut(
    actor.tenantId,
    lease.leaseId,
    requestedDate,
  );
  const preview = previewResult.ok ? previewResult.preview : null;
  // B-174. B-142 fixed exactly this on the sibling transfer screen and the fix
  // never crossed one file: the refused branch was dropped on the floor, so the
  // page rendered a blank where the figures had been and stayed otherwise
  // identical to before the request — indistinguishable from a broken picker
  // (3.3.1).
  const previewProblem = previewResult.ok ? null : previewResult.reason;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href="/portal/move-out"
          className="text-sm underline underline-offset-4"
        >
          ← Choose a different unit
        </Link>
        <h1 className="mt-1 text-xl font-semibold">
          Request a move-out — Unit {lease.unitNumber}, {lease.facilityName}
        </h1>
      </div>

      {lease.moveOutNoticeDays > 0 && (
        <p className="text-muted-foreground text-sm text-pretty">
          This unit needs at least {lease.moveOutNoticeDays} day
          {lease.moveOutNoticeDays === 1 ? "" : "s"} notice, so the earliest
          date you can pick is {formatDate(lease.minMoveOutDate)}.
        </p>
      )}

      {/* B-173. One form, one truth.

          The picker used to sit in its own `method="GET"` form whose only submit
          was "Update", while the request form below carried a hidden
          `moveOutDate` built from the URL — so changing the date and pressing
          Request this move-out asked for the OLD one, after showing the tenant
          what the new one settles to. Nothing said the picker was inert until a
          second button was pressed.

          It is a field of the requesting form now, so what posts is what is on
          screen, and `stalePreview` refuses while the picker and the priced date
          disagree — without that half the defect only mirrors, and asks for a
          date the figures above were never worked out for. "Update" is a native
          GET submit of this same form: a submit button whose `formAction` is a
          STRING is the one case React hands back to the browser, so there is
          still exactly one date control on the page. */}
      <AdminForm
        action={requestMoveOutAction}
        label="Request a move-out"
        className="flex flex-col gap-6"
      >
        <input type="hidden" name="leaseId" value={lease.leaseId} />
        <input type="hidden" name="lease" value={lease.leaseId} />
        <input
          type="hidden"
          name="previewed_date"
          value={isoDate(requestedDate)}
        />

        <div className="flex flex-wrap items-end gap-2">
          <Field
            name="date"
            label="Move-out date"
            type="date"
            min={isoDate(lease.minMoveOutDate)}
            max={isoDate(maxMoveOutDate())}
            defaultValue={isoDate(requestedDate)}
          />
          <button
            type="submit"
            formMethod="get"
            formAction="/portal/move-out"
            className="border-input hover:bg-accent inline-flex min-h-11 items-center rounded-md border px-4 text-sm font-medium"
          >
            Update
          </button>
        </div>

      {previewProblem && (
        <p
          role="alert"
          className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-pretty text-red-900"
        >
          {PORTAL_MOVE_OUT_PROBLEM_COPY[previewProblem]}
        </p>
      )}

      {preview && (
        <dl className="border-input flex flex-col gap-2 rounded-lg border p-4 text-sm">
          <div className="flex justify-between gap-4">
            <dt>Current balance</dt>
            <dd className="tabular-nums">
              {preview.balanceCents < 0
                ? `${formatRate(-preview.balanceCents)} in credit`
                : formatRate(preview.balanceCents)}
            </dd>
          </div>
          {preview.settlement.prorationCreditCents > 0 && (
            <div className="flex justify-between gap-4">
              <dt>Credit for unused days</dt>
              <dd className="tabular-nums">
                −{formatRate(preview.settlement.prorationCreditCents)}
              </dd>
            </div>
          )}
          {preview.settlement.recaptureCents > 0 && (
            <div className="flex justify-between gap-4">
              <dt>
                Promotional discount recovered
                {/* B-145. The reason, on the screen the tenant agrees on — not
                    on the invoice afterwards. A charge whose first appearance
                    is a final statement is a chargeback. */}
                <span className="text-muted-foreground block text-pretty">
                  {preview.recapture.reason}
                </span>
              </dt>
              <dd className="tabular-nums">
                {formatRate(preview.settlement.recaptureCents)}
              </dd>
            </div>
          )}
          <div className="flex justify-between gap-4 border-t pt-2 font-medium">
            <dt>
              {preview.settlement.refundDueCents > 0
                ? "Refund you should expect"
                : preview.settlement.amountDueCents > 0
                  ? "You will still owe"
                  : "Settled in full"}
            </dt>
            <dd className="tabular-nums">
              {formatRate(
                preview.settlement.refundDueCents ||
                  preview.settlement.amountDueCents,
              )}
            </dd>
          </div>
        </dl>
      )}

        {/* B-174. Hidden rather than disabled when there is nothing priced
            behind it. A disabled button is not focusable and announces nothing,
            so a keyboard or screen-reader user meets silence where a sighted
            one at least sees something greyed out; the `role="alert"` above
            already says why there are no figures. The sentence goes with it —
            it promises a date the server has just refused. */}
        {preview && (
          <>
            <p className="text-muted-foreground text-sm text-pretty">
              Your gate code and account stay active until{" "}
              {formatDate(requestedDate)}. Our team will verify the unit is
              empty before your account is finally closed.
            </p>
            <button
              type="submit"
              className="bg-primary text-primary-foreground inline-flex min-h-11 items-center justify-center self-start rounded-md px-4 text-sm font-medium"
            >
              Request a move-out on {formatDate(requestedDate)}
            </button>
          </>
        )}
      </AdminForm>
    </div>
  );
}
