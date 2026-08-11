import type { Metadata } from 'next'
import { AdminForm, Field } from '@/components/admin/form'
import { requireTenantActor } from '@/lib/rbac/session'
import { protectionForTenant } from '@/lib/protection/changes'
import { formatRate } from '@/lib/format'
import {
  cancelProtectionChangeAction,
  changeProtectionAction,
  submitProofAction,
} from './actions'

export const metadata: Metadata = { title: 'Protection and insurance' }

// PRD 01 US-705 (B-104). "Insurance/protection selection visible with option to
// change tier (takes effect next billing cycle) or submit proof of own
// insurance."
//
// The wording throughout says "protection plan" for what we sell and
// "insurance" for cover the tenant already holds. That is not pedantry — see
// lib/protection/plans.ts: selling actual insurance generally needs a licensed
// agent, which is why the industry sells a lease addendum instead, and copy
// that blurs the two is copy that claims something untrue.

function formatDay(date: Date): string {
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeZone: 'UTC' }).format(date)
}

export default async function ProtectionPage() {
  const actor = await requireTenantActor()
  const units = await protectionForTenant(actor.tenantId)

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-xl font-semibold">Protection and insurance</h1>
        <p className="text-muted-foreground max-w-prose text-sm text-pretty">
          Every unit needs either one of our protection plans or your own insurance. Changes take
          effect at the start of your next billing month — this month&apos;s charge never changes,
          and neither does the cover you have until then.
        </p>
      </header>

      {units.length === 0 && (
        <p className="text-muted-foreground text-sm">You don&apos;t have any units right now.</p>
      )}

      {units.map((unit) => (
        <section
          key={unit.leaseId}
          aria-labelledby={`unit-${unit.leaseId}`}
          className="border-input flex flex-col gap-4 rounded-lg border p-4"
        >
          <div>
            <h2 id={`unit-${unit.leaseId}`} className="font-medium">
              Unit {unit.unitNumber}
              <span className="text-muted-foreground font-normal"> · {unit.facilityName}</span>
            </h2>
            <p className="mt-1 text-sm">
              {unit.currentPlanName ? (
                <>
                  You have <strong>{unit.currentPlanName}</strong> at{' '}
                  {formatRate(unit.currentPremiumCents)}/month.
                </>
              ) : (
                <>You are covered by your own insurance on this unit.</>
              )}
            </p>
          </div>

          {unit.waiver?.expired && (
            // Said loudly and BEFORE the forms. D-17 auto-enrols into the
            // facility's default tier when cover lapses, which means a charge
            // the tenant did not choose — telling them after that has happened
            // is how a defensible policy becomes a complaint.
            <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-pretty text-red-900">
              The policy we have on file ran out on {formatDay(unit.waiver.expiresAt!)}. Until you
              give us current cover, we have to add one of our protection plans to this unit and
              charge for it. Send us your new policy below and that stops.
            </p>
          )}

          {unit.pending && (
            <div role="status" className="border-input rounded-md border p-3 text-sm text-pretty">
              <p>
                {unit.pending.toPlanName
                  ? `Changing to ${unit.pending.toPlanName} (${formatRate(unit.pending.toPremiumCents)}/month) on ${formatDay(unit.pending.effectiveFrom)}.`
                  : `Your protection plan stops on ${formatDay(unit.pending.effectiveFrom)} — you will be covered by your own insurance from then.`}
              </p>
              <AdminForm
                action={cancelProtectionChangeAction}
                label="Call off this change"
                className="mt-2"
              >
                <input type="hidden" name="changeId" value={unit.pending.id} />
                <button type="submit" className="text-sm underline underline-offset-4">
                  Call this off
                </button>
              </AdminForm>
            </div>
          )}

          <AdminForm
            action={changeProtectionAction}
            label={`Change cover for unit ${unit.unitNumber}`}
            className="flex flex-col gap-3"
          >
            <input type="hidden" name="leaseId" value={unit.leaseId} />
            <Field
              name="tier"
              label="Level of cover"
              as="select"
              defaultValue=""
              className="flex flex-col gap-1 text-sm"
            >
              <option value="">Choose…</option>
              {unit.plans.map((plan) => (
                <option key={plan.tier} value={plan.tier}>
                  {plan.name} — {formatRate(plan.coverageCents)} of cover,{' '}
                  {formatRate(plan.premiumCents)}/month
                </option>
              ))}
              <option value="waiver">I have my own insurance</option>
            </Field>
            <button
              type="submit"
              className="bg-primary text-primary-foreground inline-flex min-h-11 items-center justify-center self-start rounded-md px-4 text-sm font-medium"
            >
              Change cover
            </button>
          </AdminForm>

          <details className="border-input rounded-lg border p-4">
            <summary className="cursor-pointer text-sm font-medium">
              Tell us about your own insurance
            </summary>
            <p className="text-muted-foreground mt-2 text-sm text-pretty">
              We need your insurer, your policy number and the date the policy runs out. Attach
              the declaration page too if you have it handy — a photo is fine.
            </p>
            <AdminForm
              action={submitProofAction}
              label={`Your own insurance for unit ${unit.unitNumber}`}
              className="mt-3 grid gap-3 sm:grid-cols-3"
            >
              <input type="hidden" name="leaseId" value={unit.leaseId} />
              <Field
                name="carrier"
                label="Insurer"
                type="text"
                required
                defaultValue={unit.waiver?.carrier ?? ''}
                className="flex flex-col gap-1 text-sm"
              />
              <Field
                name="policyNumber"
                label="Policy number"
                type="text"
                required
                defaultValue={unit.waiver?.policyNumber ?? ''}
                className="flex flex-col gap-1 text-sm"
              />
              <Field
                name="expiresAt"
                label="Runs out on"
                type="date"
                required
                defaultValue={unit.waiver?.expiresAt?.toISOString().slice(0, 10) ?? ''}
                className="flex flex-col gap-1 text-sm"
              />
              <Field
                name="document"
                label="Declaration page (optional)"
                type="file"
                accept="application/pdf,image/jpeg,image/png"
                hint="A PDF or a photo of the page, up to 10 MB. You can send the details without it and bring the document in later."
                className="flex flex-col gap-1 text-sm sm:col-span-3"
              />
              <div className="sm:col-span-3">
                <button
                  type="submit"
                  className="border-input hover:bg-accent inline-flex min-h-11 items-center justify-center rounded-md border px-4 text-sm font-medium"
                >
                  Send these details
                </button>
              </div>
            </AdminForm>
          </details>
        </section>
      ))}
    </div>
  )
}
