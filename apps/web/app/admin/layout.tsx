import { redirect } from 'next/navigation'
import { ForbiddenError } from '@/lib/rbac/authorize'
import { visibleNavItems } from '@/lib/admin/nav'
import { getSwitcherData } from '@/lib/admin/context'
import { Header } from '@/components/admin/header'
import { SideNav } from '@/components/admin/side-nav'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  let switcherData: Awaited<ReturnType<typeof getSwitcherData>>
  try {
    switcherData = await getSwitcherData()
  } catch (error) {
    // requireStaffActor() throws for "no session" and "wrong audience" alike —
    // middleware.ts already redirects those, but this is the fail-closed
    // backstop if a request ever reaches here without it (PRD 02 RBAC-1).
    if (error instanceof ForbiddenError) redirect('/login')
    throw error
  }

  const { actor, userName, facilities, cookieValue, canSeeAll } = switcherData
  const navItems = visibleNavItems(actor)

  return (
    <div className="flex min-h-screen flex-col">
      <Header
        userName={userName}
        facilities={facilities}
        cookieValue={cookieValue}
        canSeeAll={canSeeAll}
      />
      <div className="flex flex-1">
        <SideNav items={navItems} />
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  )
}
