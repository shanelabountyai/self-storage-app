import Link from 'next/link'
import { getAdminActor } from '@/lib/admin/context'
import { searchTenants } from '@/lib/admin/tenants'

export const metadata = { title: 'Tenants' }

// PRD 02 §4.4 US-13. Name, phone, email, or unit number, partial match — a
// GET so it is linkable and re-runnable rather than a client-only fetch.

export default async function TenantsSearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  const { q } = await searchParams
  const actor = await getAdminActor()
  const results = q ? await searchTenants(actor, q) : []

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold">Tenants</h1>

      <form method="GET" role="search" className="flex flex-wrap items-end gap-2">
        <label htmlFor="q" className="flex flex-col gap-1 text-sm">
          Name, phone, email, or unit number
          <input
            id="q"
            name="q"
            type="text"
            defaultValue={q ?? ''}
            className="border-input bg-background h-9 w-72 rounded-md border px-2"
          />
        </label>
        <button
          type="submit"
          className="bg-primary text-primary-foreground inline-flex h-9 items-center rounded-md px-4 text-sm font-medium"
        >
          Search
        </button>
      </form>

      {q && results.length === 0 && (
        <p className="text-muted-foreground text-sm">No tenants match &ldquo;{q}&rdquo;.</p>
      )}

      {results.length > 0 && (
        <table className="w-full text-sm">
          <caption className="sr-only">Tenants matching &ldquo;{q}&rdquo;</caption>
          <thead>
            <tr className="border-b text-left">
              <th scope="col" className="py-2 font-medium">
                Name
              </th>
              <th scope="col" className="py-2 font-medium">
                Contact
              </th>
              <th scope="col" className="py-2 font-medium">
                Units
              </th>
            </tr>
          </thead>
          <tbody>
            {results.map((tenant) => (
              <tr key={tenant.tenantId} className="border-b">
                <td className="py-2">
                  <Link href={`/admin/tenants/${tenant.tenantId}`} className="underline underline-offset-2">
                    {tenant.name}
                  </Link>
                </td>
                <td className="py-2">
                  <div>{tenant.email}</div>
                  {tenant.phone && <div className="text-muted-foreground">{tenant.phone}</div>}
                </td>
                <td className="py-2">
                  {tenant.units.length === 0
                    ? '—'
                    : tenant.units.map((u) => `${u.facilityName} — ${u.unitNumber}`).join(', ')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
