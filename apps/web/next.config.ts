import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // packages/db ships TypeScript source, not a build step.
  transpilePackages: ['@storage/db'],
}

export default nextConfig
