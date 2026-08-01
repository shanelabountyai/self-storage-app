import { Button } from '@/components/ui/button'
import { AdminForm, Field } from '@/components/admin/form'
import { DayScheduleRow } from '@/components/admin/day-schedule-row'
import { getSwitcherData } from '@/lib/admin/context'
import { resolveSelectedFacility } from '@/lib/admin/facility-selection-logic'
import { hasPermissionAnywhere } from '@/lib/rbac/authorize'
import { getFacilitySettings } from '@/lib/admin/facility-settings'
import { formatCents } from '@/lib/format'
import { CLOSED_ALL_WEEK, DAYS_OF_WEEK } from '@storage/core/facility-settings'
import { currentPlans } from '@/lib/protection/plans'
import {
  addFeeScheduleEntryAction,
  addProtectionPlanAction,
  setProtectionPolicyAction,
  addTaxComponentAction,
  updateFacilityDetailsAction,
  updateFacilityHoursAction,
} from './actions'

const TIMEZONES = Intl.supportedValuesOf('timeZone')
const FEE_TYPES = ['admin', 'late', 'nsf', 'lien'] as const

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

// Facility settings CRUD (PRD 02 US-3, FR-9). Unlike the dashboard, there is
// no "all facilities" story here — settings are inherently per-facility, so
// this page just asks for one to be picked.
export default async function AdminSettingsPage() {
  const { actor, facilities, cookieValue, canSeeAll } = await getSwitcherData()
  const selected = resolveSelectedFacility(cookieValue, facilities, canSeeAll)

  if (selected.mode !== 'single') {
    return (
      <p className="text-muted-foreground text-sm">
        Pick a specific facility above to edit its settings.
      </p>
    )
  }

  if (!hasPermissionAnywhere(actor, ['facility:settings'])) {
    return (
      <p className="text-muted-foreground text-sm">
        You don&apos;t have access to facility settings.
      </p>
    )
  }

  const facilityId = selected.facility.id
  const settings = await getFacilitySettings(facilityId)
  const { facility } = settings
  const plans = await currentPlans(facilityId)
  const officeHours = settings.officeHours ?? CLOSED_ALL_WEEK
  const gateHours = settings.gateHours ?? CLOSED_ALL_WEEK

  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <h1 className="text-lg font-semibold">{facility.name} settings</h1>

      <section aria-labelledby="details-heading" className="flex flex-col gap-3">
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
            defaultValue={facility.addressLine2 ?? ''}
            className="flex flex-col gap-1 text-sm sm:col-span-2"
          />
          <Field name="city" label="City" defaultValue={facility.city} required />
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
          <Field name="phone" label="Phone" type="tel" defaultValue={facility.phone ?? ''} />
          <Field name="email" label="Email" type="email" defaultValue={facility.email ?? ''} />

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
            <div className="overflow-x-auto">
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
            </div>
          </div>

          <div>
            <h3 className="mb-2 text-sm font-medium">Gate hours</h3>
            <div className="overflow-x-auto">
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
            </div>
            <p className="text-muted-foreground mt-2 text-xs">
              Exposed at <code className="break-all">/api/facilities/{facilityId}/gate-hours</code>{' '}
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
          Effective-dated: adding a new rate never changes invoices already generated under the old
          one (PRD 02 US-3).
        </p>

        {settings.currentTaxComponents.length > 0 && (
          <div className="overflow-x-auto">
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
                    <th scope="row" className="py-1 text-left font-normal capitalize">
                      {tax.jurisdiction}
                    </th>
                    <td className="py-1">{(tax.rateBasisPoints / 100).toFixed(2)}%</td>
                    <td className="py-1">{tax.effectiveFrom.toISOString().slice(0, 10)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
          Baseline amounts only — late-fee rules (caps, grace periods) are configured in B-047.
        </p>

        {settings.currentFeeSchedule.length > 0 && (
          <div className="overflow-x-auto">
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
                    <th scope="row" className="py-1 text-left font-normal capitalize">
                      {fee.feeType}
                    </th>
                    <td className="py-1">{formatCents(fee.amountCents)}</td>
                    <td className="py-1">{fee.effectiveFrom.toISOString().slice(0, 10)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
              <option key={type} value={type} className="capitalize">
                {type}
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

      <section aria-labelledby="protection-heading" className="flex flex-col gap-3">
        <h2 id="protection-heading" className="text-base font-medium">
          Protection plans
        </h2>
        <p className="text-muted-foreground text-xs text-pretty">
          What we sell is a <strong>protection plan</strong>, not insurance — &ldquo;insurance&rdquo;
          describes cover a tenant already holds elsewhere (PRD 02 US-44). Tiers are
          effective-dated: changing a premium adds a new row and never repricing an existing lease.
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
            defaultValue={facility.protectionRequired ? 'yes' : 'no'}
          >
            <option value="yes">Required — a plan, or proof of the tenant&apos;s own cover</option>
            <option value="no">Optional</option>
          </Field>
          <Button type="submit">Save policy</Button>
        </AdminForm>

        {plans.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-muted-foreground">
                  <th scope="col" className="pb-1 font-normal">Tier</th>
                  <th scope="col" className="pb-1 font-normal">Covers up to</th>
                  <th scope="col" className="pb-1 font-normal">Premium</th>
                </tr>
              </thead>
              <tbody>
                {plans.map((plan) => (
                  <tr key={plan.tier}>
                    <th scope="row" className="py-1 text-left font-normal">
                      {plan.name} <span className="text-muted-foreground">({plan.tier})</span>
                    </th>
                    <td className="py-1">{formatCents(plan.coverageCents)}</td>
                    <td className="py-1">{formatCents(plan.premiumCents)}/mo</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <AdminForm
          action={addProtectionPlanAction}
          label="Add a protection tier"
          className="flex flex-wrap items-end gap-3"
        >
          <input type="hidden" name="facilityId" value={facilityId} />
          <Field name="tier" label="Tier key" placeholder="standard" required hint="Lowercase, never changes." />
          <Field name="name" label="Name customers see" placeholder="$3,000 cover" required />
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
          <Field name="effectiveFrom" label="Effective from" type="date" defaultValue={todayIso()} required />
          <Button type="submit">Add tier</Button>
        </AdminForm>
      </section>
    </div>
  )
}
