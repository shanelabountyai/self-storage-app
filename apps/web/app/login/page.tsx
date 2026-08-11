import type { Metadata } from 'next'
import Link from 'next/link'
import { AdminForm, Field } from '@/components/admin/form'
import { SITE } from '@/lib/site-config'
import { audienceFor } from '@/lib/auth/login-audience'
import { signInWithPasswordAction } from './actions'
import { requestMagicLinkAction } from './magic-link-actions'

export const metadata: Metadata = { title: 'Sign in' }

// PRD 01 US-701. One page, two audiences: proxy.ts redirects a signed-out
// staff visit to `/admin/*` here with `?from=/admin/...`, and the portal
// layout (B-033) does the same for `/portal/*`; a direct visit with no `from`
// defaults to the tenant it is built for (SITE header's "Pay bill" links
// straight here). lib/auth/login-audience.ts owns the inference.

const ERROR_COPY: Record<string, string> = {
  magic_link_invalid: 'That sign-in link is no longer good. It may have expired or already been used.',
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; error?: string }>
}) {
  const { from, error } = await searchParams
  const audience = audienceFor(from)

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-6 py-12">
      <h1 className="text-xl font-semibold">Sign in</h1>

      {error && ERROR_COPY[error] && (
        <p role="alert" className="border-input rounded-md border p-3 text-sm text-pretty">
          {ERROR_COPY[error]}
        </p>
      )}

      <AdminForm action={signInWithPasswordAction} label="Sign in with email and password" className="flex flex-col gap-3">
        {from && <input type="hidden" name="from" value={from} />}
        <Field
          name="email"
          label="Email"
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          className="flex flex-col gap-1 text-sm"
        />
        <Field
          name="password"
          label="Password"
          type="password"
          autoComplete="current-password"
          required
          className="flex flex-col gap-1 text-sm"
        />
        {/* B-079. Always shown for staff, never conditionally revealed after a
            first submit. A reveal-on-demand field would have to answer "does
            this account have MFA?" before anyone had authenticated, which is
            account enumeration; and it would turn every staff sign-in into two
            round trips. Staff who have not enrolled yet leave it blank. */}
        {audience === 'staff' && (
          <Field
            name="code"
            label="Authentication code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            hint="The 6-digit code from your authenticator app, or one of your recovery codes. Leave blank if you have not set up two-factor authentication yet."
            className="flex flex-col gap-1 text-sm"
          />
        )}
        <button
          type="submit"
          className="bg-primary text-primary-foreground mt-1 inline-flex min-h-11 items-center justify-center rounded-md px-4 text-sm font-medium"
        >
          Sign in
        </button>
      </AdminForm>

      <p className="text-sm">
        <Link href={`/forgot-password${from ? `?from=${encodeURIComponent(from)}` : ''}`} className="underline underline-offset-4">
          Forgot your password?
        </Link>
      </p>

      {/* Native disclosure, no client JS needed (§6.2's "works without
          JavaScript" applies to every public/portal-adjacent route, not just
          checkout).

          Tenants only. A magic link signs somebody in on possession of their
          inbox, which is the second factor staff MFA exists to require — so
          lib/auth/flows.ts refuses to mint one for staff, and offering the form
          anyway would just be a button that silently does nothing. */}
      {audience === 'tenant' && (
      <details className="border-input rounded-lg border p-4">
        <summary className="cursor-pointer text-sm font-medium">Email me a sign-in link instead</summary>
        <p className="text-muted-foreground mt-2 text-sm text-pretty">
          No password needed — we will email you a one-tap link that works for 15 minutes.
        </p>
        <AdminForm
          action={requestMagicLinkAction}
          label="Email me a sign-in link"
          className="mt-3 flex flex-col gap-3"
        >
          {from && <input type="hidden" name="from" value={from} />}
          <Field
            name="email"
            label="Email"
            type="email"
            inputMode="email"
            autoComplete="email"
            required
            className="flex flex-col gap-1 text-sm"
          />
          <button
            type="submit"
            className="border-input hover:bg-accent inline-flex min-h-11 items-center justify-center rounded-md border px-4 text-sm font-medium"
          >
            Email me a link
          </button>
        </AdminForm>
      </details>
      )}

      {audience === 'tenant' ? (
        <p className="text-muted-foreground text-sm">
          Staff?{' '}
          <Link href="/login?from=%2Fadmin" className="underline underline-offset-4">
            Sign in here
          </Link>
          .
        </p>
      ) : (
        <p className="text-muted-foreground text-sm">
          Renting with us?{' '}
          <Link href="/login" className="underline underline-offset-4">
            Sign in here
          </Link>
          .
        </p>
      )}

      <p className="text-muted-foreground text-sm text-pretty">
        Need help another way? Call{' '}
        <a href={`tel:${SITE.phone.href}`} className="font-medium underline underline-offset-4">
          {SITE.phone.display}
        </a>{' '}
        during office hours.
      </p>
    </main>
  )
}
