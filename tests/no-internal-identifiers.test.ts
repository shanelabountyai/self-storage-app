import { readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// D-15: no internal identifier — a backlog ID, an entity name, a status enum —
// may render on a route a human can reach.
//
// This exists because /login shipped reading "The sign-in screen is built in
// backlog item B-033" and sat there as the destination of the header's "Pay
// bill" button on every page. It was written as a placeholder for us and read
// by anyone who clicked.
//
// **Widened to `/admin` in B-109**, and the reason is not tidiness. D-15 is a
// customer-lexicon decision, but the same leak on a staff screen misinforms
// somebody who cannot check: `/admin/leads/[leadId]` told the counter agent
// "No promotions engine yet (B-070), so nothing here is discounted" for as
// long as B-070 had been shipped and the website had been advertising one, so
// a phone quote and a web quote for the same unit disagreed and the caller
// found out at the counter. A backlog ID on screen is a claim about the build,
// and a claim about the build is exactly the thing that rots silently. Staff
// may read industry words; they may not read our issue tracker.

const appDir = fileURLToPath(new URL('../apps/web/app', import.meta.url))

/// Every route a human can reach, signed in or not — customer-facing and, since
/// B-109, staff-facing. `(public)`
/// is the route group behind the site chrome; `login` is outside it but is
/// linked from every page header, which is exactly how it got missed the first
/// time. `forgot-password`/`reset-password`/`reauth` and the tenant `portal`
/// (B-033) are the same kind of customer-facing surface as `login` — a leak
/// there is exactly as readable by a tenant as one on the public site.
const CUSTOMER_REACHABLE = [
  '(public)',
  'admin',
  'login',
  'forgot-password',
  'reset-password',
  'reauth',
  'portal',
  // B-037. Reached from a link in an email, by someone who may not be signed
  // in at all — as customer-facing as anything else here.
  'confirm-email',
]

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

describe('D-15 — reachable routes carry no internal identifiers', () => {
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
