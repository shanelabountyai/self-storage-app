import Link from 'next/link'
import { AdminForm, Field } from '@/components/admin/form'
import { AnnounceRegion } from '@/components/admin/announce'
import { getSwitcherData } from '@/lib/admin/context'
import { resolveSelectedFacility } from '@/lib/admin/facility-selection-logic'
import { hasPermissionAnywhere } from '@/lib/rbac/authorize'
import { accountsFor } from '@/lib/billing/accounts'
import { formatCents } from '@/lib/format'
import { ScrollRegion } from '@/components/ui/scroll-region'
import { createAccountAction } from './actions'

export const metadata = { title: 'Business accounts' }

// PRD 01 §9 Phase 3 (B-090 part 5). Who pays for which units.
//
// The screen exists because the alternative control was a database client: a
// column that decides where a commercial customer's money lands is exactly the
// kind this repo has shipped unreachable before and had to go back for.

export default async function BillingAccountsPage() {
  const { actor, facilities, cookieValue, canSeeAll } = await getSwitcherData()
  const selected = resolveSelectedFacility(cookieValue, facilities, canSeeAll)

  if (selected.mode !== 'single') {
    return (
      <p className="text-muted-foreground text-sm">
        Pick a specific facility above — an account pays for units at one site, because a payment
        belongs to one facility&apos;s drawer and one facility&apos;s books.
      </p>
    )
  }
  if (!hasPermissionAnywhere(actor, ['billing_accounts:manage', 'reports:financial'])) {
    return (
      <p className="text-muted-foreground text-sm">
        You don&apos;t have access to business accounts.
      </p>
    )
  }

  const canManage = hasPermissionAnywhere(actor, ['billing_accounts:manage'])
  const accounts = await accountsFor(actor, selected.facility.id)

  return (
    <AnnounceRegion className="mb-4">
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <h1 className="text-lg font-semibold">Business accounts</h1>
          <p className="text-muted-foreground max-w-prose text-sm text-pretty">
            A business account is one payer for several units. Each unit keeps its own lease and its
            own invoice — that is what a lien notice and a late fee are raised against — but the
            payer settles all of them with one payment, and sees one total.
          </p>
        </div>

        {accounts.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No business accounts at {selected.facility.name} yet.
          </p>
        ) : (
          <ScrollRegion aria-label="Business accounts" className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">
                Business accounts at {selected.facility.name}, with the units each pays for and what
                it owes now.
              </caption>
              <thead>
                <tr className="text-muted-foreground border-b text-left">
                  <th scope="col" className="py-2 pr-4 font-medium">Account</th>
                  <th scope="col" className="py-2 pr-4 font-medium">Payer</th>
                  <th scope="col" className="py-2 pr-4 font-medium">Units</th>
                  <th scope="col" className="py-2 pr-4 font-medium">Monthly</th>
                  <th scope="col" className="py-2 font-medium">Balance</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((account) => (
                  <tr key={account.id} className="border-b">
                    <th scope="row" className="py-2 pr-4 text-left font-medium">
                      <Link
                        href={`/admin/billing/accounts/${account.id}`}
                        className="underline underline-offset-2"
                      >
                        {account.name}
                      </Link>
                    </th>
                    <td className="py-2 pr-4">
                      {account.payerName}
                      <span className="text-muted-foreground block text-xs">
                        {account.payerEmail}
                      </span>
                    </td>
                    <td className="py-2 pr-4">{account.leaseCount}</td>
                    <td className="py-2 pr-4">{formatCents(account.monthlyRateCents)}</td>
                    <td className="py-2">{formatCents(account.balanceCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollRegion>
        )}

        {canManage && (
          <AdminForm
            action={createAccountAction}
            label="Create a business account"
            className="flex max-w-md flex-col gap-4 border-t pt-6"
          >
            <h2 className="text-base font-semibold">Create an account</h2>
            <input type="hidden" name="facilityId" value={selected.facility.id} />
            <Field
              name="name"
              label="Account name"
              required
              maxLength={120}
              hint="What you call the payer — “Acme Contracting”, not the person who signs."
            />
            <Field
              name="payerEmail"
              label="Payer’s email"
              type="email"
              required
              hint="An existing tenant here. They pay the account’s units and can see their balances, so they have to be someone you have already taken on."
            />
            <button
              type="submit"
              className="bg-primary text-primary-foreground inline-flex h-9 items-center self-start rounded-md px-4 text-sm font-medium"
            >
              Create account
            </button>
          </AdminForm>
        )}
      </div>
    </AnnounceRegion>
  )
}
