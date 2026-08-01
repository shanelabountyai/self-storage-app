import { AdminForm, Field } from '@/components/admin/form'
import { submitProtectionAction } from '@/app/(public)/checkout/actions'
import { formatRate } from '@/lib/format'
import type { PlanOption } from '@/lib/protection/plans'

// PRD 01 US-501 step 3 / PRD 02 US-44.
//
// Radios in a fieldset, not styled divs, and Continue is never disabled. A
// disabled button with no message is invisible to someone who cannot see why it
// is disabled — the step refuses on submit with a named, announced error
// instead (3.3.1, and PRD 01 §6.8.1's "never disable Continue").

export function ProtectionStep({
  token,
  plans,
  defaultTier,
  required,
}: {
  token: string
  plans: readonly PlanOption[]
  defaultTier: string | null
  required: boolean
}) {
  return (
    <AdminForm action={submitProtectionAction} label="Protect what you store" className="mt-4">
      <input type="hidden" name="token" value={token} />

      <p className="text-pretty">
        {required
          ? 'You need cover for what you store — either one of our plans, or your own home insurance.'
          : 'You can add cover for what you store, or use your own home insurance.'}{' '}
        This is a protection plan we offer, not an insurance policy.
      </p>

      <fieldset className="mt-4">
        <legend className="font-medium">Choose your cover</legend>

        <div className="mt-3 flex flex-col gap-3">
          {plans.map((plan) => (
            <label
              key={plan.tier}
              className="border-input flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border p-3"
            >
              <input
                type="radio"
                name="tier"
                value={plan.tier}
                defaultChecked={plan.tier === defaultTier}
                className="mt-1"
              />
              <span>
                <span className="font-medium">{plan.name}</span>
                <span className="text-muted-foreground">
                  {' '}
                  — {formatRate(plan.premiumCents)}/mo
                </span>
                <span className="text-muted-foreground block text-sm">
                  Covers up to {formatRate(plan.coverageCents)} of your things.
                </span>
              </span>
            </label>
          ))}

          <label className="border-input flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border p-3">
            <input type="radio" name="tier" value="__waiver__" className="mt-1" />
            <span>
              <span className="font-medium">I have my own cover</span>
              <span className="text-muted-foreground block text-sm">
                Your home or renter&apos;s insurance already covers stored belongings. We need the
                details below.
              </span>
            </span>
          </label>
        </div>
      </fieldset>

      {/* Always rendered rather than revealed by JavaScript: the public path
          works with the bundle disabled, and a field that only exists after a
          click is a field a screen-reader user may never learn about. */}
      <fieldset className="border-input mt-4 rounded-lg border p-3">
        <legend className="px-1 text-sm font-medium">If you are using your own cover</legend>
        <div className="mt-2 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field name="carrier" label="Insurer" autoComplete="off" />
          <Field name="policyNumber" label="Policy number" autoComplete="off" />
          <Field
            name="expiresAt"
            label="Policy runs out"
            type="date"
            className="flex flex-col gap-1 text-sm sm:col-span-2"
            hint="We will remind you before it runs out."
          />
        </div>
        <label className="mt-3 inline-flex items-start gap-2 text-sm">
          {/* Unchecked by default. An attestation that arrives pre-agreed is
              not an attestation. */}
          <input type="checkbox" name="attested" value="yes" className="mt-1" />
          <span>
            I confirm my own insurance covers my belongings while they are stored here, and I will
            tell you if that changes.
          </span>
        </label>
      </fieldset>

      <div className="mt-4">
        <button
          type="submit"
          className="bg-primary text-primary-foreground inline-flex min-h-11 w-full items-center justify-center rounded-md px-4 text-base font-medium sm:w-auto"
        >
          Continue
        </button>
      </div>
    </AdminForm>
  )
}
