import { presetFor } from '@storage/core/access'
import { parseWeeklySchedule } from '@storage/core/facility-settings'
import { AdminForm, Field } from '@/components/admin/form'
import { Button } from '@/components/ui/button'
import { DataTable } from '@/components/ui/data-table'
import { EmptyState } from '@/components/ui/empty-state'
import { ScrollRegion } from '@/components/ui/scroll-region'
import { getSwitcherData } from '@/lib/admin/context'
import { resolveSelectedFacility } from '@/lib/admin/facility-selection-logic'
import { nonTenantCodes, staffForGateCodes } from '@/lib/access/non-tenant'
import { can } from '@/lib/rbac/authorize'
import { issueNonTenantCodeAction, revokeNonTenantCodeAction } from './actions'

export const metadata = { title: 'Staff and vendor codes' }

// PRD 03 US-10 (B-436). Gate codes for people who are not tenants, so nobody
// borrows a tenant's.

const KIND_LABELS = { staff: 'Staff', vendor: 'Vendor', temporary: 'Temporary' } as const

const HOURS_LABELS = {
  anytime: 'Gate hours',
  weekdays: 'Weekdays only',
  weekends: 'Weekends only',
  custom: 'Limited hours',
} as const

export default async function NonTenantCodesPage() {
  const { actor, facilities, cookieValue, canSeeAll } = await getSwitcherData()
  const selected = resolveSelectedFacility(cookieValue, facilities, canSeeAll)

  if (selected.mode !== 'single') {
    return (
      <div className="flex flex-col gap-3">
        <h1 className="text-2xl font-bold tracking-tight">Staff and vendor codes</h1>
        <p className="text-muted-foreground text-sm text-pretty">
          Choose a single facility in the switcher above. A gate code works at one gate, so this
          screen needs to know which.
        </p>
      </div>
    )
  }
  const { id: facilityId, name: facilityName, timezone } = selected.facility
  if (!can(actor, 'access:manage_grants', facilityId)) {
    return (
      <p className="text-muted-foreground text-sm">
        You don&apos;t have access to gate codes at {facilityName}.
      </p>
    )
  }

  const [rows, staff] = await Promise.all([
    nonTenantCodes(actor, facilityId),
    staffForGateCodes(actor, facilityId),
  ])
  const day = new Intl.DateTimeFormat('en-US', { timeZone: timezone, dateStyle: 'medium' })

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Staff and vendor codes — {facilityName}</h1>
        <p className="text-muted-foreground mt-1 max-w-prose text-sm text-pretty">
          A code for each staff member, vendor or dated visitor. Gate activity names the holder, so
          never lend out a tenant&apos;s code. A staff code is revoked when the account is
          deactivated. An auction buyer&apos;s code is issued from the auction case.
        </p>
      </div>

      {rows.length === 0 ? (
        <EmptyState>No staff, vendor or temporary codes at this facility.</EmptyState>
      ) : (
        <ScrollRegion aria-label="Staff, vendor and temporary codes">
          <DataTable className="min-w-max">
            <caption className="sr-only">
              Working staff, vendor and temporary gate codes at {facilityName}
            </caption>
            <DataTable.Head>
              <tr>
                <th scope="col" className="px-3 py-2 font-semibold">Holder</th>
                <th scope="col" className="px-3 py-2 font-semibold">Kind</th>
                <th scope="col" className="px-3 py-2 font-semibold">Hours</th>
                <th scope="col" className="px-3 py-2 font-semibold">Last day</th>
                <th scope="col" className="px-3 py-2 font-semibold">Issued</th>
                <th scope="col" className="px-3 py-2 font-semibold">Action</th>
              </tr>
            </DataTable.Head>
            <tbody>
              {rows.map((row) => (
                <DataTable.Row key={row.grantId} className="h-auto align-top">
                  <th scope="row" className="px-3 py-2 text-left font-medium">{row.holderName}</th>
                  <td className="px-3 py-2">
                    {row.auctionBuyer ? 'Auction buyer' : KIND_LABELS[row.holderType]}
                  </td>
                  <td className="px-3 py-2">
                    {HOURS_LABELS[presetFor(parseWeeklySchedule(row.accessHours ?? null))]}
                  </td>
                  {/* An absolute date, never a countdown (PRD 01 §6.8.1).
                      `expiresAt` is the midnight that ENDS the last day. */}
                  <td className="px-3 py-2">
                    {row.expiresAt ? day.format(new Date(row.expiresAt.getTime() - 1)) : 'Until revoked'}
                  </td>
                  <td className="px-3 py-2">{day.format(row.createdAt)}</td>
                  <td className="px-3 py-2">
                    <AdminForm
                      action={revokeNonTenantCodeAction}
                      label={`Revoke the code for ${row.holderName}`}
                    >
                      <input type="hidden" name="grantId" value={row.grantId} />
                      <input type="hidden" name="holderName" value={row.holderName} />
                      <Button type="submit" variant="outline">
                        Revoke<span className="sr-only"> the code for {row.holderName}</span>
                      </Button>
                    </AdminForm>
                  </td>
                </DataTable.Row>
              ))}
            </tbody>
          </DataTable>
        </ScrollRegion>
      )}

      <section aria-labelledby="issue-heading" className="flex flex-col gap-3">
        <h2 id="issue-heading" className="text-base font-medium">
          Issue a code
        </h2>
        <AdminForm
          action={issueNonTenantCodeAction}
          label="Issue a staff, vendor or temporary gate code"
          className="grid max-w-2xl gap-3 sm:grid-cols-2"
        >
          <input type="hidden" name="facilityId" value={facilityId} />
          <Field name="holderType" label="Kind" as="select" required>
            <option value="staff">Staff</option>
            <option value="vendor">Vendor</option>
            <option value="temporary">Temporary</option>
          </Field>
          <Field
            name="staffUserId"
            label="Staff member"
            as="select"
            hint="For a staff code. The gate log shows their name."
          >
            <option value="">Not a staff code</option>
            {staff.map((row) => (
              <option key={row.staffUserId} value={row.staffUserId}>
                {row.name}
              </option>
            ))}
          </Field>
          <Field
            name="holderName"
            label="Name"
            type="text"
            autoComplete="off"
            hint="For a vendor or temporary code: the company or person the gate log should show."
          />
          <Field name="hours" label="Hours" as="select" hint="Never wider than the gate hours.">
            <option value="anytime">{HOURS_LABELS.anytime}</option>
            <option value="weekdays">{HOURS_LABELS.weekdays}</option>
            <option value="weekends">{HOURS_LABELS.weekends}</option>
          </Field>
          <Field
            name="expiresOn"
            label="Last day"
            type="date"
            hint="The code works through this day. Required for a temporary code."
          />
          <div className="sm:col-span-2">
            <Button type="submit">Issue code</Button>
          </div>
        </AdminForm>
      </section>
    </div>
  )
}
