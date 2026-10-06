import { readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// B-441 (a). SC 1.4.11: a form control's boundary needs 3:1 against what is
// behind it. `border-input` is the token `tests/contrast-tokens.test.ts` holds
// to that; a bare `border` falls back to `--border`, which is a hairline for
// cards and is not. Review block 13's A1 fixed the raw controls by hand; this
// is the durable half, the same shape as `customer-control-height.test.ts`.
//
// It reads the literal text of the `className` attribute only. A class that
// arrives through a variable is not seen — the guard is for the hand-written
// control, which is the one that went wrong.

const webDir = fileURLToPath(new URL('../apps/web', import.meta.url))

const CUSTOMER_SCOPES = [
  'app/portal',
  'app/pay',
  'app/(public)',
  'components/portal',
  'components/checkout',
  'components/site',
]

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) return filesUnder(path)
    return path.endsWith('.tsx') ? [path] : []
  })
}

/// The index just past the first `closer` after `start` that is not inside a
/// `{...}` expression or a quoted string — so `=>` and `a > b` do not end a tag.
function endOf(src: string, start: number, closer: '>' | '}'): number {
  let depth = 0
  let quote = ''
  for (let i = start; i < src.length; i++) {
    const c = src[i]
    if (quote) {
      if (c === quote && src[i - 1] !== '\\') quote = ''
    } else if (c === '"' || c === "'" || c === '`') quote = c
    else if (c === closer && depth === 0) return i + 1
    else if (c === '{') depth++
    else if (c === '}') depth--
  }
  return src.length
}

/// `border` or a side/width form of it (`border-b`, `border-2`, `sm:border`):
/// a class that DRAWS a border, as opposed to one that colours it.
const DRAWS_BORDER = /(?<![\w-])border(?:-[xytrbl])?(?:-[1-9]\d*)?(?![\w-])/
const BORDER_INPUT = /(?<![\w-])border-input(?![\w-])/

/// Line numbers (1-based) of raw controls whose className draws a border
/// without `border-input`.
export function offendersIn(src: string): number[] {
  const lines: number[] = []
  for (const m of src.matchAll(/<(?:input|select|textarea)\b/g)) {
    const tag = src.slice(m.index, endOf(src, m.index, '>'))
    const at = tag.indexOf('className=')
    if (at === -1) continue
    const open = at + 'className='.length
    const value =
      tag[open] === '{'
        ? tag.slice(open, endOf(tag, open + 1, '}'))
        : tag.slice(open, tag.indexOf(tag[open], open + 1) + 1)
    if (DRAWS_BORDER.test(value) && !BORDER_INPUT.test(value)) {
      lines.push(src.slice(0, m.index).split('\n').length)
    }
  }
  return lines
}

describe('customer form controls draw their border in border-input (B-441)', () => {
  it('flags a bordered control without the token and nothing else', () => {
    expect(offendersIn('<input className="h-10 rounded border px-2" />')).toEqual([1])
    expect(offendersIn('\n<select\n  onChange={(e) => go(e.target.value > 1)}\n  className={cn("border-b", x)}\n>')).toEqual([2])
    expect(offendersIn('<textarea className="sm:border-2" />')).toEqual([1])
    for (const fine of [
      '<input className="border border-input px-2" />',
      '<input className="border-0" type="checkbox" />',
      '<input className="rounded-md px-2" />',
      '<input type="hidden" name="a" />',
      // The border is on the wrapper, not the control.
      '<div className="border"><input className="px-2" /></div>',
      // A later attribute's class is not this control's.
      '<input className="px-2" /><p className="border" />',
    ]) {
      expect(offendersIn(fine), fine).toEqual([])
    }
  })

  it('no raw customer control draws a border without border-input', () => {
    const offenders = CUSTOMER_SCOPES.flatMap((scope) => filesUnder(join(webDir, scope))).flatMap(
      (file) => offendersIn(readFileSync(file, 'utf8')).map((line) => `${file.slice(webDir.length + 1)}:${line}`),
    )
    expect(offenders).toEqual([])
  })
})
