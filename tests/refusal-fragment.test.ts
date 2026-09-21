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
  {
    // B-314. One file: unlike `/portal/pay`, the form here is inline rather
    // than a separate component.
    what: '/pay/[token] refuses an amount',
    fragment: 'amount-problem',
    submits: 'apps/web/app/pay/[token]/page.tsx',
    refuses: 'apps/web/app/pay/[token]/page.tsx',
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
    //
    // B-302 made `/portal/pay`'s id an expression rather than a literal — the
    // same id now also feeds the field's `aria-describedby`, so it is derived
    // once — hence the two shapes. The literal still has to be in the file
    // either way, which is what keeps this anchored to the fragment above.
    expect(page).toMatch(new RegExp(`id=(?:"${fragment}"|\\{\\w+\\})\\s*\\n\\s*tabIndex=\\{-1\\}`))
    expect(page).toMatch(new RegExp(`["']${fragment}["']`))
  })
})

// B-302. The other half of the same refusal, and the half a fragment cannot
// give: a reader who walks the form by CONTROL rather than by focus lands on
// "Amount in dollars, edit text" and is told nothing, because the paragraph
// refusing the amount renders outside the `<details>` the field lives in. PRD
// 01 §6.8 states the case in these words — "a summary block alone is not
// enough" — and `a11y.true.errors` claims it on the public statement page.
//
// Asserted against the source for the same reason the block above is, plus one
// of its own: `/pay/[token]` is reachable only with a live pay-link token, so
// no unit test can render it and only `e2e/pay-link.spec.ts` sees it at all.
// `e2e/portal.spec.ts` proves the wiring really reaches the rendered DOM on the
// route a press can reach.
const DESCRIBED = [
  {
    what: '/portal/pay',
    // The page decides the id; the form component receives it and is the thing
    // that carries the ARIA, so both halves have to line up.
    files: ['apps/web/app/portal/pay/page.tsx', 'apps/web/components/portal/pay-amount-form.tsx'],
    prop: 'problemId',
  },
  {
    what: '/pay/[token]',
    files: ['apps/web/app/pay/[token]/page.tsx'],
    prop: 'amountProblemId',
  },
]

describe('a refused amount is tied to the field that was refused (B-302)', () => {
  it.each(DESCRIBED)('$what marks the amount input invalid and describes it', ({ files, prop }) => {
    const source = files.map((f) => readFileSync(root(f), 'utf8')).join('\n')

    // The id is derived once, from the refusal, and is `undefined` when there
    // is nothing to point at — an `aria-describedby` naming an element that is
    // not on the page is worse than none.
    expect(source).toContain("? 'amount-problem' : undefined")
    expect(source).toMatch(/id=\{amountProblemId\}/)

    expect(source).toContain(`aria-invalid={${prop} ? true : undefined}`)
    expect(source).toContain(`aria-describedby={${prop}}`)
  })

  it.each(DESCRIBED)('$what echoes the refused amount back rather than the balance', ({ files }) => {
    // `amountCents` has fallen back to the whole balance so the Payment Element
    // still has a chargeable figure. Seeding the field from it is what rewrote
    // a Spanish reader's "12,50" as "1284.00" (SC 3.3.3).
    const page = readFileSync(root(files[0]), 'utf8')
    expect(page).toMatch(/amountProblemId \? requested : \(amountCents \/ 100\)\.toFixed\(2\)/)
  })

  it.each(DESCRIBED)('$what names the figure the Payment Element will charge (B-337)', ({ files }) => {
    // The field keeps the refused amount, so the refusal has to say that Pay
    // charges the fallback — the same expression the Payment Element is given.
    const page = readFileSync(root(files[0]), 'utf8')
    expect(page).toContain("t('paypg.refusedChargesBalance', { amount: formatRate(amountCents) })")
    expect(page).toContain('amountLabel={formatRate(amountCents)}')
  })
})
