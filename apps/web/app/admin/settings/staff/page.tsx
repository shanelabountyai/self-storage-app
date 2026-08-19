import Link from 'next/link'
import { AdminForm, Field } from '@/components/admin/form'
import { Button } from '@/components/ui/button'
import { getAdminActor } from '@/lib/admin/context'
import { can, hasPermissionAnywhere } from '@/lib/rbac/authorize'
import { startStaffImpersonationAction } from '@/app/admin/impersonation/actions'
import { IMPERSONATION_TTL_MINUTES } from '@/lib/impersonation/service'
import { staffSecurityRows } from '@/lib/admin/staff-security'
import { resetStaffMfaAction } from './actions'

export const metadata = { title: 'Staff security' }

// PRD 00 §7.1 (B-079). Who has a second factor, and the way back in for
// somebody who has lost theirs.

function formatDate(value: Date): string {
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(value)
}

export default async function StaffSecurityPage() {
  const actor = await getAdminActor()

  if (!can(actor, 'users:manage', null)) {
    return (
      <p className="text-muted-foreground max-w-prose text-sm text-pretty">
        Staff accounts are org-level, so this screen is for an owner or a manager assigned to every
        facility. Your own two-factor setup is at{' '}
        <Link href="/mfa" className="underline underline-offset-2">
          two-factor authentication
        </Link>
        .
      </p>
    )
  }

  const rows = await staffSecurityRows(actor)
  const unenrolled = rows.filter((row) => !row.enrolled && row.status === 'active')

  return (
    <div className="flex max-w-4xl flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-xl font-semibold">Staff security</h1>
        <p className="text-muted-foreground max-w-prose text-sm text-pretty">
          Every staff account needs two-factor authentication before it can reach the admin. Anyone
          listed below without it can still sign in, and lands on the setup screen and nowhere else
          until they finish.
        </p>
      </header>

      {unenrolled.length > 0 && (
        <p className="border-input rounded-md border p-3 text-sm text-pretty">
          {unenrolled.length} active {unenrolled.length === 1 ? 'account has' : 'accounts have'} not
          set up two-factor authentication yet.
        </p>
      )}

      <div tabIndex={0} className="overflow-x-auto">
        <table className="w-full min-w-2xl text-left text-sm">
          <caption className="sr-only">
            Staff accounts, their two-factor status and remaining recovery codes
          </caption>
          <thead>
            <tr className="border-input border-b">
              <th scope="col" className="py-2 pr-4 font-medium">Name</th>
              <th scope="col" className="py-2 pr-4 font-medium">Facilities</th>
              <th scope="col" className="py-2 pr-4 font-medium">Two-factor</th>
              <th scope="col" className="py-2 pr-4 font-medium">Recovery codes</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.staffUserId} className="border-input border-b align-top">
                <td className="py-2 pr-4">
                  <span className="font-medium">{row.name}</span>
                  <span className="text-muted-foreground block text-xs">{row.email}</span>
                  {row.status !== 'active' && (
                    <span className="text-muted-foreground block text-xs">{row.status}</span>
                  )}
                </td>
                <td className="text-muted-foreground py-2 pr-4 text-xs">
                  {row.facilities.length === 0 ? 'None assigned' : row.facilities.join(', ')}
                </td>
                <td className="py-2 pr-4">
                  {row.enrolled && row.enrolledAt ? (
                    <>On since {formatDate(row.enrolledAt)}</>
                  ) : (
                    <span className="font-medium text-amber-700">Not set up</span>
                  )}
                </td>
                <td className="py-2 pr-4">
                  {row.enrolled ? (
                    <span className={row.unusedRecoveryCodes <= 2 ? 'font-medium text-red-700' : ''}>
                      {row.unusedRecoveryCodes} left
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {hasPermissionAnywhere(actor, ['impersonation:staff']) && (
        // PRD 09 FR-1 (B-091 part 2). This screen is the only staff-user list
        // in the app, so it is where a session as another staff member starts.
        //
        // The list is deliberately NOT pre-filtered to who the escalation guard
        // would permit. Filtering would answer "does this person outrank me" for
        // every colleague at a glance, and a refusal that says so in words is
        // both the honest answer and the one that stays correct — FR-9
        // re-evaluates the same rule on every request afterwards.
        <section aria-labelledby="impersonate-heading" className="flex flex-col gap-3">
          <h2 id="impersonate-heading" className="text-base font-medium">
            View the dashboard as another staff member
          </h2>
          <p className="text-muted-foreground max-w-prose text-sm text-pretty">
            For &quot;it works for me&quot; — opens the admin exactly as they see it, for{' '}
            {IMPERSONATION_TTL_MINUTES} minutes and read-only. You can only reach an account whose
            roles are at or below your own and inside your own facilities; anyone else is refused
            and told why. Nothing can be changed, sent, or paid while the session is running, and
            every screen you open is logged against your name as well as theirs.
          </p>

          <AdminForm
            action={startStaffImpersonationAction}
            label="Start a support session as another staff member"
            className="grid max-w-2xl gap-3 sm:grid-cols-2"
          >
            <Field name="subjectId" label="Staff member" as="select" required>
              {rows
                .filter((row) => row.status === 'active' && row.staffUserId !== actor.staffUserId)
                .map((row) => (
                  <option key={row.staffUserId} value={row.staffUserId}>
                    {row.name} ({row.email})
                  </option>
                ))}
            </Field>
            <Field
              name="reason"
              label="Reason"
              type="text"
              required
              hint="What you are trying to see, in a sentence."
            />
            <Field name="ticketRef" label="Ticket reference (optional)" type="text" />
            <div className="sm:col-span-2">
              <Button type="submit">Start support session</Button>
            </div>
          </AdminForm>
        </section>
      )}

      <section aria-labelledby="reset-heading" className="flex flex-col gap-3">
        <h2 id="reset-heading" className="text-base font-medium">
          Reset somebody&apos;s second factor
        </h2>
        <p className="text-muted-foreground max-w-prose text-sm text-pretty">
          For a lost or replaced phone with no recovery codes left. This clears their authenticator
          and every recovery code, and makes them set up a new one before they can reach any admin
          screen. It does not change their password. Confirm who you are talking to first — this is
          the one action that turns knowing somebody&apos;s password into full access to their
          account, which is why the reason you give is written to the audit log.
        </p>

        <AdminForm
          action={resetStaffMfaAction}
          label="Reset a staff member's second factor"
          className="grid max-w-2xl gap-3 sm:grid-cols-2"
        >
          <Field name="staffUserId" label="Staff member" as="select" required>
            {rows
              .filter((row) => row.enrolled && row.staffUserId !== actor.staffUserId)
              .map((row) => (
                <option key={row.staffUserId} value={row.staffUserId}>
                  {row.name} ({row.email})
                </option>
              ))}
          </Field>
          <Field
            name="reasonCode"
            label="Reason"
            type="text"
            required
            hint="Who asked, and how you confirmed it was them."
          />
          <div className="sm:col-span-2">
            <Button type="submit">Reset second factor</Button>
          </div>
        </AdminForm>
      </section>
    </div>
  )
}
