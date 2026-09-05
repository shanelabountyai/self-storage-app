import Link from 'next/link'
import { redirect } from 'next/navigation'
import { auth, signOut } from '@/auth'
import { requireTenantActor } from '@/lib/rbac/session'
import { hasAnyPaymentPlan } from '@/lib/portal/payment-plan'
import { owingLeases } from '@/lib/portal/dashboard'
import { formatRate } from '@/lib/format'
import { PortalNav } from '@/components/portal/portal-nav'
import { ForbiddenError } from '@/lib/rbac/authorize'
import { currentImpersonation, hasStaleImpersonationCookie } from '@/lib/impersonation/context'
import { ImpersonationBanner } from '@/components/impersonation/banner'
import { LocaleProvider } from '@/components/i18n/locale-provider'
import { LanguageToggle } from '@/components/site/language-toggle'
import { dictionaryFor, translate } from '@/lib/i18n'
import { getLocale, getLocalePath } from '@/lib/i18n/server'

// PRD 01 §4.7 US-701. The portal shell: every route under here requires a
// signed-in tenant. proxy.ts already redirects a signed-out visit before this
// ever renders; this is the fail-closed backstop if a request ever reaches
// here without it (the same posture apps/web/app/admin/layout.tsx takes).
//
// B-034 (portal dashboard) fills in what actually renders past this point —
// this item ships the login that gets someone here and the gate that keeps
// anyone else out, not the dashboard itself.
export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  // PRD 09 FR-22 (B-091 part 2). A staff member impersonating a tenant lands
  // here, and `requireTenantActor()` succeeds for them because
  // `currentActor()` has already swapped in the subject.
  const impersonation = await currentImpersonation()
  // B-260 (D-122). B-090f translated the move-in path and sent the renter here
  // with "Ir a mi cuenta" — into an English account. The portal is outside the
  // `(public)` route group, so it inherits neither the provider nor the
  // toggle; both are mounted here for the same reasons they are mounted there.
  const [locale, path] = await Promise.all([getLocale(), getLocalePath()])
  const dict = dictionaryFor(locale)
  const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>) =>
    translate(dict, key, vars)

  let tenantId: string
  try {
    tenantId = (await requireTenantActor()).tenantId
  } catch (error) {
    if (error instanceof ForbiddenError) {
      // Sending a staff member to /login would be a lie and a dead end — they
      // are signed in. This is the session having ended under them mid-browse,
      // so clear the inert cookie on the way back to the admin.
      redirect((await hasStaleImpersonationCookie()) ? '/api/impersonation/end' : '/login')
    }
    throw error
  }

  const session = await auth()
  // B-193 / SC 2.4.5 Multiple Ways (AA). /portal/payment-plan was reachable
  // from the dashboard card alone, and that card renders only while a plan is
  // live — so a tenant whose plan broke last night had no route to the
  // schedule stating what they agreed, at the moment they most need to read
  // it. Conditional rather than permanent for everyone: B-117 cut this row
  // down to four links because nine wrapped to four lines at 360px, and a
  // fifth belongs there only for the tenants it is about.
  const showPaymentPlan = await hasAnyPaymentPlan(tenantId)
  const userName =
    impersonation?.subjectName ?? session?.user?.name ?? t('portal.yourAccountFallback')

  // B-239. Paying was reachable only from the lease card on Overview, so the
  // one thing collections depends on had no permanent route while Move out —
  // the only irreversible destination in the product — held a top-level slot.
  //
  // The amount is on the control, not merely implied by it: "Pay $487.50" is
  // the whole of what a past-due tenant came here to find out. Several owing
  // leases go to Overview rather than to `/portal/pay`, which takes exactly one
  // lease — Overview already renders a "Pay $X now" per unit, so it is the
  // chooser, and the total is still the honest figure to put on the link.
  const owing = await owingLeases(tenantId)
  const owedCents = owing.reduce((sum, lease) => sum + lease.balanceCents, 0)
  const pay =
    owing.length === 0
      ? null
      : {
          href: owing.length === 1 ? `/portal/pay?lease=${owing[0].leaseId}` : '/portal',
          label: t('portal.pay', { amount: formatRate(owedCents) }),
        }

  return (
    <LocaleProvider locale={locale} dict={dict}>
      <div className="flex min-h-screen flex-col">
      <ImpersonationBanner />
      <a
        href="#main"
        className="bg-background focus:ring-ring sr-only rounded-md px-4 py-2 text-sm font-medium focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:ring-2"
      >
        {t('chrome.skipToMain')}
      </a>

      <header className="border-b">
        <div className="mx-auto flex w-full max-w-4xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
          <span className="mr-auto text-sm font-medium">{userName}</span>
          {/* B-239. The nav moved into a client component so it can read
              `usePathname()` — see the note there for what changed and why.
              What stays here is the DATA: which links to show, and what the
              Pay action points at. */}
          <PortalNav pay={pay} showPaymentPlan={showPaymentPlan} />

          {/* B-260. Last in the header, as on the public site — a preference
              rather than a destination. It sits INSIDE the portal shell and not
              only on the public one because a tenant who set Spanish while
              renting has no other way to change it back once they are signed
              in, and the checkout hands them straight here. */}
          <LanguageToggle locale={locale} path={path} />
          {/* FR-13's courtesy half. Hiding is not the control — the write
              block in proxy.ts refuses the POST either way — but "Sign out"
              during a support session would sign the STAFF member out of their
              own account from inside somebody else's portal, which is not what
              it appears to offer. The banner's "Return to my account" is the
              exit that belongs here. */}
          {!impersonation && (
            <form
              action={async () => {
                'use server'
                await signOut({ redirectTo: '/login' })
              }}
            >
              <button type="submit" className="text-sm underline underline-offset-2">
                {t('portal.signOut')}
              </button>
            </form>
          )}
        </div>
      </header>

      <main
        id="main"
        tabIndex={-1}
        // B-239 / SC 1.4.10 Reflow. The sticky pay bar is `position: fixed`, so
        // it is out of flow and would sit ON TOP of the last thing on the page
        // at 320px — where the last thing is often the "call the office"
        // number. The padding is the reflow fix, and it exists only while the
        // bar does.
        className={`mx-auto w-full max-w-4xl flex-1 p-6 ${pay ? 'pb-24 sm:pb-6' : ''}`}
      >
        {children}
      </main>

      {/* B-239. The phone-only half. A past-due tenant reads this product on a
          phone, and on a phone the nav row scrolls off the top — so the pay
          action is pinned instead of merely present. LAST in the DOM on
          purpose (SC 2.4.3): a keyboard user meets it after the page content
          rather than being teleported to a fixed element mid-page, and the nav
          link above is the route they reach first. `sm:hidden` because at
          desktop width the nav never leaves the viewport's top. */}
      {pay && (
        <div className="bg-background fixed inset-x-0 bottom-0 border-t p-3 sm:hidden">
          <Link
            href={pay.href}
            className="bg-primary text-primary-foreground flex min-h-11 items-center justify-center rounded-md px-4 text-sm font-medium"
          >
            {pay.label}
          </Link>
        </div>
      )}
      </div>
    </LocaleProvider>
  )
}
