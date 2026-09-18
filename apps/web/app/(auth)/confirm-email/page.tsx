import type { Metadata } from 'next'
import Link from 'next/link'
import { confirmEmailChange } from '@/lib/auth/email-change'
import { SITE } from '@/lib/site-config'
import { dictionaryFor, translate } from '@/lib/i18n'
import { getLocale } from '@/lib/i18n/server'

// Titled by token presence, as /reset-password is: resolving the token here
// would spend it, since confirmEmailChange is single-use.
export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>
}): Promise<Metadata> {
  const { token } = await searchParams
  return {
    title: translate(dictionaryFor(await getLocale()), token ? 'confemail.title' : 'confemail.error.title'),
    robots: { index: false, follow: false },
  }
}

// PRD 01 US-706. The link from the new address lands here.
//
// At the app root rather than under /portal, and that placement is the whole
// point: proxy.ts gates /portal/* on a tenant session, but the person opening
// this link is proving they can receive mail at the new address, which is a
// different claim from being signed in. Requiring both would break the
// ordinary case — opening the link on a phone with no session. The token is
// the credential: single-use, 24 hours, and it names its own subject.
//
// It is also why this page never says which account the link belongs to: a
// link that leaked would otherwise disclose the address it was changing.

export default async function ConfirmEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>
}) {
  const { token } = await searchParams
  const result = token ? await confirmEmailChange(token) : { ok: false as const, reason: 'invalid_token' as const }
  const dict = dictionaryFor(await getLocale())
  const t = (key: Parameters<typeof translate>[1]) => translate(dict, key)

  return (
    <div className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 px-6 py-12">
      {result.ok ? (
        <>
          <h1 className="text-xl font-semibold">{t('confemail.success.title')}</h1>
          <p className="text-sm text-pretty">
            <strong>{result.email}</strong> {t('confemail.success.bodyAfter')}
          </p>
          <Link href="/portal" className="text-sm underline underline-offset-4">
            {t('confemail.success.link')}
          </Link>
        </>
      ) : (
        <>
          <h1 className="text-xl font-semibold">{t('confemail.error.title')}</h1>
          <p className="text-sm text-pretty">
            {result.reason === 'taken' ? t('confemail.error.taken') : t('confemail.error.expired')}
          </p>
          <p className="text-muted-foreground text-sm text-pretty">
            {t('confemail.error.callLead')}{' '}
            <a href={`tel:${SITE.phone.href}`} className="underline underline-offset-4">
              {SITE.phone.display}
            </a>
            .
          </p>
          <Link href="/portal/contact" className="text-sm underline underline-offset-4">
            {t('confemail.error.backLink')}
          </Link>
        </>
      )}
    </div>
  )
}
