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
