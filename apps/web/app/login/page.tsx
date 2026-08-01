import type { Metadata } from 'next'
import { SITE } from '@/lib/site-config'

export const metadata: Metadata = { title: 'Sign in' }

// Redirect target for role-gated routes, and the destination of the header's
// "Pay bill" button — so this is a customer-reachable page, not an internal one.
// It said "The sign-in screen is built in backlog item B-033" until B-093; D-15
// forbids an internal identifier rendering anywhere a customer can read it, and
// tests/no-internal-identifiers.test.ts now enforces that.
//
// The real sign-in screen (email/password, magic link) is still ahead of us;
// the auth endpoints behind it have worked since B-003.
export default function LoginPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 px-6">
      <h1 className="text-xl font-semibold">Sign in</h1>
      <p className="text-muted-foreground text-sm text-pretty">
        Online bill pay and account access are coming soon. To pay a bill or ask about your
        unit today, call{' '}
        <a href={`tel:${SITE.phone.href}`} className="font-medium underline underline-offset-4">
          {SITE.phone.display}
        </a>{' '}
        during office hours and we will take care of it.
      </p>
    </main>
  )
}
