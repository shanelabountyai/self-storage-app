import Link from 'next/link'
import { redirect } from 'next/navigation'
import { auth, signOut } from '@/auth'
import { requireTenantActor } from '@/lib/rbac/session'
import { ForbiddenError } from '@/lib/rbac/authorize'

// PRD 01 §4.7 US-701. The portal shell: every route under here requires a
// signed-in tenant. proxy.ts already redirects a signed-out visit before this
// ever renders; this is the fail-closed backstop if a request ever reaches
// here without it (the same posture apps/web/app/admin/layout.tsx takes).
//
// B-034 (portal dashboard) fills in what actually renders past this point —
// this item ships the login that gets someone here and the gate that keeps
// anyone else out, not the dashboard itself.
export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  try {
    await requireTenantActor()
  } catch (error) {
    if (error instanceof ForbiddenError) redirect('/login')
    throw error
  }

  const session = await auth()
  const userName = session?.user?.name ?? 'your account'

  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#main"
        className="bg-background focus:ring-ring sr-only rounded-md px-4 py-2 text-sm font-medium focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:ring-2"
      >
        Skip to main content
      </a>

      <header className="border-b">
        <div className="mx-auto flex w-full max-w-4xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
          <span className="mr-auto text-sm font-medium">{userName}</span>
          {/* B-117 (UX review 2026-08-12, finding 16). Nine links in one flat
              row wrapped to four lines above the balance at 360px. Ordered by
              how often somebody actually comes here — the four a tenant
              checks routinely stay one tap away; the four that are a once-a-
              while errand sit behind Manage; Move out is separated on its
              own, because it is the one irreversible destination in the
              list and does not belong beside "check my statement." */}
          <nav aria-label="Your account" className="flex flex-wrap items-center gap-4 text-sm">
            <Link href="/portal" className="underline underline-offset-2">
              Overview
            </Link>
            <Link href="/portal/methods" className="underline underline-offset-2">
              Payment methods
            </Link>
            <Link href="/portal/statements" className="underline underline-offset-2">
              Statements
            </Link>
            <Link href="/portal/documents" className="underline underline-offset-2">
              Documents
            </Link>
            <details className="text-sm">
              <summary className="inline-flex min-h-11 cursor-pointer items-center underline underline-offset-2">
                Manage
              </summary>
              <div className="flex flex-col gap-2 pt-2">
                <Link href="/portal/access" className="underline underline-offset-2">
                  Who can get in
                </Link>
                <Link href="/portal/protection" className="underline underline-offset-2">
                  Protection
                </Link>
                <Link href="/portal/contact" className="underline underline-offset-2">
                  Contact details
                </Link>
                <Link href="/portal/notifications" className="underline underline-offset-2">
                  Notifications
                </Link>
                <Link href="/portal/refer" className="underline underline-offset-2">
                  Refer a friend
                </Link>
              </div>
            </details>
            <span aria-hidden="true" className="border-muted-foreground/40 h-4 border-l" />
            <Link href="/portal/move-out" className="underline underline-offset-2">
              Move out
            </Link>
          </nav>
          <form
            action={async () => {
              'use server'
              await signOut({ redirectTo: '/login' })
            }}
          >
            <button type="submit" className="text-sm underline underline-offset-2">
              Sign out
            </button>
          </form>
        </div>
      </header>

      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-4xl flex-1 p-6">
        {children}
      </main>
    </div>
  )
}
