import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// B-249 / WCAG 2.1 SC 4.1.2 Name, Role, Value.
//
// Fifty-six horizontally-scrolling wrappers had accumulated as bare
// `<div tabIndex={0} className="overflow-x-auto">`. Each is a focus stop; none
// had a role or a name, so tabbing through `/admin/reports` landed on a <div>
// that VoiceOver read as its first cell and NVDA typically did not announce at
// all.
//
// **No scan can replace this test.** axe's `scrollable-region-focusable` only
// checks that a scroll container IS focusable — a focusable one with no name
// passes it, which is precisely how fifty-six of them shipped. Nor can the
// typed `aria-label` on `<ScrollRegion>` cover it: that stops a nameless
// ScrollRegion compiling, and this stops the next one being hand-rolled as a
// <div> again, which is the way all fifty-six arrived.
const repoRoot = fileURLToPath(new URL('..', import.meta.url))

/// `git grep` rather than a directory walk: it respects .gitignore for free, so
/// `.next`, `node_modules` and the build cache cannot produce a phantom hit.
function gitGrep(pattern: string): string[] {
  try {
    // `--untracked` is not optional. Without it `git grep` searches only
    // COMMITTED files, so a bare region in a file you have just written passes
    // — which is exactly when this test is supposed to speak. It is also how
    // this test first went green: `scroll-region.tsx` was still untracked, so
    // its own implementation line was invisible, and the hole only appeared
    // once B-249 was committed.
    //
    // `:(exclude)` on the component itself, because it is the one sanctioned
    // implementation of the shape and would otherwise report itself forever.
    return execFileSync('git', ['grep', '--untracked', '-n', '-E', pattern, '--', 'apps/web/**/*.tsx',
      ':(exclude)apps/web/components/ui/scroll-region.tsx'], {
      cwd: repoRoot,
      encoding: 'utf8',
    })
      .trim()
      .split('\n')
      .filter(Boolean)
  } catch {
    // git grep exits 1 when nothing matches, which is the passing case.
    return []
  }
}

describe('focusable scroll regions', () => {
  it('has no focusable scroll container outside <ScrollRegion>', () => {
    const hits = gitGrep('tabIndex=\\{0\\}').filter((line) => /overflow-(x-|y-)?auto/.test(line))

    // Comments are excluded rather than specific files whitelisted: two of
    // them QUOTE the shape they replaced (`ScrollRegion`'s own doc comment and
    // the accessibility page's re-read log), and a whitelist would go stale the
    // moment a third does.
    const offenders = hits.filter((line) => {
      const code = line.split(':').slice(2).join(':').trim()
      return !code.startsWith('//') && !code.startsWith('*')
    })

    expect(
      offenders,
      'a focusable scroll container is a control that announces nothing — use <ScrollRegion aria-label="…">',
    ).toEqual([])
  })

  it('gives the regions on one page distinct names', () => {
    // A rotor listing "Table" four times is the defect this row fixed, wearing
    // a name. Static names only — two regions take theirs from a prop or a
    // section field and cannot be read from source.
    const byFile = new Map<string, string[]>()
    for (const line of gitGrep('<ScrollRegion aria-label="')) {
      const [file] = line.split(':')
      const name = /aria-label="([^"]*)"/.exec(line)?.[1]
      if (name) byFile.set(file, [...(byFile.get(file) ?? []), name])
    }

    expect(byFile.size).toBeGreaterThan(0)
    for (const [file, names] of byFile) {
      expect(new Set(names).size, `${file} names two scroll regions the same`).toBe(names.length)
    }
  })

  it('keeps the class pair B-217 styles the scrollbar on', () => {
    const source = execFileSync('git', ['show', 'HEAD:apps/web/app/globals.css'], {
      cwd: repoRoot,
      encoding: 'utf8',
    })

    // `globals.css` selects `[tabindex="0"].overflow-x-auto` to draw the
    // visible scrollbar B-217 added. `ScrollRegion` has to keep both on the
    // same node or that affordance silently stops matching — a change nothing
    // else would catch, because the region still scrolls and still focuses.
    expect(source).toContain('[tabindex="0"].overflow-x-auto')
  })
})
