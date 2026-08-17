import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import './globals.css'

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  )
}
