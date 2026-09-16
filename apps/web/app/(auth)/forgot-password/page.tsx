import type { Metadata } from 'next'
import Link from 'next/link'
import { AdminForm, Field } from '@/components/admin/form'
import { dictionaryFor, translate } from '@/lib/i18n'
import { getLocale } from '@/lib/i18n/server'
import { requestPasswordResetAction } from './actions'

export async function generateMetadata(): Promise<Metadata> {
  return { title: translate(dictionaryFor(await getLocale()), 'fpwd.title') }
}

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>
}) {
  const { from } = await searchParams
  const dict = dictionaryFor(await getLocale())
  const t = (key: Parameters<typeof translate>[1]) => translate(dict, key)

  return (
    <div className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 px-6 py-12">
      <h1 className="text-xl font-semibold">{t('fpwd.title')}</h1>
      <p className="text-muted-foreground text-sm text-pretty">{t('fpwd.body')}</p>

      <AdminForm
        action={requestPasswordResetAction}
        label={t('fpwd.formLabel')}
        className="flex flex-col gap-3"
      >
        {from && <input type="hidden" name="from" value={from} />}
        <Field
          name="email"
          label={t('auth.email')}
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          className="flex flex-col gap-1 text-sm"
        />
        <button
          type="submit"
          className="bg-primary text-primary-foreground mt-1 inline-flex min-h-11 items-center justify-center rounded-md px-4 text-sm font-medium"
        >
          {t('fpwd.submit')}
        </button>
      </AdminForm>

      <p className="text-sm">
        <Link href={`/login${from ? `?from=${encodeURIComponent(from)}` : ''}`} className="underline underline-offset-4">
          {t('auth.backToSignIn')}
        </Link>
      </p>
    </div>
  )
}
