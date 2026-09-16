import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { AdminForm, Field } from '@/components/admin/form'
import { safeRedirectTarget } from '@/lib/auth/login-audience'
import { dictionaryFor, translate } from '@/lib/i18n'
import { getLocale } from '@/lib/i18n/server'
import { reauthWithMagicLinkAction, reauthWithPasswordAction } from './actions'

export async function generateMetadata(): Promise<Metadata> {
  return { title: translate(dictionaryFor(await getLocale()), 'reauth.title') }
}

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
  const dict = dictionaryFor(await getLocale())
  const t = (key: Parameters<typeof translate>[1]) => translate(dict, key)

  return (
    <div className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 px-6 py-12">
      <h1 className="text-xl font-semibold">{t('reauth.title')}</h1>
      <p className="text-muted-foreground text-sm text-pretty">{t('reauth.body')}</p>

      <AdminForm action={reauthWithPasswordAction} label={t('reauth.formLabel')} className="flex flex-col gap-3">
        <input type="hidden" name="redirect" value={redirectTo} />
        <Field
          name="password"
          label={t('auth.password')}
          type="password"
          autoComplete="current-password"
          required
          className="flex flex-col gap-1 text-sm"
        />
        <button
          type="submit"
          className="bg-primary text-primary-foreground mt-1 inline-flex min-h-11 items-center justify-center rounded-md px-4 text-sm font-medium"
        >
          {t('auth.confirm')}
        </button>
      </AdminForm>

      <details className="border-input rounded-lg border p-4">
        <summary className="cursor-pointer text-sm font-medium">{t('reauth.magicLinkSummary')}</summary>
        <AdminForm
          action={reauthWithMagicLinkAction}
          label={t('reauth.magicLinkFormLabel')}
          className="mt-3"
        >
          <button
            type="submit"
            className="border-input hover:bg-accent inline-flex min-h-11 items-center justify-center rounded-md border px-4 text-sm font-medium"
          >
            {t('login.magicLinkButton')}
          </button>
        </AdminForm>
      </details>
    </div>
  )
}
