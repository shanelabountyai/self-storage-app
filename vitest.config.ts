import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Node by default — the tests the PRDs actually demand (billing/proration
    // math, per master §5) are pure functions. Add jsdom + the React plugin
    // when the first component test shows up.
    environment: 'node',
    include: ['tests/**/*.test.ts', 'apps/**/*.test.ts', 'packages/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/.next/**', 'e2e/**'],
  },
})
