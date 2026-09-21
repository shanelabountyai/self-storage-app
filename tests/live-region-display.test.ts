import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// B-334 / WCAG 2.1 SC 4.1.3 Status Messages (AA).
//
// A live region that is `display:none` while empty is out of the accessibility
// tree until the moment it has text — so it "appears with the event", which is
// exactly the region screen readers do not announce. B-111 removed
// `empty:hidden` from `AdminForm`'s region, `announce.tsx` forbids it in
// writing, and the counter's Method-reset region (B-319) shipped with it
// anyway. Comments did not stop the third one; this does. An idle region is
// `sr-only`, never `hidden`, `empty:hidden` or `display:none`.
const repoRoot = fileURLToPath(new URL('..', import.meta.url))

// ponytail: regex over opening tags, not a TSX parse. A prop holding `=>`
// before `role` ends the match early and slips past; parse with TypeScript if
// that ever happens.
const OPENING_TAG = /<[A-Za-z][\w.]*\s[^<>]*?(?:role="status"|aria-live)[^<>]*>/g
const HIDDEN = /(?<=[\s"'`{])(?:[\w-]+:)*hidden(?=[\s"'`}=>]|$)|display:\s*['"]?none/

/// The hidden live regions in `source`. A comment inside a tag may name the
/// forbidden class in order to forbid it (`announce.tsx` does), so it is
/// stripped first.
function hiddenRegions(source: string): string[] {
  return [...source.matchAll(OPENING_TAG)]
    .map(([tag]) => tag.replace(/\/\/.*$/gm, '').replace(/\s+/g, ' '))
    .filter((tag) => HIDDEN.test(tag))
}

function tsxFiles(): string[] {
  // `--others --exclude-standard` for the same reason scroll-regions.test.ts
  // passes `--untracked`: a file you have just written is when this speaks.
  return execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', 'apps/web/**/*.tsx'], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
    .trim()
    .split('\n')
    .filter(Boolean)
}

describe('live regions', () => {
  it('are never display:none while idle', () => {
    const offenders = tsxFiles().flatMap((file) =>
      hiddenRegions(readFileSync(`${repoRoot}${file}`, 'utf8')).map((tag) => `${file}: ${tag}`),
    )
    expect(offenders).toEqual([])
  })

  it('catches the shape it guards against', () => {
    const tag = (source: string) => hiddenRegions(source).length > 0
    expect(tag('<p role="status" className="text-sm empty:hidden">')).toBe(true)
    expect(tag('<div aria-live="polite"\n  hidden>')).toBe(true)
    expect(tag('<p role="status" className={x ? "a" : "hidden"}>')).toBe(true)
    expect(tag(`<p aria-live="polite" style={{ display: 'none' }}>`)).toBe(true)
    expect(tag('<p role="status" className="empty:sr-only overflow-hidden" aria-hidden>')).toBe(false)
  })
})
