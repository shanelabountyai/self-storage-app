import { readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// D-15: no internal identifier — a backlog ID, an entity name, a status enum —
// may render on a route a customer can reach.
//
// This exists because /login shipped reading "The sign-in screen is built in
// backlog item B-033" and sat there as the destination of the header's "Pay
// bill" button on every page. It was written as a placeholder for us and read
// by anyone who clicked.

const appDir = fileURLToPath(new URL('../apps/web/app', import.meta.url))

/// Every route a customer (not staff) can reach, signed in or not. `(public)`
/// is the route group behind the site chrome; `login` is outside it but is
/// linked from every page header, which is exactly how it got missed the first
/// time. `forgot-password`/`reset-password`/`reauth` and the tenant `portal`
/// (B-033) are the same kind of customer-facing surface as `login` — a leak
/// there is exactly as readable by a tenant as one on the public site.
const CUSTOMER_REACHABLE = ['(public)', 'login', 'forgot-password', 'reset-password', 'reauth', 'portal']

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) return filesUnder(path)
    return path.endsWith('.tsx') ? [path] : []
  })
}

/// Strips comments before scanning. A `// B-067 owns this` note to the next
/// developer is not a leak — it never reaches the browser — and banning those
/// would push useful provenance out of the code.
function renderedText(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
}

describe('D-15 — customer-reachable routes carry no internal identifiers', () => {
  const files = CUSTOMER_REACHABLE.flatMap((route) => filesUnder(join(appDir, route)))

  it('scans every customer-facing page', () => {
    // Guards the guard: a glob that silently matched nothing would make every
    // assertion below vacuously true.
    expect(files.length).toBeGreaterThan(5)
  })

  it.each(files.map((f) => [f.slice(appDir.length + 1), f]))('%s has no backlog ID', (_name, file) => {
    const matches = renderedText(readFileSync(file, 'utf8')).match(/\bB-\d{3}\b/g)
    expect(matches ?? [], 'a backlog ID is rendering where a customer can read it').toEqual([])
  })

  it.each(files.map((f) => [f.slice(appDir.length + 1), f]))('%s has no decision ID', (_name, file) => {
    const matches = renderedText(readFileSync(file, 'utf8')).match(/\bD-\d{1,2}[a-e]?\b/g)
    expect(matches ?? [], 'a decision ID is rendering where a customer can read it').toEqual([])
  })
})
