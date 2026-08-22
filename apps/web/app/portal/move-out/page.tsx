import Link from "next/link";
import { requireTenantActor } from "@/lib/rbac/session";
import {
  previewTenantMoveOut,
  tenantMoveOutLeases,
} from "@/lib/portal/move-out";
import { formatRate } from "@/lib/format";
import { AdminForm } from "@/components/admin/form";
import { cancelMoveOutAction, requestMoveOutAction } from "./actions";

export const metadata = { title: "Request a move-out" };

// PRD 01 US-707. Pick a unit → pick a date → see what it settles to →
// confirm. Nothing here finalizes anything — that is still entirely B-040's,
// gated behind a human actually checking the unit is empty.

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
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
              <Link
                href={`/portal/move-out?lease=${lease.leaseId}`}
                className="border-input hover:bg-accent inline-flex min-h-11 items-center rounded-md border px-4 text-sm font-medium"
              >
                {lease.facilityName} — Unit {lease.unitNumber}
              </Link>
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

      <form method="GET" className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="lease" value={lease.leaseId} />
        <label htmlFor="date" className="flex flex-col gap-1 text-sm">
          Move-out date
          <input
            id="date"
            name="date"
            type="date"
            min={isoDate(lease.minMoveOutDate)}
            defaultValue={isoDate(requestedDate)}
            className="border-input bg-background h-9 rounded-md border px-2"
          />
        </label>
        <button
          type="submit"
          className="border-input hover:bg-accent inline-flex h-9 items-center rounded-md border px-4 text-sm font-medium"
        >
          Update
        </button>
      </form>

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

      <AdminForm
        action={requestMoveOutAction}
        label="Request a move-out"
        className="flex flex-col gap-3"
      >
        <input type="hidden" name="leaseId" value={lease.leaseId} />
        <input
          type="hidden"
          name="moveOutDate"
          value={isoDate(requestedDate)}
        />
        <p className="text-muted-foreground text-sm text-pretty">
          Your gate code and account stay active until{" "}
          {formatDate(requestedDate)}. Our team will verify the unit is empty
          before your account is finally closed.
        </p>
        <button
          type="submit"
          className="bg-primary text-primary-foreground inline-flex min-h-11 items-center justify-center self-start rounded-md px-4 text-sm font-medium"
        >
          Request this move-out
        </button>
      </AdminForm>
    </div>
  );
}
