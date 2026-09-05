import { AdminForm, Field, FieldSet } from '@/components/admin/form'
import { submitProtectionAction } from '@/app/(public)/checkout/actions'
import { formatRate } from '@/lib/format'
import type { PlanOption } from '@/lib/protection/plans'
import { translate, type Dictionary, type MessageKey } from '@/lib/i18n'

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
  waiver,
  dict,
}: {
  token: string
  plans: readonly PlanOption[]
  /// B-111: the renter's own earlier choice when they have come back to this
  /// step, and only otherwise the recommended tier. §6.4's "going forward
  /// re-asks nothing" — a renter who came back to fix their email must not find
  /// their protection choice quietly reset to ours on the way past.
  defaultTier: string | null
  required: boolean
  /// Their own-cover details, if they gave them. Read from the stored waiver
  /// rather than the session, because that is where `recordWaiver` put them.
  waiver?: { carrier: string; policyNumber: string; expiresAt: string } | null
  dict: Dictionary
}) {
  const t = (key: MessageKey, vars?: Record<string, string | number>) =>
    translate(dict, key, vars)
  return (
    <AdminForm action={submitProtectionAction} label={t('protection.formLabel')} className="mt-4">
      <input type="hidden" name="token" value={token} />

      <p className="text-pretty">
        {required ? t('protection.required') : t('protection.optional')}{' '}
        {t('protection.notInsurance')}
      </p>

      {/* The refusal to choose is a fact about the whole group, so it lands on
          the <fieldset> — `validateChoice` reports it under `protection` while
          the radios are named `tier`, which is why FieldSet takes the error key
          separately. Putting it on the first radio would leave anyone who
          arrives at the third one with no idea anything was wrong. */}
      <FieldSet name="protection" legend={t('protection.chooseLegend')} className="mt-4">
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
                  — {formatRate(plan.premiumCents)}
                  {t('card.perMonth')}
                </span>
                <span className="text-muted-foreground block text-sm">
                  {t('protection.coversUpTo', { amount: formatRate(plan.coverageCents) })}
                </span>
              </span>
            </label>
          ))}

          <label className="border-input flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border p-3">
            <input
              type="radio"
              name="tier"
              value="__waiver__"
              defaultChecked={defaultTier === '__waiver__'}
              className="mt-1"
            />
            <span>
              <span className="font-medium">{t('protection.ownCover')}</span>
              <span className="text-muted-foreground block text-sm">
                {t('protection.ownCoverBody')}
              </span>
            </span>
          </label>
        </div>
      </FieldSet>

      {/* Always rendered rather than revealed by JavaScript: the public path
          works with the bundle disabled, and a field that only exists after a
          click is a field a screen-reader user may never learn about. */}
      <fieldset className="border-input mt-4 rounded-lg border p-3">
        <legend className="px-1 text-sm font-medium">{t('protection.ownCoverLegend')}</legend>
        <div className="mt-2 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field
            name="carrier"
            label={t('protection.insurer')}
            autoComplete="off"
            defaultValue={waiver?.carrier ?? ''}
          />
          <Field
            name="policyNumber"
            label={t('protection.policyNumber')}
            autoComplete="off"
            defaultValue={waiver?.policyNumber ?? ''}
          />
          <Field
            name="expiresAt"
            label={t('protection.policyExpires')}
            type="date"
            defaultValue={waiver?.expiresAt ?? ''}
            className="flex flex-col gap-1 text-sm sm:col-span-2"
            hint={t('protection.policyExpiresHint')}
          />
        </div>
        {/* Unchecked by default. An attestation that arrives pre-agreed is not
            an attestation. Through `Field` so that leaving it unticked marks
            the box itself invalid and points at its own message. */}
        <Field
          as="checkbox"
          name="attested"
          value="yes"
          className="mt-3 text-sm"
          label={t('protection.attest')}
        />
      </fieldset>

      <div className="mt-4">
        <button
          type="submit"
          className="bg-primary text-primary-foreground inline-flex min-h-11 w-full items-center justify-center rounded-md px-4 text-base font-medium sm:w-auto"
        >
          {t('checkout.continue')}
        </button>
      </div>
    </AdminForm>
  )
}
