import { notFound } from 'next/navigation'
import { getAdminActor } from '@/lib/admin/context'
import { hasPermissionAnywhere } from '@/lib/rbac/authorize'
import { navItemForSection } from '@/lib/admin/nav'

// One dynamic route for every nav destination that doesn't have its own
// backlog item yet, rather than ten near-identical placeholder folders.
// Permission is re-checked here, not just used to hide the nav link — nav
// visibility is UX, this is the actual gate (PRD 02 RBAC-1: server-side on
// every endpoint).
export default async function AdminSectionPage({
  params,
}: {
  params: Promise<{ section: string }>
}) {
  const { section } = await params
  const item = navItemForSection(section)
  if (!item) notFound()

  const actor = await getAdminActor()
  if (item.anyOf && !hasPermissionAnywhere(actor, item.anyOf)) {
    return (
      <p className="text-muted-foreground text-sm">
        You don&apos;t have access to {item.label}.
      </p>
    )
  }

  return (
    <div>
      <h1 className="text-lg font-semibold">{item.label}</h1>
      <p className="text-muted-foreground mt-2 text-sm">
        This screen is built in a later backlog item. The shell and role-gating
        around it are live.
      </p>
    </div>
  )
}
