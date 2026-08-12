import path from 'node:path'
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source, not a build step.
  transpilePackages: ['@storage/db', '@storage/core'],

  // The repo root, not apps/web. Tracing walks up from here to decide what to
  // bundle into each serverless function, and in a workspace the files it needs
  // live above the app directory — `packages/db` most of all.
  outputFileTracingRoot: path.join(import.meta.dirname, '../..'),

  // Prisma's query engine is a native binary, so nothing imports it and tracing
  // cannot infer it: it is opened by path at runtime. Left out, every deployed
  // function throws "could not locate the Query Engine for runtime
  // rhel-openssl-3.0.x" on its first query while statically prerendered pages
  // keep working, because those queried the database at build time. Production
  // looked healthy for a day on exactly that basis.
  //
  // Both engines are listed: `binaryTargets` in schema.prisma generates the
  // Linux one for deployment and `native` for local, and the glob is cheap
  // enough not to be worth narrowing per platform.
  outputFileTracingIncludes: {
    '/**': ['../../packages/db/generated/client/*.node'],
  },
}

export default nextConfig
