import { redirect } from 'next/navigation'
import { ForbiddenError } from '@/lib/rbac/authorize'
import { needsMfaEnrollment } from '@/lib/auth/mfa'
import { groupedNavItems } from '@/lib/admin/nav'
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

  // PRD 00 §7.1 (B-079): "Staff auth requires MFA (TOTP) from Phase 2."
  //
  // Enforced here rather than at sign-in, because a staff member who has not
  // enrolled has no second factor to present and refusing the sign-in would
  // leave a new hire with no way to ever get one. They authenticate, and then
  // reach exactly one screen until they enrol.
  //
  // Read from the database on every admin request rather than from a claim on
  // the JWT: a claim minted at sign-in would still say "enrolled" for the
  // remaining thirty days of a session after an administrator reset somebody's
  // second factor, which is precisely the case a reset exists to handle.
  if (actor.kind === 'staff' && (await needsMfaEnrollment(actor.staffUserId))) {
    redirect('/mfa')
  }

  const navGroups = groupedNavItems(actor)

  return (
    // B-112. The admin density. `CONTROL_CLASS` defaults to §6.2's 44px
    // consumer target, which is right on a phone and wrong on a settings screen
    // with forty rows worked at a desk all day. Set here rather than passed
    // down, so nothing between this layout and an <input> has to know, and so a
    // new admin screen inherits it without opting in.
    <div className="flex min-h-screen flex-col" style={{ '--control-h': '2.25rem' } as React.CSSProperties}>
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
        <SideNav groups={navGroups} />
        {/* B-116. `contain: layout` (Tailwind's arbitrary-property syntax)
            is load-bearing, not decoration. Units, unit types and settings all
            carry a table wrapped in `overflow-x-auto` — correctly clipped and
            independently scrollable, `wrapper.scrollWidth` vs `clientWidth`
            proves it — and yet `document.documentElement.scrollWidth` still
            read the TABLE's full unclipped width at 320px, failing the same
            reflow check that already passes on every route with no nested
            scroll container. Chromium's root-level scrollWidth walks into a
            descendant's own scroll region when computing the page's overflow,
            even though that region visually clips its content on its own.
            `contain: layout` makes this box an independent containing block,
            which stops that walk at its boundary — verified by toggling it on
            a live page and watching scrollWidth drop from 585 to 320 with
            nothing else changed. `min-w-0` stays alongside it: harmless, and
            it is the fix for the OTHER classic flex-child bug this shape
            invites (a flex item's default `min-width: auto` refusing to
            shrink below its content's intrinsic width at all). */}
        <main id="main" tabIndex={-1} className="min-w-0 flex-1 p-6 [contain:layout]">
          {children}
        </main>
      </div>
    </div>
  )
}
