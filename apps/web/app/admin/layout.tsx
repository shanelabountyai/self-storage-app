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
      {/* WCAG 2.4.1 Bypass Blocks. Without this a keyboard or switch user tabs
          the facility switcher, the search, the bell, the user menu, sign-out
          and every nav item — on EVERY page load — before reaching content.
          The public layout has had one since B-013; admin was built first and
          never got it, and master PRD §7.2 puts admin surfaces in scope. */}
      <a
        href="#main"
        className="bg-background focus:ring-ring sr-only rounded-md px-4 py-2 text-sm font-medium focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:ring-2"
      >
        Skip to main content
      </a>

      <Header
        userName={userName}
        facilities={facilities}
        cookieValue={cookieValue}
        canSeeAll={canSeeAll}
      />
      <div className="flex flex-1 flex-col sm:flex-row">
        <SideNav items={navItems} />
        <main id="main" tabIndex={-1} className="flex-1 p-6">
          {children}
        </main>
      </div>
    </div>
  )
}
