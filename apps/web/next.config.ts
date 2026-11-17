import path from 'node:path'
import createMDX from '@next/mdx'
import type { NextConfig } from 'next'
import { parseEnv } from './lib/env'

// K11. On Vercel, validate at build too, so a bad value fails the deploy
// instead of the live site's boot (instrumentation.ts still checks at boot).
if (process.env.VERCEL_ENV) parseEnv(process.env)

/// Every route whose URL is a credential: a token or code in the path, or a
/// single-use sign-in, reset or confirm token in the query string.
const TOKEN_PAGE_SOURCES = [
  '/pay/:path*',
  '/checkout/resume/:path*',
  '/unsubscribe/:path*',
  '/waitlist/cancel/:path*',
  '/r/:path*',
  '/reservations',
  '/checkout',
  '/login/magic',
  '/reset-password',
  '/confirm-email',
]

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source, not a build step.
  transpilePackages: ['@storage/db', '@storage/core'],

  // Prisma's query engine is a native binary that the generated client opens by
  // path, relative to its own directory. Bundling the client moves it — into a
  // chunk under apps/web/.next — and the lookup then points at a path that does
  // not exist, so every deployed function throws "could not locate the Query
  // Engine for runtime rhel-openssl-3.0.x" on its first query.
  //
  // That failure is invisible to a smoke test: statically prerendered pages
  // query the database at BUILD time, where the engine is present, so the
  // homepage and the marketing pages render perfectly while every dynamic
  // route, every API handler and the hourly cron return 500. Production looked
  // healthy for a day on exactly that basis.
  //
  // Keeping @prisma/client external leaves it an ordinary runtime require out
  // of node_modules, next to its engine. `transpilePackages` above still
  // applies to @storage/db itself, which is TypeScript source and must be
  // compiled — only the client it re-exports stays out of the bundle.
  serverExternalPackages: ['@prisma/client'],

  // The repo root, not apps/web. Tracing walks up from here to decide what to
  // copy into each serverless function, and in a workspace the files it needs
  // live above the app directory.
  outputFileTracingRoot: path.join(import.meta.dirname, '../..'),

  // SEC-06. Every response, pages and handlers alike. `frame-ancestors` is the
  // whole Content-Security-Policy on purpose: a script or style policy would
  // have to enumerate Stripe and the map embed and is a separate item.
  // X-Frame-Options repeats it for the document downloads, whose own CSP
  // (`lib/documents/storage.ts`) replaces this one. HSTS carries no `preload`:
  // that is a submission to a browser list and cannot be withdrawn quickly.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
        ],
      },
      // K6 (INV-07/08). Pages that carry a bearer token in the URL. Listed after
      // the global block so this Referrer-Policy overrides it: the token must
      // never leave in a Referer header, a copy must never sit in a cache, and
      // the proxy's X-Robots-Tag is repeated here so it holds without the proxy.
      ...TOKEN_PAGE_SOURCES.map((source) => ({
        source,
        headers: [
          // same-origin, not no-referrer: no-referrer makes Chrome send Origin: null on a
          // form POST, and Next then refuses the no-JS checkout's server action.
          { key: 'Referrer-Policy', value: 'same-origin' },
          { key: 'Cache-Control', value: 'private, no-store, max-age=0' },
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
        ],
      })),
    ]
  },
}

// PRD 04 US-4 AC2 (B-082 part 3). The guides content hub.
//
// `pageExtensions` is deliberately NOT extended with `mdx`. A `.mdx` file under
// `app/` would become a route on its own, and a guide is not just its prose:
// it needs `Article` JSON-LD built from typed fields, a breadcrumb, and a CTA
// that knows which size band it is recommending. So the prose is imported by
// `guides/[slug]/page.tsx`, which owns all of that — content stays content and
// routing stays in TypeScript.
//
// No remark or rehype plugins. Every guide is written in this repo by somebody
// who can read the rendered page; a plugin chain is machinery for content
// arriving from somewhere you cannot see.
const withMDX = createMDX({})

export default withMDX(nextConfig)
