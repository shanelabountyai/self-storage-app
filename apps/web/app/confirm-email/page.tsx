import type { Metadata } from 'next'
import Link from 'next/link'
import { confirmEmailChange } from '@/lib/auth/email-change'
import { SITE } from '@/lib/site-config'

export const metadata: Metadata = {
  title: 'Confirm your email address',
  robots: { index: false, follow: false },
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

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 px-6 py-12">
      {result.ok ? (
        <>
          <h1 className="text-xl font-semibold">Email address confirmed</h1>
          <p className="text-sm text-pretty">
            <strong>{result.email}</strong> is now the address on your account, and the one you sign
            in with.
          </p>
          <Link href="/portal" className="text-sm underline underline-offset-4">
            Go to my account
          </Link>
        </>
      ) : (
        <>
          <h1 className="text-xl font-semibold">That link didn&rsquo;t work</h1>
          <p className="text-sm text-pretty">
            {result.reason === 'taken'
              ? 'That email address has since been used on another account, so we can’t move it over.'
              : 'It may have expired, already been used, or been replaced by a newer request. Nothing has changed.'}
          </p>
          <p className="text-muted-foreground text-sm text-pretty">
            You can start again from your account, or call{' '}
            <a href={`tel:${SITE.phone.href}`} className="underline underline-offset-4">
              {SITE.phone.display}
            </a>
            .
          </p>
          <Link href="/portal/contact" className="text-sm underline underline-offset-4">
            Back to contact details
          </Link>
        </>
      )}
    </main>
  )
}
