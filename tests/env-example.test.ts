import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Guards the one real failure mode in B-001's env handling: someone fills in a
// value while editing .env.example and commits a live secret (master PRD §7.4 —
// "secrets in platform env vaults, never in the repo").
const lines = readFileSync(new URL('../.env.example', import.meta.url), 'utf8')
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line !== '' && !line.startsWith('#'))

describe('.env.example', () => {
  it('lists variable names with no values', () => {
    const withValues = lines.filter((line) => !/^[A-Z][A-Z0-9_]*=$/.test(line))
    expect(withValues).toEqual([])
  })

  it('declares the variables the app currently needs', () => {
    const names = lines.map((line) => line.slice(0, line.indexOf('=')))
    expect(names).toContain('DATABASE_URL')
    expect(names).toContain('DIRECT_URL')
  })
})
