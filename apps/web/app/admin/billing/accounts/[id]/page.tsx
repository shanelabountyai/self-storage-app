import Link from 'next/link'
import { notFound } from 'next/navigation'
import { AdminForm, Field } from '@/components/admin/form'
import { AnnounceRegion } from '@/components/admin/announce'
import { getAdminActor } from '@/lib/admin/context'
import { hasPermissionAnywhere } from '@/lib/rbac/authorize'
import { accountDetail } from '@/lib/billing/accounts'
import { formatCents } from '@/lib/format'
import { ScrollRegion } from '@/components/ui/scroll-region'
import {
  addMemberAction,
  attachLeaseAction,
  detachLeaseAction,
  removeMemberAction,
} from '../actions'

export const metadata = { title: 'Business account' }

// PRD 01 §9 Phase 3 (B-090 part 5). One account: its units, and its one total.

export default async function BillingAccountPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const actor = await getAdminActor()
  if (!hasPermissionAnywhere(actor, ['billing_accounts:manage', 'reports:financial'])) {
    return (
      <p className="text-muted-foreground text-sm">
        You don&apos;t have access to business accounts.
      </p>
    )
  }

  const account = await accountDetail(actor, id)
  if (!account) notFound()

  const canManage = hasPermissionAnywhere(actor, ['billing_accounts:manage'])

  return (
    <AnnounceRegion className="mb-4">
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <Link
            href="/admin/billing/accounts"
            className="text-muted-foreground text-sm underline underline-offset-2"
          >
            ← All business accounts
          </Link>
          <h1 className="text-lg font-semibold">{account.name}</h1>
          <p className="text-muted-foreground text-sm">
            {account.facilityName} · paid by {account.payerName} ({account.payerEmail})
          </p>
        </div>

        <dl className="flex flex-wrap gap-8 border-y py-4">
          <div>
            <dt className="text-muted-foreground text-xs">Units</dt>
            <dd className="text-base font-semibold">{account.leaseCount}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">Monthly rent</dt>
            <dd className="text-base font-semibold">{formatCents(account.monthlyRateCents)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">Balance now</dt>
            <dd className="text-base font-semibold">{formatCents(account.balanceCents)}</dd>
          </div>
        </dl>

        {account.leases.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No units on this account yet. Add one below and {account.payerName} starts paying for it
            from the next payment they make.
          </p>
        ) : (
          <ScrollRegion aria-label="Units on this account" className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">
                Every unit {account.name} pays for, with the tenant on each lease and what that
                lease owes now.
              </caption>
              <thead>
                <tr className="text-muted-foreground border-b text-left">
                  <th scope="col" className="py-2 pr-4 font-medium">Unit</th>
                  <th scope="col" className="py-2 pr-4 font-medium">Tenant on the lease</th>
                  <th scope="col" className="py-2 pr-4 font-medium">Monthly</th>
                  <th scope="col" className="py-2 pr-4 font-medium">Balance</th>
                  {canManage && (
                    <th scope="col" className="py-2 font-medium">
                      <span className="sr-only">Remove from account</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {account.leases.map((lease) => (
                  <tr key={lease.leaseId} className="border-b">
                    <th scope="row" className="py-2 pr-4 text-left font-medium">
                      {lease.unitNumber}
                    </th>
                    <td className="py-2 pr-4">{lease.tenantName}</td>
                    <td className="py-2 pr-4">{formatCents(lease.monthlyRateCents)}</td>
                    <td className="py-2 pr-4">{formatCents(lease.balanceCents)}</td>
                    {canManage && (
                      <td className="py-2">
                        {/* `announceOutside`: a successful removal revalidates
                            the table, so this row — and any live region inside
                            it — is unmounted in the commit that would have
                            populated it (B-170). */}
                        <AdminForm
                          action={detachLeaseAction}
                          label={`Remove unit ${lease.unitNumber} from ${account.name}`}
                          announceOutside
                        >
                          <input type="hidden" name="accountId" value={account.id} />
                          <input type="hidden" name="leaseId" value={lease.leaseId} />
                          <button
                            type="submit"
                            className="border-input inline-flex h-8 items-center rounded-md border px-3 text-sm font-medium"
                          >
                            Remove
                            <span className="sr-only"> unit {lease.unitNumber} from {account.name}</span>
                          </button>
                        </AdminForm>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row" colSpan={3} className="py-2 pr-4 text-left font-semibold">
                    Total
                  </th>
                  <td className="py-2 pr-4 font-semibold">{formatCents(account.balanceCents)}</td>
                  {canManage && <td />}
                </tr>
              </tfoot>
            </table>
          </ScrollRegion>
        )}

        {/* B-258 / PRD 01 §12. Who may SEE this account. Before this, the only
            way to give the office manager or the bookkeeper sight of it was to
            make them the payer — a money change to solve a visibility problem.
            A member is a tenant record holding no lease, which is the shape the
            payer already is, so nothing here mints an identity. */}
        <section className="flex flex-col gap-4 border-t pt-6">
          <div>
            <h2 className="text-base font-semibold">Who can see this account</h2>
            <p className="text-muted-foreground text-sm text-pretty">
              {account.payerName} sees it as the payer and is the only person who can pay it.
              Anyone added here sees the account&apos;s units and what it owes in their own portal,
              and cannot pay it or see the renters&apos; names.
            </p>
          </div>

          {account.members.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Nobody else can see this account yet.
            </p>
          ) : (
            <ul className="flex max-w-md flex-col gap-2">
              {account.members.map((member) => (
                <li
                  key={member.tenantId}
                  className="flex flex-wrap items-center justify-between gap-2 border-b pb-2 text-sm"
                >
                  <span>
                    {member.name}{' '}
                    <span className="text-muted-foreground">({member.email})</span>
                  </span>
                  {canManage && (
                    // `announceOutside` for the same reason the unit rows use
                    // it: a successful removal revalidates this list, so the
                    // row is unmounted in the commit that would have populated
                    // a live region inside it (B-170).
                    <AdminForm
                      action={removeMemberAction}
                      label={`Remove ${member.name} from ${account.name}`}
                      announceOutside
                    >
                      <input type="hidden" name="accountId" value={account.id} />
                      <input type="hidden" name="tenantId" value={member.tenantId} />
                      <button
                        type="submit"
                        className="border-input inline-flex h-8 items-center rounded-md border px-3 text-sm font-medium"
                      >
                        Remove
                        <span className="sr-only">
                          {' '}
                          {member.name}&apos;s access to {account.name}
                        </span>
                      </button>
                    </AdminForm>
                  )}
                </li>
              ))}
            </ul>
          )}

          {canManage && (
            <AdminForm
              action={addMemberAction}
              label={`Give somebody access to ${account.name}`}
              className="flex max-w-md flex-col gap-4"
            >
              <input type="hidden" name="accountId" value={account.id} />
              <Field
                name="email"
                label="Email address"
                type="email"
                required
                hint="Somebody who is already a tenant here. They see the account when they sign in to the portal; they cannot pay it."
              />
              <button
                type="submit"
                className="border-input inline-flex h-9 items-center self-start rounded-md border px-4 text-sm font-medium"
              >
                Give access
              </button>
            </AdminForm>
          )}
        </section>

        {canManage && (
          <AdminForm
            action={attachLeaseAction}
            label={`Add a unit to ${account.name}`}
            className="flex max-w-md flex-col gap-4 border-t pt-6"
          >
            <h2 className="text-base font-semibold">Add a unit</h2>
            <input type="hidden" name="accountId" value={account.id} />
            <Field
              name="unitNumber"
              label="Unit number"
              required
              hint={`An occupied unit at ${account.facilityName}. Its lease and its tenant do not change — only who pays.`}
            />
            <button
              type="submit"
              className="bg-primary text-primary-foreground inline-flex h-9 items-center self-start rounded-md px-4 text-sm font-medium"
            >
              Add unit
            </button>
          </AdminForm>
        )}
      </div>
    </AnnounceRegion>
  )
}
