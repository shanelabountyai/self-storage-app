import { readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// B-324. PRD 01 §6.2: "Tap targets ≥44×44px" on the customer site. B-112 put
// every customer control on `--control-h` (2.75rem), but two hand-written
// `h-9` (36px) amount inputs survived it — on the two fields where a customer
// types the money they are about to pay. The fix was two lines; this guard is
// the durable half, because the next raw control is the real risk.
//
// Not a WCAG 2.1 AA criterion (2.5.5 is AAA; 2.5.8 is WCAG 2.2 and met at
// 36px) — it is this repo's own gate. Admin is deliberately out of scope: its
// density is set by `app/admin/layout.tsx`, and §6.2 is scoped to customers.

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

/// `h-9` as a whole class token, with or without a variant prefix (`sm:h-9`).
const RAW_36PX = /(?<![\w-])h-9(?![\w.-])/

describe('customer controls stay on --control-h (B-324)', () => {
  it('matches the class token and nothing that merely contains it', () => {
    expect(RAW_36PX.test('className="border h-9 px-2"')).toBe(true)
    expect(RAW_36PX.test('className="sm:h-9"')).toBe(true)
    for (const fine of ['h-90', 'min-h-9', 'h-9.5', 'h-(--control-h,2.75rem)']) {
      expect(RAW_36PX.test(fine)).toBe(false)
    }
  })

  it('no h-9 literal appears on a customer surface', () => {
    const offenders = CUSTOMER_SCOPES.flatMap((scope) => filesUnder(join(webDir, scope)))
      .flatMap((file) =>
        readFileSync(file, 'utf8')
          .split('\n')
          .flatMap((line, i) => (RAW_36PX.test(line) ? [`${file.slice(webDir.length + 1)}:${i + 1}`] : [])),
      )
    expect(offenders).toEqual([])
  })
})
