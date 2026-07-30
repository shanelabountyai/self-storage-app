import { Button } from '@/components/ui/button'
import { DayScheduleRow } from '@/components/admin/day-schedule-row'
import { getSwitcherData } from '@/lib/admin/context'
import { resolveSelectedFacility } from '@/lib/admin/facility-selection-logic'
import { hasPermissionAnywhere } from '@/lib/rbac/authorize'
import { getFacilitySettings } from '@/lib/admin/facility-settings'
import { formatCents } from '@/lib/format'
import { CLOSED_ALL_WEEK, DAYS_OF_WEEK } from '@storage/core/facility-settings'
import {
  addFeeScheduleEntryAction,
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
  const officeHours = settings.officeHours ?? CLOSED_ALL_WEEK
  const gateHours = settings.gateHours ?? CLOSED_ALL_WEEK

  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <h1 className="text-lg font-semibold">{facility.name} settings</h1>

      <section aria-labelledby="details-heading" className="flex flex-col gap-3">
        <h2 id="details-heading" className="text-base font-medium">
          Facility details
        </h2>
        <form action={updateFacilityDetailsAction} className="grid grid-cols-2 gap-3">
          <input type="hidden" name="facilityId" value={facilityId} />

          <label className="col-span-2 flex flex-col gap-1 text-sm">
            Name
            <input
              name="name"
              defaultValue={facility.name}
              required
              className="border-input bg-background h-9 rounded-md border px-2"
            />
          </label>

          <label className="col-span-2 flex flex-col gap-1 text-sm">
            Address line 1
            <input
              name="addressLine1"
              defaultValue={facility.addressLine1}
              required
              className="border-input bg-background h-9 rounded-md border px-2"
            />
          </label>

          <label className="col-span-2 flex flex-col gap-1 text-sm">
            Address line 2
            <input
              name="addressLine2"
              defaultValue={facility.addressLine2 ?? ''}
              className="border-input bg-background h-9 rounded-md border px-2"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            City
            <input
              name="city"
              defaultValue={facility.city}
              required
              className="border-input bg-background h-9 rounded-md border px-2"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            State
            <input
              name="state"
              defaultValue={facility.state}
              required
              maxLength={2}
              className="border-input bg-background h-9 rounded-md border px-2 uppercase"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            Postal code
            <input
              name="postalCode"
              defaultValue={facility.postalCode}
              required
              className="border-input bg-background h-9 rounded-md border px-2"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            Timezone
            <select
              name="timezone"
              defaultValue={facility.timezone}
              required
              className="border-input bg-background h-9 rounded-md border px-2"
            >
              {TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm">
            Phone
            <input
              name="phone"
              type="tel"
              defaultValue={facility.phone ?? ''}
              className="border-input bg-background h-9 rounded-md border px-2"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            Email
            <input
              name="email"
              type="email"
              defaultValue={facility.email ?? ''}
              className="border-input bg-background h-9 rounded-md border px-2"
            />
          </label>

          <div className="col-span-2">
            <Button type="submit">Save details</Button>
          </div>
        </form>
      </section>

      <section aria-labelledby="hours-heading" className="flex flex-col gap-3">
        <h2 id="hours-heading" className="text-base font-medium">
          Office &amp; gate hours
        </h2>
        <form action={updateFacilityHoursAction} className="flex flex-col gap-6">
          <input type="hidden" name="facilityId" value={facilityId} />

          <div>
            <h3 className="mb-2 text-sm font-medium">Office hours</h3>
            <table className="w-full text-left">
              <thead className="sr-only">
                <tr>
                  <th>Day</th>
                  <th>Closed</th>
                  <th>Opens</th>
                  <th>Closes</th>
                </tr>
              </thead>
              <tbody>
                {DAYS_OF_WEEK.map((day) => (
                  <DayScheduleRow key={day} namePrefix="officeHours" day={day} value={officeHours[day]} />
                ))}
              </tbody>
            </table>
          </div>

          <div>
            <h3 className="mb-2 text-sm font-medium">Gate hours</h3>
            <table className="w-full text-left">
              <thead className="sr-only">
                <tr>
                  <th>Day</th>
                  <th>Closed</th>
                  <th>Opens</th>
                  <th>Closes</th>
                </tr>
              </thead>
              <tbody>
                {DAYS_OF_WEEK.map((day) => (
                  <DayScheduleRow key={day} namePrefix="gateHours" day={day} value={gateHours[day]} />
                ))}
              </tbody>
            </table>
            <p className="text-muted-foreground mt-2 text-xs">
              Exposed at <code>/api/facilities/{facilityId}/gate-hours</code> for the hardware
              module (PRD 03).
            </p>
          </div>

          <div>
            <Button type="submit">Save hours</Button>
          </div>
        </form>
      </section>

      <section aria-labelledby="tax-heading" className="flex flex-col gap-3">
        <h2 id="tax-heading" className="text-base font-medium">
          Tax components
        </h2>
        <p className="text-muted-foreground text-xs">
          Effective-dated: adding a new rate never changes invoices already generated
          under the old one (PRD 02 US-3).
        </p>

        {settings.currentTaxComponents.length > 0 && (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-muted-foreground">
                <th className="pb-1 font-normal">Jurisdiction</th>
                <th className="pb-1 font-normal">Rate</th>
                <th className="pb-1 font-normal">Effective from</th>
              </tr>
            </thead>
            <tbody>
              {settings.currentTaxComponents.map((tax) => (
                <tr key={tax.jurisdiction}>
                  <td className="py-1 capitalize">{tax.jurisdiction}</td>
                  <td className="py-1">{(tax.rateBasisPoints / 100).toFixed(2)}%</td>
                  <td className="py-1">{tax.effectiveFrom.toISOString().slice(0, 10)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <form action={addTaxComponentAction} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="facilityId" value={facilityId} />
          <label className="flex flex-col gap-1 text-sm">
            Jurisdiction
            <input
              name="jurisdiction"
              placeholder="state, county, city…"
              required
              className="border-input bg-background h-9 rounded-md border px-2"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Rate (%)
            <input
              name="ratePercent"
              type="number"
              step="0.01"
              min="0"
              max="100"
              required
              className="border-input bg-background h-9 w-28 rounded-md border px-2"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Effective from
            <input
              name="effectiveFrom"
              type="date"
              defaultValue={todayIso()}
              required
              className="border-input bg-background h-9 rounded-md border px-2"
            />
          </label>
          <Button type="submit">Add rate</Button>
        </form>
      </section>

      <section aria-labelledby="fees-heading" className="flex flex-col gap-3">
        <h2 id="fees-heading" className="text-base font-medium">
          Fee schedule
        </h2>
        <p className="text-muted-foreground text-xs">
          Baseline amounts only — late-fee rules (caps, grace periods) are configured
          in B-047.
        </p>

        {settings.currentFeeSchedule.length > 0 && (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-muted-foreground">
                <th className="pb-1 font-normal">Fee</th>
                <th className="pb-1 font-normal">Amount</th>
                <th className="pb-1 font-normal">Effective from</th>
              </tr>
            </thead>
            <tbody>
              {settings.currentFeeSchedule.map((fee) => (
                <tr key={fee.feeType}>
                  <td className="py-1 capitalize">{fee.feeType}</td>
                  <td className="py-1">{formatCents(fee.amountCents)}</td>
                  <td className="py-1">{fee.effectiveFrom.toISOString().slice(0, 10)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <form action={addFeeScheduleEntryAction} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="facilityId" value={facilityId} />
          <label className="flex flex-col gap-1 text-sm">
            Fee type
            <select
              name="feeType"
              required
              className="border-input bg-background h-9 rounded-md border px-2 capitalize"
            >
              {FEE_TYPES.map((type) => (
                <option key={type} value={type} className="capitalize">
                  {type}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Amount ($)
            <input
              name="amountDollars"
              type="number"
              step="0.01"
              min="0"
              required
              className="border-input bg-background h-9 w-28 rounded-md border px-2"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Effective from
            <input
              name="effectiveFrom"
              type="date"
              defaultValue={todayIso()}
              required
              className="border-input bg-background h-9 rounded-md border px-2"
            />
          </label>
          <Button type="submit">Add fee</Button>
        </form>
      </section>
    </div>
  )
}
