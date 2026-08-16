import type { Metadata } from 'next'
import Link from 'next/link'
import { AdminForm, Field } from '@/components/admin/form'
import { SITE } from '@/lib/site-config'
import { audienceFor, audienceHint } from '@/lib/auth/login-audience'
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
  // B-108(3). What we actually know, which at a bare `/login` is NOTHING —
  // `audienceFor` defaults to tenant because a redirect target must exist, and
  // that default is wrong for deciding what to render. `audienceHint` is the
  // honest reading and returns null when nobody told us.
  const hint = audienceHint(from)

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
        {/* B-079, corrected by B-108(3). Rendered for staff AND for a visitor
            we know nothing about — hidden only when `?from=` positively says
            tenant.

            The bug this fixes: the field keyed off `audienceFor`, which
            defaults to TENANT when there is no `?from=`. So an enrolled staff
            member reaching a bare `/login` — a bookmark, a typed address, a
            sign-out — got no code field, submitted without one, and was
            refused. That is the "correct password rejected" symptom D-47
            exists to kill, arriving by a different route.

            Of the two shapes the row offers, this is the one taken: always
            render it, with the hint that already covered the not-enrolled
            case. The alternative — a two-step "email, then code" — would turn
            every sign-in into two round trips, and B-079's original comment
            rejects exactly that.

            It leaks nothing. The form is byte-identical whether or not the
            address exists, whether or not it is staff, and whether or not MFA
            is enrolled: there is no branch here that an attacker could observe.
            Reveal-on-demand would have been the enumeration risk, which is why
            it is not what "always render" means here. */}
        {hint !== 'tenant' && (
          <Field
            name="code"
            label="Authentication code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            hint="Staff only: the 6-digit code from your authenticator app, or a recovery code. Leave it blank if you are a customer, or if you have not set up two-factor authentication yet."
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
          anyway would just be a button that silently does nothing.

          B-108(3): it IS offered at a bare `/login`, because `audienceFor`
          defaults to tenant when nobody said. That is the right default for a
          redirect and the wrong one for this — a staff member who used it was
          told a link was on its way that would never be minted. Rather than
          hide the form from an audience we cannot identify, the disclosure now
          states the rule as a GENERAL FACT (D-40). A general sentence leaks
          nothing about any particular address: it is true of staff accounts as
          a class, and says nothing about whether the address in the box is
          one. */}
      {hint !== 'staff' && (
      <details className="border-input rounded-lg border p-4">
        <summary className="cursor-pointer text-sm font-medium">Email me a sign-in link instead</summary>
        <p className="text-muted-foreground mt-2 text-sm text-pretty">
          No password needed — we will email you a one-tap link that works for 15 minutes.
        </p>
        <p className="text-muted-foreground mt-2 text-sm text-pretty">
          Sign-in links are for customer accounts. Staff accounts always sign in with a password and
          an authentication code, so a link cannot be sent to one.
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
