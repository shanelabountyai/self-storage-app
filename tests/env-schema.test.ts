import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { envSchema, parseEnv } from '../apps/web/lib/env'

// K11 / INV-14. The schema validated at boot names every variable the app
// reads, and `.env.example` names every variable anything in the repo reads.

const ROOT = join(import.meta.dirname, '..')
const READ = /process\.env\.([A-Z_][A-Z0-9_]*)|process\.env\[['"]([A-Z_][A-Z0-9_]*)['"]\]/g

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === 'node_modules' || name === '.next' || name.startsWith('.')) return []
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.(ts|tsx|mts|mjs)$/.test(name) ? [path] : []
  })
}

function varsReadIn(paths: string[]): Set<string> {
  const names = new Set<string>()
  for (const path of paths) {
    for (const match of readFileSync(path, 'utf8').matchAll(READ)) names.add(match[1] ?? match[2])
  }
  return names
}

const appFiles = [...sourceFiles(join(ROOT, 'apps/web')), ...sourceFiles(join(ROOT, 'packages'))].filter(
  (path) => !path.includes('/scripts/') && !/\.test\.tsx?$/.test(path),
)
const everyFile = [
  ...sourceFiles(join(ROOT, 'apps/web')),
  ...sourceFiles(join(ROOT, 'packages')),
  ...sourceFiles(join(ROOT, 'scripts')),
  ...sourceFiles(join(ROOT, 'tests')),
  ...sourceFiles(join(ROOT, 'e2e')),
  join(ROOT, 'vitest.config.ts'),
  join(ROOT, 'playwright.config.ts'),
]
const schemaKeys = new Set(Object.keys(envSchema.shape))
const exampleKeys = new Set(
  [...readFileSync(join(ROOT, '.env.example'), 'utf8').matchAll(/^#?\s*([A-Z_][A-Z0-9_]*)=/gm)].map((m) => m[1]),
)

describe('K11: environment schema', () => {
  it('covers every variable the app reads', () => {
    const missing = [...varsReadIn(appFiles)].filter((name) => !schemaKeys.has(name))
    expect(missing).toEqual([])
  })

  it('.env.example names every schema key and every variable read anywhere', () => {
    const missing = [...new Set([...schemaKeys, ...varsReadIn(everyFile)])].filter((name) => !exampleKeys.has(name))
    expect(missing).toEqual([])
  })

  it('requires DATABASE_URL and AUTH_SECRET, naming keys and never values', () => {
    expect(() => parseEnv({ AUTH_SECRET: 'top-secret-value' })).toThrow('Invalid environment: DATABASE_URL')
    expect(() => parseEnv({ DATABASE_URL: 'postgresql://localhost/x', AUTH_URL: 'not a url top-secret' })).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining('top-secret') }),
    )
  })

  it('treats an empty NAME= line as unset and accepts a minimal valid environment', () => {
    const env = parseEnv({ DATABASE_URL: 'postgresql://localhost/x', AUTH_SECRET: 's', AUTH_URL: '', CRON_SECRET: '' })
    expect(env.AUTH_URL).toBeUndefined()
    expect(env.CRON_SECRET).toBeUndefined()
  })

  it('rejects a malformed URL or platform value', () => {
    const base = { DATABASE_URL: 'postgresql://localhost/x', AUTH_SECRET: 's' }
    expect(() => parseEnv({ ...base, NEXT_PUBLIC_SITE_URL: 'example.com' })).toThrow('NEXT_PUBLIC_SITE_URL')
    expect(() => parseEnv({ ...base, VERCEL_ENV: 'staging' })).toThrow('VERCEL_ENV')
  })
})
