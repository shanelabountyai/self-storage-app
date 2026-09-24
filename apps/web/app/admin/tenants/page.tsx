import Link from 'next/link'
import { DataTable } from '@/components/ui/data-table'
import { getSwitcherData } from '@/lib/admin/context'
import { resolveSelectedFacility } from '@/lib/admin/facility-selection-logic'
import { hasPermissionAnywhere } from '@/lib/rbac/authorize'
import { searchTenants, TENANT_SEARCH_LIMIT } from '@/lib/admin/tenants'
import {
  isTenantFilter,
  listTenants,
  TENANT_FILTERS,
  TENANT_FILTER_LABELS,
  type TenantFilter,
} from '@/lib/admin/tenant-list'
import { formatCents } from '@/lib/format'
import { ContactLinks } from '@/components/admin/contact-links'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { ScrollRegion } from '@/components/ui/scroll-region'

export const metadata = { title: 'Tenants' }

const STATUS_TONE: Record<string, 'success' | 'warning' | 'danger'> = {
  Active: 'success',
  'Past due': 'warning',
  'Pending auction': 'danger',
}

// PRD 02 §4.4 US-13, §5.5 FR-22/FR-23.
//
// B-114 gave this screen a list. It was a heading, a search box and nothing
// else until you typed — so the one screen named after tenants answered none of
// "who are my tenants", "who owes me money" or "who moved in this week", and
// every past-due question routed through Reports.
//
// The search is unchanged and still a GET, so a result is linkable. What is new
// is that arriving with no query is now an answer rather than an empty page.

function pageHref(filter: TenantFilter, page: number, facilityId?: string): string {
  const params = new URLSearchParams()
  if (filter !== 'all') params.set('filter', filter)
  if (page > 1) params.set('page', String(page))
  if (facilityId) params.set('facility', facilityId)
  const query = params.toString()
  return query ? `/admin/tenants?${query}` : '/admin/tenants'
}

