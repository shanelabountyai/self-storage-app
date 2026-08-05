import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { AdminForm, Field } from '@/components/admin/form'
import { safeRedirectTarget } from '@/lib/auth/login-audience'
import { reauthWithMagicLinkAction, reauthWithPasswordAction } from './actions'

export const metadata: Metadata = { title: 'Confirm it’s you' }

// PRD 01 US-701. Not linked from anywhere yet — B-036 (payment methods) and
// B-041 (move-out request) are the first sensitive actions that will redirect
// here via lib/auth/reauth.ts's checkFreshAuth(). The page and both re-verify
// paths are real and tested now, ahead of that caller.
export default async function ReauthPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string }>
}) {
  const session = await auth()
  if (!session?.user) redirect('/login')

  const { redirect: redirectParam } = await searchParams
  const redirectTo = safeRedirectTarget(redirectParam, session.user.audience)

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 px-6 py-12">
      <h1 className="text-xl font-semibold">Confirm it&rsquo;s you</h1>
      <p className="text-muted-foreground text-sm text-pretty">
        This is a sensitive action, so we need to check it&rsquo;s really you before continuing.
        Enter your password, or we can email you a link instead.
      </p>

      <AdminForm action={reauthWithPasswordAction} label="Confirm with your password" className="flex flex-col gap-3">
        <input type="hidden" name="redirect" value={redirectTo} />
        <Field
          name="password"
          label="Password"
          type="password"
          autoComplete="current-password"
          required
          className="flex flex-col gap-1 text-sm"
        />
        <button
          type="submit"
          className="bg-primary text-primary-foreground mt-1 inline-flex min-h-11 items-center justify-center rounded-md px-4 text-sm font-medium"
        >
          Confirm
        </button>
      </AdminForm>

      <details className="border-input rounded-lg border p-4">
        <summary className="cursor-pointer text-sm font-medium">Email me a link instead</summary>
        <AdminForm
          action={reauthWithMagicLinkAction}
          label="Email me a confirmation link"
          className="mt-3"
        >
          <button
            type="submit"
            className="border-input hover:bg-accent inline-flex min-h-11 items-center justify-center rounded-md border px-4 text-sm font-medium"
          >
            Email me a link
          </button>
        </AdminForm>
      </details>
    </main>
  )
}
