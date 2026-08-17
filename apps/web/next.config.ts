import path from 'node:path'
import createMDX from '@next/mdx'
import type { NextConfig } from 'next'

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
