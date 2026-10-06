import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { dictionaryFor, translate } from '@/lib/i18n'
import { getLocale } from '@/lib/i18n/server'
import { signInWithMagicLinkAction } from '../actions'

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: translate(dictionaryFor(await getLocale()), 'login.magic.title'),
    robots: { index: false, follow: false },
  }
}

// PRD 01 US-701, SEC-08. The destination of the link `requestMagicLink`
// (lib/auth/flows.ts) emails. Opening it spends nothing: this was a route
// handler that signed in on GET, and a mail scanner that follows every link in
// a message (Outlook Safe Links, a corporate gateway) burned the single-use
// token before the person it was sent to ever clicked. The page does not look
// the token up either, so a stale link and a good one render the same button
// and only the POST says which it was.
export default async function MagicLinkPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; from?: string }>
}) {
  const { token, from } = await searchParams
  if (!token) redirect('/login?error=magic_link_invalid')

  const dict = dictionaryFor(await getLocale())
  const t = (key: Parameters<typeof translate>[1]) => translate(dict, key)

  return (
    <div className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 px-6 py-12">
      <h1 className="text-xl font-semibold">{t('login.magic.title')}</h1>
      <p className="text-muted-foreground text-sm text-pretty">{t('login.magic.body')}</p>
      <form action={signInWithMagicLinkAction}>
        <input type="hidden" name="token" value={token} />
        {from ? <input type="hidden" name="from" value={from} /> : null}
        <button
          type="submit"
          className="bg-primary text-primary-foreground inline-flex min-h-11 w-full items-center justify-center rounded-md px-4 text-sm font-medium"
        >
          {t('login.magic.submit')}
        </button>
      </form>
      <p className="text-sm">
        <Link href="/login" className="underline underline-offset-4">
          {t('auth.backToSignIn')}
        </Link>
      </p>
    </div>
  )
}
