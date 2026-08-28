import Link from 'next/link'
import { AdminForm, Field } from '@/components/admin/form'
import { Button } from '@/components/ui/button'
import { getAdminActor } from '@/lib/admin/context'
import { can } from '@/lib/rbac/authorize'
import {
  MONETARY_ACTIONS,
  MONETARY_ACTION_HINTS,
  MONETARY_ACTION_LABELS,
  describe,
  roleLimitRows,
  type RoleLimitRow,
} from '@/lib/admin/role-limits'
import { saveRoleLimitsAction } from './actions'

export const metadata = { title: 'Role limits' }

// PRD 02 RBAC-2 (B-197). "Monetary authority limits are starting values the
// owner can change in configuration; they are not hardcoded policy."
//
// They were hardcoded policy — seeded by `packages/db/rbac-catalog.ts` and
// written by nothing — for the whole life of the product. This screen is the
// configuration RBAC-2 promised.
//
// Beside role and permission management rather than in facility settings,
// because the limits are per ROLE and a role is one row for the entire
// portfolio. There is no per-site version of "what a facility manager may
// waive" to put on a facility's own settings page.

/// The value the box starts with. Empty means unlimited, which is why this
/// cannot be `?? 0` — the two are different facts (`describe` says which).
function dollars(limit: number | null): string {
  return limit === null ? '' : (limit / 100).toFixed(2)
}

export default async function RoleLimitsPage() {
  const actor = await getAdminActor()

  if (!can(actor, 'users:manage', null)) {
    return (
      <p className="text-muted-foreground max-w-prose text-sm text-pretty">
        What a role may approve is org-level, so this screen is for an owner or a manager assigned
        to every facility. Each site&apos;s own settings are at{' '}
        <Link href="/admin/settings" className="underline underline-offset-2">
          Settings
        </Link>
        .
      </p>
    )
  }

  const rows = await roleLimitRows(actor)

  return (
    <div className="flex max-w-4xl flex-col gap-10">
      <header className="flex flex-col gap-2">
        <h1 className="text-xl font-semibold">What each role may approve</h1>
        <p className="text-muted-foreground max-w-prose text-sm text-pretty">
          Four limits per staff role, in dollars, for the whole portfolio — a role is one set of
          rules everywhere, not one per site. Over the limit does not fail: it escalates to the next
          role up that can cover the amount, so a lower-ranked role can never be left more generous
          than the one above it. Changes take effect on the next action; nothing already approved is
          revisited.
        </p>
      </header>

      <section aria-labelledby="current-heading" className="flex flex-col gap-3">
        <h2 id="current-heading" className="text-base font-medium">
          Today&apos;s limits
        </h2>
        <div tabIndex={0} className="overflow-x-auto">
          <table className="w-full min-w-2xl text-left text-sm">
            <caption className="sr-only">
              Every staff role with the most it may waive, refund, credit and defer onto a payment
              plan
            </caption>
            <thead>
              <tr className="border-input border-b">
                <th scope="col" className="py-2 pr-4 font-medium">
                  Role
                </th>
                {MONETARY_ACTIONS.map((action) => (
                  <th key={action} scope="col" className="py-2 pr-4 font-medium">
                    {MONETARY_ACTION_LABELS[action]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.roleKey} className="border-input border-b align-top">
                  <th scope="row" className="py-2 pr-4 text-left font-medium">
                    {row.roleName}
                    <span className="text-muted-foreground block text-xs font-normal">
                      Rank {row.rank}
                    </span>
                  </th>
                  {MONETARY_ACTIONS.map((action) => (
                    <td key={action} className="py-2 pr-4">
                      {/* The words, never the blank alone (3.3.2). "unlimited"
                          and "nothing" are opposite facts and an empty cell
                          says neither. */}
                      {describe(row.limits[action])}
                      {!row.holds[action] && (
                        <span className="text-muted-foreground block text-xs">
                          Cannot do this at all
                        </span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="edit-heading" className="flex flex-col gap-6">
        <h2 id="edit-heading" className="text-base font-medium">
          Change a role
        </h2>
        <p className="text-muted-foreground max-w-prose text-sm text-pretty">
          Leave a box empty for <strong>unlimited</strong>. Type <strong>0</strong> for no authority
          at all — the two are different, and this is the only place that distinction is set.
        </p>
        {rows.map((row) => (
          <RoleForm key={row.roleKey} row={row} />
        ))}
      </section>

      <p className="text-muted-foreground max-w-prose text-xs text-pretty">
        Every change is written to the audit log with what each limit was and what it became. Who
        holds which role is set per person and per facility — see{' '}
        <Link href="/admin/settings/staff" className="underline underline-offset-2">
          Staff security
        </Link>
        .
      </p>
    </div>
  )
}

function RoleForm({ row }: { row: RoleLimitRow }) {
  return (
    <AdminForm
      // 2.4.6: named after the role, so a reader listing the forms on this page
      // hears five distinct things rather than "Limits" five times.
      label={`Limits for ${row.roleName}`}
      action={saveRoleLimitsAction}
      className="border-input flex flex-col gap-3 rounded-lg border p-4"
    >
      <input type="hidden" name="roleKey" value={row.roleKey} />
      <input type="hidden" name="roleName" value={row.roleName} />
      <h3 className="text-sm font-medium">{row.roleName}</h3>

      <div className="grid gap-3 sm:grid-cols-2">
        {MONETARY_ACTIONS.map((action) => (
          <Field
            key={action}
            name={action}
            // Named after the role AND the act, not four fields called "Limit"
            // (2.4.6) — five of these forms sit on one page.
            label={`${MONETARY_ACTION_LABELS[action]} limit for ${row.roleName} (dollars)`}
            type="text"
            inputMode="decimal"
            defaultValue={dollars(row.limits[action])}
            hint={
              row.holds[action]
                ? MONETARY_ACTION_HINTS[action]
                : `${row.roleName} cannot ${MONETARY_ACTION_LABELS[action].toLowerCase()} at all, so this figure is inert until they are given that permission. ${MONETARY_ACTION_HINTS[action]}`
            }
          />
        ))}
      </div>

      <div>
        <Button type="submit">Save {row.roleName} limits</Button>
      </div>
    </AdminForm>
  )
}
