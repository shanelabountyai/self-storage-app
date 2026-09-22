import type { Metadata } from 'next'
import { Archivo, JetBrains_Mono, Source_Sans_3 } from 'next/font/google'
import { headers } from 'next/headers'
import { PAY_TOKEN_HEADER, RESET_TOKEN_HEADER } from '@/lib/i18n'
import { requestLinkLocale } from '@/lib/i18n/link-locale'
import { payLinkLocale } from '@/lib/portal/pay-links'
import { resetLinkLocale } from '@/lib/auth/flows'

import './globals.css'

// B-363 (D-146): the design system's families, self-hosted by next/font
// rather than the kit's Google Fonts @import, so no request leaves the site.
const archivo = Archivo({ variable: '--font-archivo', subsets: ['latin'] })
const sourceSans = Source_Sans_3({ variable: '--font-source-sans', subsets: ['latin'] })
const jetbrainsMono = JetBrains_Mono({ variable: '--font-jetbrains-mono', subsets: ['latin'] })

export const metadata: Metadata = {
  // Without this, a page-level `alternates.canonical` renders as a relative
  // href, which crawlers ignore — Lighthouse scored the facility page 0.91 on
  // SEO for exactly that ("Document does not have a valid rel=canonical").
  // Vercel sets VERCEL_PROJECT_PRODUCTION_URL on every deploy; the localhost
  // fallback keeps dev and CI honest rather than silently emitting a
  // production URL from a laptop. B-066 owns the wider canonical/301 policy.
  metadataBase: new URL(
    process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : 'http://localhost:3000',
  ),
  title: {
    default: 'Self-Storage Platform',
    template: '%s · Self-Storage Platform',
  },
  description:
    'Multi-facility self-storage: find a unit, rent online, and manage your account.',
  // PRD 04 §7 Phase 2 (B-082 part 5). Google's site-verification token, which
  // is the precondition for every other thing Search Console can tell us —
  // nothing can be read about a property nobody has proved they own.
  //
  // Omitted entirely when unset rather than emitted empty: a
  // `<meta name="google-site-verification" content="">` is a failed
  // verification rather than an absent one, and it is the kind of thing
  // somebody chases for an afternoon. Not a secret — it is public in the page
  // source by design, which is how the check works.
  verification: process.env.GOOGLE_SITE_VERIFICATION
    ? { google: process.env.GOOGLE_SITE_VERIFICATION }
    : undefined,
}

// B-090 part 6 (D-122). `lang` is the document's language, and WCAG 2.1
// SC 3.1.1 Language of Page (A) is about this attribute specifically — a
// Spanish page announced as `lang="en"` is read aloud with English phonemes,
// which is worse than untranslated. It can only be set here, because only
// this layout renders `<html>`.
//
// Reading the cookie makes every route dynamic; the trade-off, and why the
// staleness ceilings it looks like it breaks are unaffected, is written out in
// `lib/i18n/index.ts`.
export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  // B-283. A pay link speaks the language its reminder was written in, whatever
  // the visitor's cookie says — the page has no toggle, and the body text reads
  // the same `payLinkLocale`, so the two cannot disagree.
  //
  // B-311. Same rule for `/reset-password?token=`: `resetLinkLocale` reads the
  // same header the shared `(auth)` layout does, so `<html lang>` and the page
  // body never disagree either.
  //
  // B-321. And for the three other pages a message links to — `requestLinkLocale`
  // is the cookie everywhere else, which is why it can be the fallback here.
  const requestHeaders = await headers()
  const payToken = requestHeaders.get(PAY_TOKEN_HEADER)
  const resetToken = requestHeaders.get(RESET_TOKEN_HEADER)
  const locale = payToken
    ? await payLinkLocale(payToken)
    : resetToken
      ? await resetLinkLocale(resetToken)
      : await requestLinkLocale()

  return (
    <html
      lang={locale}
      className={`${archivo.variable} ${sourceSans.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  )
}
