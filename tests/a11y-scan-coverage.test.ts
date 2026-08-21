import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  ADMIN_SCAN_ROUTES,
  customerFacingExceptions,
  PORTAL_SCAN_ROUTES,
  PUBLIC_SCAN_ROUTES,
  SCAN_EXCEPTIONS,
  SCANNED_BY_OWN_SPEC,
} from '../apps/web/lib/a11y/scan-coverage'

// B-139 / PRD 01 §6.8, PRD 02 §5.5 FR-24. The check that stops the public
// accessibility statement going stale on a merge.
//
// The statement names the pages the automated run does not cover. Twice in
// twelve days it was wrong — once understating, once overstating — and both
// times the cause was that it described work living in another file. This test
// is the coupling: every route under `apps/web/app` must be in a scan list or
// in the exception list the page renders, so a new page fails the build instead
// of quietly falsifying a sentence nobody re-reads.
//
// Deliberately a UNIT test rather than a Playwright one. It needs no browser and
// no database, it runs in the fast CI lane on every push, and the failure it
// guards against is a missing LIST ENTRY rather than a broken page.

const APP_DIR = join(process.cwd(), 'apps', 'web', 'app')

/// Every route the app actually serves, as Next.js names it: `[param]` segments
/// kept, route groups like `(public)` stripped, since they do not appear in a
/// URL.
function routesOnDisk(dir: string = APP_DIR, prefix = ''): string[] {
  const found: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (!statSync(full).isDirectory()) continue
    // A route group contributes no URL segment.
    const segment = name.startsWith('(') && name.endsWith(')') ? '' : `/${name}`
    const here = prefix + segment
    if (readdirSync(full).includes('page.tsx')) found.push(here || '/')
    found.push(...routesOnDisk(full, here))
  }
  return found
}

const ROUTES = [...new Set(routesOnDisk())].sort()
const STATIC_ROUTES = new Set(ROUTES.filter((route) => !route.includes('[')))

const SCANNED_URLS = [...PUBLIC_SCAN_ROUTES, ...PORTAL_SCAN_ROUTES, ...ADMIN_SCAN_ROUTES].map(
  (url) => url.split('?')[0].split('#')[0],
)

/// Whether a scanned URL exercises this route pattern.
///
/// A dynamic pattern is only satisfied by a URL that is NOT itself a static
/// route — otherwise `/admin/units` would count as coverage of
/// `/admin/[section]`, and the catch-all placeholder would read as scanned when
/// nothing has ever rendered it. That is the same "covered by something nearby"
/// mistake this whole item exists to stop.
function matches(pattern: string, url: string): boolean {
  if (pattern === url) return true
  if (!pattern.includes('[')) return false
  if (STATIC_ROUTES.has(url)) return false
  const source = pattern
    .split('/')
    .map((part) => (part.startsWith('[') ? '[^/]+' : part.replace(/[.*+?^${}()|\\]/g, '\\$&')))
    .join('/')
  return new RegExp(`^${source}$`).test(url)
}

describe('the accessibility scan contract (B-139)', () => {
  const exceptionRoutes = new Set<string>(SCAN_EXCEPTIONS.map((row) => row.route))
  const ownSpecRoutes = new Set<string>(SCANNED_BY_OWN_SPEC.map((row) => row.route))

  it('finds the app’s routes at all — a broken walk would pass everything', () => {
    expect(ROUTES).toContain('/')
    expect(ROUTES).toContain('/portal/refer')
    expect(ROUTES).toContain('/admin/tenants/[tenantId]/transfer')
    expect(ROUTES.length).toBeGreaterThan(80)
  })

  it('covers every route by a scan or by a stated exception', () => {
    const uncovered = ROUTES.filter(
      (route) =>
        !exceptionRoutes.has(route) &&
        !ownSpecRoutes.has(route) &&
        !SCANNED_URLS.some((url) => matches(route, url)),
    )
    expect(
      uncovered,
      'add each to a *_SCAN_ROUTES list, to SCANNED_BY_OWN_SPEC, or to SCAN_EXCEPTIONS in apps/web/lib/a11y/scan-coverage.ts',
    ).toEqual([])
  })

  it('states no exception for a route that no longer exists', () => {
    // The exception list overstating in the other direction: a page a visitor
    // is told is unchecked, that we deleted two releases ago.
    const stale = [...exceptionRoutes]
      // Not a route: the checkout confirmation is a STATE of `/checkout`, which
      // is the one exception that has always been about a screen rather than a
      // URL.
      .filter((route) => !route.includes('#'))
      .filter((route) => !ROUTES.includes(route))
    expect(stale).toEqual([])
  })

  it('scans no route the app does not serve', () => {
    const phantom = SCANNED_URLS.filter((url) => !ROUTES.some((route) => matches(route, url)))
    expect(phantom).toEqual([])
  })

  it('keeps every SCANNED_BY_OWN_SPEC claim true', () => {
    // The claim is "this file runs axe on that route". A spec that stopped
    // scanning would otherwise leave the route counted as covered by a comment.
    for (const { route, spec } of SCANNED_BY_OWN_SPEC) {
      const source = readFileSync(join(process.cwd(), spec), 'utf8')
      expect(source, `${spec} no longer runs axe`).toContain('AxeBuilder')
      const literal = route.split('/[')[0]
      expect(source, `${spec} no longer visits ${route}`).toContain(literal)
    }
  })

  it('tells a visitor about customer-facing gaps only', () => {
    const shown = customerFacingExceptions()
    expect(shown.length).toBeGreaterThan(0)
    expect(shown.every((row) => row.audience !== 'admin')).toBe(true)
    // Every reason has to read as a sentence on a public page, not as a route.
    expect(shown.every((row) => row.reason.length > 20 && !row.reason.includes('['))).toBe(true)
  })
})