export default async function TenantsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; filter?: string; page?: string; facility?: string }>
}) {
  const { q, filter: filterParam, page: pageParam, facility: facilityParam } = await searchParams
  const { actor, facilities, cookieValue, canSeeAll } = await getSwitcherData()
  const requested = facilityParam ? facilities.find((f) => f.id === facilityParam) : undefined
  const selected = requested
    ? { mode: 'single' as const, facility: requested }
    : resolveSelectedFacility(cookieValue, facilities, canSeeAll)

  const filter: TenantFilter = isTenantFilter(filterParam) ? filterParam : 'all'
  const page = Number.parseInt(pageParam ?? '1', 10) || 1
  const facilityId = selected.mode === 'single' ? selected.facility.id : undefined

  const results = q ? await searchTenants(actor, q) : []
  // Not fetched at all while searching: the list is what you get when you have
  // not asked for something specific.
  const list = q ? null : await listTenants(actor, { facilityId, filter, page })

  const from = list && list.total > 0 ? (list.page - 1) * list.pageSize + 1 : 0
  const to = list ? Math.min(list.page * list.pageSize, list.total) : 0
  const lastPage = list ? Math.max(1, Math.ceil(list.total / list.pageSize)) : 1

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold tracking-tight">
          Tenants{selected.mode === 'single' ? ` — ${selected.facility.name}` : ''}
        </h1>
        {hasPermissionAnywhere(actor, ['tenants:edit']) && (
          <Link
            href="/admin/tenants/new"
            className="bg-primary text-primary-foreground inline-flex min-h-11 items-center rounded-md px-4 text-sm font-medium"
          >
            Add a tenant
          </Link>
        )}
      </div>

      <form method="GET" role="search" className="flex flex-wrap items-end gap-2">
        <label htmlFor="q" className="flex flex-col gap-1 text-sm">
          Name, phone, email, or unit number
          <input
            id="q"
            name="q"
            type="text"
            defaultValue={q ?? ''}
            className="border-input bg-background h-(--control-h,2.75rem) w-72 rounded-md border px-2"
          />
        </label>
        <button
          type="submit"
          className="bg-primary text-primary-foreground inline-flex min-h-11 items-center rounded-md px-4 text-sm font-medium"
        >
          Search
        </button>
        {q && (
          <Link href={pageHref('all', 1, facilityParam)} className="text-sm underline underline-offset-2">
            Clear
          </Link>
        )}
      </form>

      {/* Links, not buttons: §5.5 FR-22 wants a view somebody can send to a
          colleague, and a filter held in client state is not one. */}
      {!q && (
        <nav aria-label="Filter tenants" className="flex flex-wrap gap-2">
          {TENANT_FILTERS.map((option) => {
            const current = option === filter
            return (
              <Link
                key={option}
                href={pageHref(option, 1, facilityParam)}
                aria-current={current ? 'page' : undefined}
                className={
                  current
                    ? 'bg-primary text-primary-foreground inline-flex min-h-11 items-center rounded-full px-4 text-sm font-semibold'
                    : 'border-input hover:bg-accent inline-flex min-h-11 items-center rounded-full border px-4 text-sm'
                }
              >
                {TENANT_FILTER_LABELS[option]}
                {list && <span className="ml-1.5 font-mono text-xs tabular-nums">{list.counts[option]}</span>}
              </Link>
            )
          })}
        </nav>
      )}

      {q && results.length === 0 && (
        <EmptyState>No tenants match &ldquo;{q}&rdquo;.</EmptyState>
      )}

      {/* A capped search that says nothing is a search that lies: the tenant
          somebody is looking for may be the twenty-sixth match, and twenty
          suites in this repo seed a tenant called "Ada Renter". */}
      {q && results.length >= TENANT_SEARCH_LIMIT && (
        <Alert tone="info" role="status">
          Showing the first {TENANT_SEARCH_LIMIT} matches for &ldquo;{q}&rdquo;. There may be more —
          add a last name, a unit number or a phone number to narrow it down.
        </Alert>
      )}

      {q && results.length > 0 && (
        <DataTable>
          <caption className="sr-only">Tenants matching &ldquo;{q}&rdquo;</caption>
          <DataTable.Head>
            <tr>
              <th scope="col" className="px-3 py-2 font-semibold">
                Name
              </th>
              <th scope="col" className="px-3 py-2 font-semibold">
                Contact
              </th>
              <th scope="col" className="px-3 py-2 font-semibold">
                Units
              </th>
            </tr>
          </DataTable.Head>
          <tbody>
            {results.map((tenant) => (
              <DataTable.Row key={tenant.tenantId} className="border-b">
                <td className="px-3 py-2">
                  <Link
                    href={`/admin/tenants/${tenant.tenantId}`}
                    className="underline underline-offset-2"
                  >
                    {tenant.name}
                  </Link>
                </td>
                <td className="px-3 py-2">
                  {/* D-111: a renter may have no address, and a blank cell
                      reads as a column that failed to load rather than as a
                      fact. Said in words — and it is the fact staff most need
                      here, since it is why this tenant gets no receipt and no
                      dunning email. */}
                  {tenant.email ? (
                    <div>{tenant.email}</div>
                  ) : (
                    <div className="text-muted-foreground">No email address</div>
                  )}
                  {tenant.phone && <div className="text-muted-foreground">{tenant.phone}</div>}
                </td>
                <td className="px-3 py-2">
                  {tenant.units.length === 0
                    ? '—'
                    : tenant.units.map((u) => `${u.facilityName} — ${u.unitNumber}`).join(', ')}
                </td>
              </DataTable.Row>
            ))}
          </tbody>
        </DataTable>
      )}

      {list && list.total === 0 && (
        <EmptyState>
          {filter === 'all'
            ? 'No tenants here yet.'
            : `No tenants match “${TENANT_FILTER_LABELS[filter]}”.`}
        </EmptyState>
      )}

      {list && list.total > 0 && (
        <>
          <p className="text-muted-foreground text-sm" role="status">
            Showing {from}–{to} of {list.total}
          </p>

          <ScrollRegion aria-label="Tenants">
            <DataTable className="min-w-2xl">
              <caption className="sr-only">
                Tenants, newest lease first, filtered to {TENANT_FILTER_LABELS[filter]}
              </caption>
              <DataTable.Head>
                <tr>
                  <th scope="col" className="px-3 py-2 font-semibold">
                    Name
                  </th>
                  <th scope="col" className="px-3 py-2 font-semibold">
                    Facility &amp; unit
                  </th>
                  <th scope="col" className="px-3 py-2 font-semibold">
                    Reach
                  </th>
                  <th scope="col" className="px-3 py-2 font-semibold">
                    Lease
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">
                    Balance
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">
                    Days past due
                  </th>
                </tr>
              </DataTable.Head>
              <tbody>
                {list.rows.map((row) => {
                  const late = row.daysPastDue > 0 && row.balanceCents > 0
                  return (
                    <DataTable.Row key={row.tenantId} className="border-b">
                      <th scope="row" className="px-3 py-2 text-left font-normal">
                        <Link
                          href={`/admin/tenants/${row.tenantId}`}
                          className="font-medium underline underline-offset-2"
                        >
                          {row.name}
                        </Link>
                      </th>
                      <td className="px-3 py-2 text-sm">
                        {row.units.length === 0
                          ? '—'
                          : row.units
                              .map((unit) => `${unit.facilityName} — ${unit.unitNumber}`)
                              .join(', ')}
                      </td>
                      <td className="px-3 py-2">
                        <ContactLinks name={row.name} phone={row.phone} />
                      </td>
                      <td className="px-3 py-2">
                        <Badge tone={STATUS_TONE[row.statusLabel] ?? 'neutral'}>{row.statusLabel}</Badge>
                      </td>
                      <td className={`px-3 py-2 text-right font-mono tabular-nums ${late ? 'text-destructive font-semibold' : ''}`}>
                        {formatCents(row.balanceCents)}
                      </td>
                      {/* 1.4.1: the state is in words. A row tinted amber and
                          nothing else is invisible to anyone who cannot see the
                          tint, and this is the column somebody acts on. */}
                      <td className="px-3 py-2 text-right tabular-nums">
                        {late ? (
                          <span className="font-medium text-warning-fg">
                            {row.daysPastDue} days past due
                          </span>
                        ) : (
                          <span className="text-muted-foreground">Current</span>
                        )}
                      </td>
                    </DataTable.Row>
                  )
                })}
              </tbody>
            </DataTable>
          </ScrollRegion>

          {lastPage > 1 && (
            <nav aria-label="Pages" className="flex flex-wrap items-center gap-3 text-sm">
              {list.page > 1 && (
                <Link
                  href={pageHref(filter, list.page - 1, facilityParam)}
                  className="underline underline-offset-2"
                >
                  Previous
                </Link>
              )}
              <span className="text-muted-foreground">
                Page {list.page} of {lastPage}
              </span>
              {list.page < lastPage && (
                <Link
                  href={pageHref(filter, list.page + 1, facilityParam)}
                  className="underline underline-offset-2"
                >
                  Next
                </Link>
              )}
            </nav>
          )}
        </>
      )}
    </div>
  )
}
