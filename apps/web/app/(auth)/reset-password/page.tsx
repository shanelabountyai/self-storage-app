import type { Metadata } from 'next'
import Link from 'next/link'
import { AdminForm, Field } from '@/components/admin/form'
import { dictionaryFor, translate } from '@/lib/i18n'
import { getLocale } from '@/lib/i18n/server'
import { resetLinkLocale } from '@/lib/auth/flows'
import { resetPasswordAction } from './actions'

// B-311. `/reset-password?token=` speaks the tenant's language, not the
// cookie's — same rule `/pay/[token]` follows, and the same reason: the link
// was written to a person who is not necessarily the person whose browser has
// the cookie. `app/(auth)/layout.tsx` resolves the identical locale for the
// shell (skip link, toggle) via the header `proxy.ts` sets for this route.
async function pageLocale(token: string | undefined) {
  return token ? resetLinkLocale(token) : getLocale()
}

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>
}): Promise<Metadata> {
  const { token } = await searchParams
  const dict = dictionaryFor(await pageLocale(token))
  return { title: translate(dict, token ? 'rpwd.title' : 'rpwd.badLink.title') }
}

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>
}) {
  const { token } = await searchParams
  const dict = dictionaryFor(await pageLocale(token))
  const t = (key: Parameters<typeof translate>[1]) => translate(dict, key)

  if (!token) {
    return (
      <div className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 px-6 py-12">
        <h1 className="text-xl font-semibold">{t('rpwd.badLink.title')}</h1>
        <p className="text-muted-foreground text-sm text-pretty">{t('rpwd.badLink.body')}</p>
        <p className="text-sm">
          <Link href="/forgot-password" className="underline underline-offset-4">
            {t('rpwd.badLink.cta')}
          </Link>
        </p>
      </div>
    )
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 px-6 py-12">
      <h1 className="text-xl font-semibold">{t('rpwd.title')}</h1>

      <AdminForm action={resetPasswordAction} label={t('rpwd.title')} className="flex flex-col gap-3">
        <input type="hidden" name="token" value={token} />
        <Field
          name="password"
          label={t('rpwd.newPassword')}
          type="password"
          autoComplete="new-password"
          required
          hint={t('rpwd.hint.minLength')}
          className="flex flex-col gap-1 text-sm"
        />
        <Field
          name="confirmPassword"
          label={t('rpwd.confirmPassword')}
          type="password"
          autoComplete="new-password"
          required
          className="flex flex-col gap-1 text-sm"
        />
        <button
          type="submit"
          className="bg-primary text-primary-foreground mt-1 inline-flex min-h-11 items-center justify-center rounded-md px-4 text-sm font-medium"
        >
          {t('rpwd.submit')}
        </button>
      </AdminForm>

      <p className="text-sm">
        <Link href="/login" className="underline underline-offset-4">
          {t('auth.backToSignIn')}
        </Link>
      </p>
    </div>
  )
}
