import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// B-299. The three GET-submit refusals are focused by the BROWSER, not by
// script: the form submits to a fragment, and the paragraph that refuses
// carries that `id` plus `tabIndex={-1}` so the fragment has something
// focusable to land on. Nothing in the type system connects the two halves, so
// a typo in either one is completely silent — the page renders, the refusal
// says the right words, and focus goes back to `<body>`, which is the exact
// state this row exists to end.
//
// It is asserted here rather than only in a browser because two of the three
// cannot produce their own refusal on demand. `/portal/move-out`'s and
// `/portal/transfer`'s pickers are `type="date"` with `min`/`max`, so a date
// the preview would refuse is blocked by native constraint validation before it
// is submitted, and `/portal/transfer`'s preview refusals (`unit_not_available`
// and its siblings) are reachable only by a race — the unit being claimed
// between the page load and the press. `e2e/portal.spec.ts` proves the browser
// really does the focusing, on the one refusal a press can produce, and
// `e2e/portal-move-out.spec.ts` proves it against a real rendered refusal.
const root = (path: string) => fileURLToPath(new URL(`../${path}`, import.meta.url))

const WIRED = [
  {
    what: '/portal/pay refuses an amount',
    fragment: 'amount-problem',
    // A bare `action="#…"`, so the component does not hard-code its route.
    submits: 'apps/web/components/portal/pay-amount-form.tsx',
    refuses: 'apps/web/app/portal/pay/page.tsx',
  },
  {
    what: '/portal/transfer refuses a preview',
    fragment: 'preview-problem',
    submits: 'apps/web/app/portal/transfer/page.tsx',
    refuses: 'apps/web/app/portal/transfer/page.tsx',
  },
  {
    what: '/portal/move-out refuses a preview',
    fragment: 'preview-problem',
    submits: 'apps/web/app/portal/move-out/page.tsx',
    refuses: 'apps/web/app/portal/move-out/page.tsx',
  },
]

describe('a GET-submit refusal is submitted to and focusable (B-299)', () => {
  it.each(WIRED)('$what', ({ fragment, submits, refuses }) => {
    const form = readFileSync(root(submits), 'utf8')
    // `action` or `formAction`, ending in this fragment.
    expect(form).toMatch(new RegExp(`(?:formA|a)ction="[^"]*#${fragment}"`))

    const page = readFileSync(root(refuses), 'utf8')
    // `tabIndex={-1}` is not decoration: a fragment whose target is not
    // focusable leaves focus on the document and only moves the sequential
    // starting point, which announces nothing.
    expect(page).toMatch(new RegExp(`id="${fragment}"\\s*\\n\\s*tabIndex=\\{-1\\}`))
  })
})
