import { AdminForm, Field } from "@/components/admin/form";
import { Button } from "@/components/ui/button";
import { getSwitcherData } from "@/lib/admin/context";
import { resolveSelectedFacility } from "@/lib/admin/facility-selection-logic";
import { hasPermissionAnywhere } from "@/lib/rbac/authorize";
import { promotionsFor } from "@/lib/admin/promotions";
import { formatCents } from "@/lib/format";
import {
  addCodeAction,
  createPromotionAction,
  setStatusAction,
} from "./actions";

export const metadata = { title: "Promotions" };

// PRD 02 US-10 / PRD 04 §3.6 (B-070). Promotions an operator can run without a
// deploy — which is the whole point, since a price that needs an engineer is a
// price that never changes.

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft — not visible to anyone",
  active: "Live",
  paused: "Paused — hidden, redemptions kept",
  ended: "Ended",
};

function formatDate(value: Date | null): string {
  return value
    ? new Intl.DateTimeFormat("en-US", {
        dateStyle: "medium",
        timeZone: "UTC",
      }).format(value)
    : "—";
}

export default async function PromotionsPage() {
  const { actor, facilities, cookieValue, canSeeAll } = await getSwitcherData();
  const selected = resolveSelectedFacility(cookieValue, facilities, canSeeAll);

  if (selected.mode !== "single") {
    return (
      <p className="text-muted-foreground text-sm">
        Pick a specific facility above — a promotion is created against one
        site.
      </p>
    );
  }
  if (!hasPermissionAnywhere(actor, ["facility:settings"])) {
    return (
      <p className="text-muted-foreground text-sm">
        You don&apos;t have access to promotions.
      </p>
    );
  }

  const facilityId = selected.facility.id;
  const promotions = await promotionsFor(actor, facilityId);

  return (
    <div className="flex max-w-4xl flex-col gap-8">
      <div>
        <h1 className="text-lg font-semibold">
          Promotions — {selected.facility.name}
        </h1>
        <p className="text-muted-foreground mt-1 max-w-prose text-sm text-pretty">
          A discount shown on unit cards and carried through checkout. New
          promotions are created as drafts — nothing reaches a customer until
          you activate it.
        </p>
      </div>

      <ul className="flex flex-col gap-4">
        {promotions.map((promotion) => (
          <li
            key={promotion.id}
            className="border-input flex flex-col gap-3 rounded-lg border p-4"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span>
                <span className="font-medium">{promotion.name}</span>
                {/* Never colour alone (WCAG 1.4.1) — the status is words. */}
                <span className="text-muted-foreground">
                  {" "}
                  · {STATUS_LABELS[promotion.status]}
                </span>
              </span>
              <span className="text-muted-foreground text-sm">
                {promotion.redemptionCount}
                {promotion.maxRedemptions !== null
                  ? ` of ${promotion.maxRedemptions}`
                  : ""}{" "}
                redeemed
                {promotion.discountedCents > 0 &&
                  ` · ${formatCents(promotion.discountedCents)} given away`}
              </span>
            </div>

            <p className="text-sm">{promotion.terms}</p>
            <p className="text-muted-foreground text-xs">
              {promotion.displayMode === "code"
                ? "Needs a code"
                : "Shown automatically"}
              {promotion.newTenantOnly && " · new customers only"}
              {promotion.minStayMonths > 0 &&
                ` · ${promotion.minStayMonths}-month minimum stay`}
              {` · ${formatDate(promotion.startsAt)} to ${formatDate(promotion.endsAt)}`}
            </p>

            {promotion.codes.length > 0 && (
              <ul className="flex flex-wrap gap-2">
                {promotion.codes.map((code) => (
                  <li
                    key={code.id}
                    className="border-input rounded-md border px-2 py-1 text-xs"
                  >
                    <span className="font-mono uppercase">{code.code}</span>
                    <span className="text-muted-foreground">
                      {" "}
                      · {code.usesCount}
                      {code.maxUses !== null ? `/${code.maxUses}` : ""} used
                      {code.expiresAt
                        ? ` · to ${formatDate(code.expiresAt)}`
                        : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            <div className="flex flex-wrap gap-2">
              {(["active", "paused", "ended"] as const)
                .filter((status) => status !== promotion.status)
                .map((status) => (
                  <AdminForm
                    key={status}
                    action={setStatusAction}
                    label={`${status} ${promotion.name}`}
                  >
                    <input type="hidden" name="facilityId" value={facilityId} />
                    <input
                      type="hidden"
                      name="promotionId"
                      value={promotion.id}
                    />
                    <input type="hidden" name="status" value={status} />
                    <Button type="submit" variant="outline">
                      {status === "active"
                        ? "Make live"
                        : status === "paused"
                          ? "Pause"
                          : "End"}
                    </Button>
                  </AdminForm>
                ))}
            </div>

            {promotion.displayMode === "code" && (
              <AdminForm
                action={addCodeAction}
                label={`Add a code to ${promotion.name}`}
                className="border-input flex flex-wrap items-end gap-2 border-t pt-3"
              >
                <input type="hidden" name="facilityId" value={facilityId} />
                <input type="hidden" name="promotionId" value={promotion.id} />
                <Field
                  name="code"
                  label="Code"
                  hint="Leave empty for a random one."
                  className="min-w-40"
                />
                <Field
                  name="maxUses"
                  label="Max uses"
                  type="number"
                  min={1}
                  className="w-28"
                />
                <Field
                  name="expiresAt"
                  label="Expires"
                  type="date"
                  className="w-44"
                />
                <Button type="submit" variant="outline">
                  Add code
                </Button>
              </AdminForm>
            )}
          </li>
        ))}
        {promotions.length === 0 && (
          <li className="text-muted-foreground text-sm">No promotions yet.</li>
        )}
      </ul>

      <AdminForm
        action={createPromotionAction}
        label="New promotion"
        className="border-input flex flex-col gap-3 rounded-lg border p-4"
      >
        <h2 className="font-medium">New promotion</h2>
        <input type="hidden" name="facilityId" value={facilityId} />

        <Field
          name="name"
          label="Name"
          hint="What staff will call it. Customers see the terms below."
        />

        <div className="grid gap-3 sm:grid-cols-3">
          <Field
            name="type"
            label="Type"
            as="select"
            defaultValue="percent_off"
          >
            <option value="percent_off">Percent off</option>
            <option value="amount_off">Amount off</option>
            <option value="free_months">Free months</option>
          </Field>
          <Field
            name="value"
            label="Value"
            type="number"
            min={0}
            defaultValue="50"
            hint="Percent, or dollars for amount off. Ignored for free months."
          />
          <Field
            name="durationPeriods"
            label="Months it covers"
            type="number"
            min={1}
            defaultValue="1"
          />
        </div>

        {/* B-144. Without this the column existed and nothing could set it, so
            "first month free with a six-month minimum" could not be expressed
            at all — the operator gave the month away unconditionally or did not
            run the promotion. */}
        <Field
          name="minStayMonths"
          label="Minimum stay"
          type="number"
          min={0}
          max={24}
          defaultValue="0"
          className="sm:w-64"
          hint="Months the tenant must keep the unit to keep this offer. 0 for no minimum. It is stated on the lease and in checkout."
        />

        <div className="grid gap-3 sm:grid-cols-3">
          <Field
            name="displayMode"
            label="How it applies"
            as="select"
            defaultValue="auto"
          >
            <option value="auto">Automatically, shown on the page</option>
            <option value="code">Only with a code</option>
          </Field>
          <Field name="startsAt" label="Starts" type="date" />
          <Field name="endsAt" label="Ends" type="date" />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            name="maxRedemptions"
            label="Total redemptions"
            type="number"
            min={1}
            hint="Empty means no cap. Enforced exactly, even under a rush."
          />
          <label className="flex items-center gap-2 self-end text-sm">
            <input type="checkbox" name="newTenantOnly" className="size-4" />
            New customers only
          </label>
        </div>

        <Field
          name="termsText"
          label="Terms shown to customers"
          hint="Leave empty and one is written from the settings above — which cannot then disagree with what the invoice does."
        />

        <Button type="submit" className="self-start">
          Create as draft
        </Button>
      </AdminForm>
    </div>
  );
}
