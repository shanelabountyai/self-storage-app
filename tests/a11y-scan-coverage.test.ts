import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  ADMIN_SCAN_ROUTES,
  customerFacingExceptions,
  customerFacingStateExceptions,
  PORTAL_SCAN_ROUTES,
  PUBLIC_SCAN_ROUTES,
  SCAN_EXCEPTIONS,
  SCANNED_BY_OWN_SPEC,
  SCANNED_STATES,
  STATE_EXCEPTIONS,
  ENGLISH_UNDER_A_TRANSLATED_SHELL,
  TRANSLATED_UNDER_THE_ADMIN_SHELL,
  ADMIN_SHELL_LAYOUT,
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
/// route — otherwise `/admin/units` would have counted as coverage of the
/// `/admin/[section]` catch-all (deleted in B-229), and a placeholder nothing
/// had ever rendered would read as scanned. That is the same "covered by
/// something nearby" mistake this whole item exists to stop, and the rule stays
/// whether or not a catch-all is currently in the tree.
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
    // scanning would otherwise leave the route counted as covered by a
    // comment. B-184 (T2) moved the actual `new AxeBuilder(...)` call into the
    // shared `assertNoAxeViolations` helper, so a spec now runs axe by
    // importing and calling that rather than by naming the library directly.
    for (const { route, spec } of SCANNED_BY_OWN_SPEC) {
      const source = readFileSync(join(process.cwd(), spec), 'utf8')
      expect(source, `${spec} no longer runs axe`).toMatch(/AxeBuilder|assertNoAxeViolations/)
      const literal = route.split('/[')[0]
      expect(source, `${spec} no longer visits ${route}`).toContain(literal)
    }
  })


  // B-262. The statement is bilingual, so a customer-facing row without a
  // Spanish reason renders the English one to a Spanish reader — half a list
  // of gaps in the reader's language, which reads as though the untranslated
  // rows were the ones that did not matter. `reasonEs` is optional on the type
  // on purpose (the admin rows never reach a customer and need none), so this
  // is the guard that makes it required where it counts.
  const bilingual = (rows: readonly { route: string; reason: string; reasonEs?: string }[]) => {
    const missing = rows.filter((row) => !row.reasonEs?.trim()).map((row) => row.route)
    expect(missing, 'customer-facing rows with no Spanish reason (B-262)').toEqual([])
    expect(rows.every((row) => (row.reasonEs ?? '').length > 20)).toBe(true)
  }

  it('tells a visitor about customer-facing gaps only', () => {
    const shown = customerFacingExceptions()
    expect(shown.length).toBeGreaterThan(0)
    expect(shown.every((row) => row.audience !== 'admin')).toBe(true)
    // Every reason has to read as a sentence on a public page, not as a route.
    expect(shown.every((row) => row.reason.length > 20 && !row.reason.includes('['))).toBe(true)
    bilingual(shown)
  })

  // B-184 (T1). The same contract, one level down: a STATE is not a route, so
  // it cannot appear in the checks above no matter how thorough they are.
  describe('the state scan contract (B-184)', () => {
    it('keeps every SCANNED_STATES claim true', () => {
      for (const { route, state, spec } of SCANNED_STATES) {
        const source = readFileSync(join(process.cwd(), spec), 'utf8')
        expect(source, `${spec} no longer runs axe`).toMatch(/AxeBuilder|assertNoAxeViolations/)
        expect(
          source,
          `${spec} carries no "// a11y-state: ${route} | ${state}" comment beside its scan`,
        ).toContain(`a11y-state: ${route} | ${state}`)
      }
    })

    it('has a list entry for every a11y-state comment under e2e/, and vice versa', () => {
      // The symmetric check `SCANNED_BY_OWN_SPEC` cannot make: a spec can gain
      // a new `// a11y-state:` comment nobody added to the list above, which
      // is the same "coverage grew by accident" failure B-119 closed for whole
      // routes. Walked directly rather than through the list, so a NEW file
      // with the comment is caught too, not just the ones already named.
      const claimed = new Set(SCANNED_STATES.map((s) => `${s.route} | ${s.state}`))
      const e2eDir = join(process.cwd(), 'e2e')
      const specFiles = readdirSync(e2eDir).filter((f) => f.endsWith('.spec.ts'))
      const found: string[] = []
      for (const file of specFiles) {
        const source = readFileSync(join(e2eDir, file), 'utf8')
        for (const m of source.matchAll(/a11y-state:\s*(.+)/g)) found.push(m[1].trim())
      }
      expect(found.length, 'no a11y-state comment found anywhere — did the convention move?').toBeGreaterThan(0)
      const orphaned = found.filter((line) => !claimed.has(line))
      expect(orphaned, 'a spec claims a state SCANNED_STATES does not list').toEqual([])
    })

    // B-246. The half B-215 left open, and the reason two states shipped with
    // axe and no width measurement at all: the contract between `SCANNED_STATES`
    // (the axe claim) and `STATE_REACH` (the layout claim) ran ONE WAY. Every
    // `STATE_REACH` key had to name a real scanned state — the e2e spec asserts
    // that — but nothing said a scanned state had to be measured, or to say why
    // not. So "neither list" was a valid place to be, and invisible.
    //
    // Read out of the spec file rather than imported, because `STATE_REACH` is
    // a Playwright module: importing it here would pull `@playwright/test` into
    // the unit suite. The same technique the a11y-state check above uses.
    it('makes every scanned state say whether its LAYOUT is measured', () => {
      const source = readFileSync(join(process.cwd(), 'e2e/a11y-own-spec-routes.spec.ts'), 'utf8')
      const reachBlock = source.slice(source.indexOf('const STATE_REACH'))
      const reached = new Set(
        [...reachBlock.matchAll(/^\s{2}'([^']+)':\s*\{/gm)].map((m) => m[1]),
      )
      expect(
        reached.size,
        'no STATE_REACH keys parsed — did that constant move or change shape?',
      ).toBeGreaterThan(0)

      for (const entry of SCANNED_STATES) {
        const key = `${entry.route} | ${entry.state}`
        if (entry.layout === 'reached') {
          expect(
            reached,
            `${key} is declared layout: 'reached' but STATE_REACH has no entry for it`,
          ).toContain(key)
        } else {
          // An exception has to be a reason somebody can disagree with. "Not
          // done yet" is the state this field exists to stop being silent.
          expect(
            (entry.layoutException ?? '').trim().length,
            `${key} is excepted from the layout checks with no reason given`,
          ).toBeGreaterThan(20)
        }
      }
    })

    it('measures the layout of no state it does not also scan', () => {
      // The direction that already held, asserted here too so both live in one
      // place: a STATE_REACH key naming a state SCANNED_STATES does not list
      // would be a width measurement of something nothing else claims.
      const source = readFileSync(join(process.cwd(), 'e2e/a11y-own-spec-routes.spec.ts'), 'utf8')
      const reachBlock = source.slice(source.indexOf('const STATE_REACH'))
      const reached = [...reachBlock.matchAll(/^\s{2}'([^']+)':\s*\{/gm)].map((m) => m[1])
      const claimed = new Set(SCANNED_STATES.map((one) => `${one.route} | ${one.state}`))
      expect(reached.filter((key) => !claimed.has(key))).toEqual([])
    })

    // B-196 (gap 2). B-187 migrated the last five raw scans onto the shared
    // helper; this is what makes the sixth fail rather than quietly reopening
    // the hole. A spec that builds its own `AxeBuilder` asserts nothing about
    // `incomplete`, inherits none of the route-scoped hand checks, and reads as
    // coverage on every screen that lists it — which is precisely the
    // "we did not test that" silently meaning "that passed" failure B-184 (T2)
    // closed once already. Same shape as the route-coverage and state checks
    // above: walk the directory, do not trust a list.
    it('runs axe through the shared helper and nowhere else', () => {
      const e2eDir = join(process.cwd(), 'e2e')
      const offenders = readdirSync(e2eDir)
        .filter((file) => file.endsWith('.ts') && file !== 'a11y-helpers.ts')
        .filter((file) => /new\s+AxeBuilder/.test(readFileSync(join(e2eDir, file), 'utf8')))
      expect(
        offenders,
        'build the scan through assertNoAxeViolations in e2e/a11y-helpers.ts — a raw AxeBuilder checks no `incomplete` results and inherits none of the hand-checked exemptions',
      ).toEqual([])

      // And the helper still does it, so the rule above cannot be satisfied by
      // the suite having stopped scanning altogether.
      const helper = readFileSync(join(e2eDir, 'a11y-helpers.ts'), 'utf8')
      expect(helper, 'e2e/a11y-helpers.ts no longer builds a scan').toMatch(/new\s+AxeBuilder/)
    })

    // B-214. The two site-wide waivers in `assertNoAxeViolations` — the ones the
    // public statement now describes in their own bullets — were each an
    // unconditional `return`, and both were wider than the sentence that
    // covered them. This is a source check for the same reason the one above is:
    // reverting either is a one-token edit, and the only visible effect is a
    // scan going green.
    it('waives an off-screen node and an iframe node conditionally, not outright', () => {
      const helper = readFileSync(join(process.cwd(), 'e2e', 'a11y-helpers.ts'), 'utf8')
      expect(
        helper,
        'the hit test waives an off-screen centre point outright again — it must waive only where a scrollable ancestor brings the node back (B-199 is the case that is not scrollable)',
      ).toMatch(/stack\.length === 0\) return scrollsHorizontally\(el\)/)
      expect(
        helper,
        'undecided nodes inside every iframe are dropped again — the drop is scoped to a cross-origin frame, so a frame we author is checked like any other markup',
      ).toMatch(/origin !== location\.origin/)
    })

    it('states no STATE_EXCEPTIONS for a route that no longer exists', () => {
      const stale = [...new Set(STATE_EXCEPTIONS.map((e) => e.route))].filter(
        (route) => !ROUTES.includes(route),
      )
      expect(stale).toEqual([])
    })

    it('tells a visitor about customer-facing state gaps only', () => {
      const shown = customerFacingStateExceptions()
      expect(shown.length).toBeGreaterThan(0)
      expect(shown.every((row) => row.audience !== 'admin')).toBe(true)
      expect(shown.every((row) => row.reason.length > 20)).toBe(true)
      bilingual(shown)
    })
  })

  // B-272 / SC 3.1.2 Language of Parts. The third contract in this file, and
  // the only one whose defect axe cannot see at all: no rule reads prose and
  // decides what language it is in, so an English page served inside
  // `<html lang="es">` passes every scan this repo runs while a screen reader
  // pronounces it with Spanish phonemes. It shipped that way past B-090f,
  // B-260 and B-262.
  //
  // Same shape as the checks above: walk the pages on disk, do not trust a
  // list. A public page either renders from the dictionary or says here that
  // it does not — and then has to prove it, because a row whose page carries
  // no `lang="en"` is the exact state this closes.
  describe('the language-of-parts contract (B-272)', () => {
    const PUBLIC_DIR = join(APP_DIR, '(public)')

    /// Every `page.tsx` under `(public)`, as a route and a source.
    function publicPages(dir: string = PUBLIC_DIR, prefix = ''): { route: string; source: string }[] {
      const found: { route: string; source: string }[] = []
      for (const name of readdirSync(dir)) {
        const full = join(dir, name)
        if (!statSync(full).isDirectory()) continue
        const segment = name.startsWith('(') && name.endsWith(')') ? '' : `/${name}`
        const here = prefix + segment
        if (readdirSync(full).includes('page.tsx')) {
          found.push({ route: here || '/', source: readFileSync(join(full, 'page.tsx'), 'utf8') })
        }
        found.push(...publicPages(full, here))
      }
      return found
    }

    const PAGES = publicPages()
    /// The DICTIONARY module, not `@/lib/i18n/server`: a page can read the
    /// locale (to declare it on a translated child) without rendering a single
    /// translated string of its own, and `/storage/[state]/[city]` does
    /// exactly that. Matching the looser prefix would have counted it as
    /// translated and let its English prose go unmarked.
    const translated = (source: string) => /from '@\/lib\/i18n'/.test(source)

    it('finds the public pages at all — a broken walk would pass everything', () => {
      expect(PAGES.map((p) => p.route)).toContain('/terms')
      expect(PAGES.map((p) => p.route)).toContain('/storage/[state]/[city]/[slug]')
      expect(PAGES.length).toBeGreaterThan(15)
    })

    it('leaves no public page both untranslated and undeclared', () => {
      const listed = new Set(ENGLISH_UNDER_A_TRANSLATED_SHELL.map((row) => row.route))
      const silent = PAGES.filter((page) => !translated(page.source) && !listed.has(page.route))
      expect(
        silent.map((page) => page.route),
        'a page that renders no dictionary string is English inside `<html lang>` from the cookie (D-122) — add it to ENGLISH_UNDER_A_TRANSLATED_SHELL and give its markup a lang, or translate it',
      ).toEqual([])
    })

    it('makes every listed page declare its language in its own markup', () => {
      const byRoute = new Map(PAGES.map((page) => [page.route, page.source]))
      for (const row of ENGLISH_UNDER_A_TRANSLATED_SHELL) {
        const source = byRoute.get(row.route)
        expect(source, `${row.route} is listed but is not a page under app/(public)`).toBeDefined()
        // `lang="en"` on the page's own markup, or handed to `ProsePage`,
        // which puts it on the wrapper it renders.
        expect(source, `${row.route} declares no language — SC 3.1.2`).toContain('lang="en"')
        expect(row.note.length, `${row.route} says nothing a reader could disagree with`).toBeGreaterThan(20)
      }
    })

    it('lists no page that has since been translated', () => {
      // The overstating direction, and the one that rots quietly: B-267 will
      // translate the reservation form, and a row still calling it English
      // would be a claim about a page that stopped being one.
      const byRoute = new Map(PAGES.map((page) => [page.route, page.source]))
      const stale = ENGLISH_UNDER_A_TRANSLATED_SHELL.filter((row) => {
        const source = byRoute.get(row.route)
        // `/storage/[state]/[city]` is the mixed page: it renders a translated
        // form and English prose, so it reads the locale without being
        // translated itself. The `translated` predicate already excludes
        // `@/lib/i18n/server` for that reason.
        return source !== undefined && translated(source)
      })
      expect(
        stale.map((row) => row.route),
        'these pages render from the dictionary now — drop the row and the page-level lang="en" with it',
      ).toEqual([])
    })

    // B-273. The staff mirror, and deliberately a DIFFERENT shape of check
    // rather than a copy of the four above — see the note on
    // `TRANSLATED_UNDER_THE_ADMIN_SHELL`. The public site has no shell that can
    // speak for all of it, so its claim is per page. Admin does: nothing under
    // `app/admin` renders a dictionary string except the template editor, so one
    // `lang="en"` on the layout is true for eighty screens at once, and listing
    // them would be eighty chances to forget one.
    describe('the admin half (B-273)', () => {
      const ADMIN_DIR = join(APP_DIR, 'admin')

      function adminPages(dir: string = ADMIN_DIR, prefix = '/admin'): { route: string; source: string }[] {
        const found: { route: string; source: string }[] = []
        for (const name of readdirSync(dir)) {
          const full = join(dir, name)
          if (!statSync(full).isDirectory()) continue
          const segment = name.startsWith('(') && name.endsWith(')') ? '' : `/${name}`
          const here = prefix + segment
          if (readdirSync(full).includes('page.tsx')) {
            found.push({ route: here, source: readFileSync(join(full, 'page.tsx'), 'utf8') })
          }
          found.push(...adminPages(full, here))
        }
        return found
      }

      const ADMIN_PAGES = adminPages()
      /// Same predicate as the public half, and the same reason for matching the
      /// DICTIONARY module rather than `@/lib/i18n/server`: a page can read the
      /// locale without rendering a translated string of its own.
      const translated = (source: string) => /from '@\/lib\/i18n'/.test(source)

      it('finds the admin pages at all — a broken walk would pass everything', () => {
        const routes = ADMIN_PAGES.map((page) => page.route)
        expect(routes).toContain('/admin/settings/templates')
        expect(routes).toContain('/admin/impersonation')
        expect(ADMIN_PAGES.length).toBeGreaterThan(30)
      })

      // Half one, and it is the whole of the English surface. Delete this
      // attribute and every admin screen goes back to being announced in
      // Spanish to any staff user who ever pressed *Español* on the way in —
      // silently, because axe cannot read prose and decide what language it is.
      it('keeps the admin shell declaring its language', () => {
        const layout = readFileSync(join(process.cwd(), ADMIN_SHELL_LAYOUT), 'utf8')
        expect(layout, `${ADMIN_SHELL_LAYOUT} declares no shell language — SC 3.1.2`).toContain(
          'lang="en"',
        )
      })

      it('leaves no translated admin page undeclared', () => {
        const listed = new Set(TRANSLATED_UNDER_THE_ADMIN_SHELL.map((row) => row.route))
        const silent = ADMIN_PAGES.filter((page) => translated(page.source) && !listed.has(page.route))
        expect(
          silent.map((page) => page.route),
          'this admin page renders dictionary strings under the shell’s `lang="en"` — add it to TRANSLATED_UNDER_THE_ADMIN_SHELL and declare `lang={locale}` on the parts that are translated',
        ).toEqual([])
      })

      it('makes every listed admin page declare the other language back', () => {
        const byRoute = new Map(ADMIN_PAGES.map((page) => [page.route, page.source]))
        for (const row of TRANSLATED_UNDER_THE_ADMIN_SHELL) {
          const source = byRoute.get(row.route)
          expect(source, `${row.route} is listed but is not a page under app/admin`).toBeDefined()
          // A dynamic `lang`, not a literal: the whole point is that the marked
          // parts follow the locale being edited. `lang="en"` here would be the
          // mirror defect the row exists to prevent.
          expect(source, `${row.route} declares no dynamic language — SC 3.1.2`).toMatch(
            /lang=\{(locale|option)\}/,
          )
          expect(row.why, `${row.route} is under the admin shell, so it is mixed by definition`).toBe(
            'mixed',
          )
          expect(row.note.length, `${row.route} says nothing a reader could disagree with`).toBeGreaterThan(20)
        }
      })

      it('lists no admin page that stopped being translated', () => {
        // The overstating direction, same as the public half: a row claiming a
        // screen renders Spanish after somebody took the switcher off it.
        const byRoute = new Map(ADMIN_PAGES.map((page) => [page.route, page.source]))
        const stale = TRANSLATED_UNDER_THE_ADMIN_SHELL.filter((row) => {
          const source = byRoute.get(row.route)
          return source !== undefined && !translated(source)
        })
        expect(
          stale.map((row) => row.route),
          'these admin pages render no dictionary string now — drop the row and the `lang={locale}` marks with it',
        ).toEqual([])
      })

      // The two lists describe different surfaces and must not overlap: a route
      // in both would be claimed as English-under-a-Spanish-shell AND
      // Spanish-under-an-English-one.
      it('keeps the public and admin lists disjoint', () => {
        const publicRoutes = new Set(ENGLISH_UNDER_A_TRANSLATED_SHELL.map((row) => row.route))
        const both = TRANSLATED_UNDER_THE_ADMIN_SHELL.filter((row) => publicRoutes.has(row.route))
        expect(both.map((row) => row.route)).toEqual([])
      })
    })
  })
})
