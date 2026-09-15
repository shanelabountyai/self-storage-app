import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { en } from '../apps/web/lib/i18n/en'
import { es } from '../apps/web/lib/i18n/es'

// B-250 / PRD 01 §6.8. The accessibility statement claims only what is true
// today, and its comment log records any sentence that changes truth value —
// in either direction.
//
// The log missed one, which is why this test exists. "How we check" says
// automated tests run *"on every pull request that is open for review"*, and
// that was **false for the entire life of the split CI lanes**: `ready_for_review`
// is not a default `pull_request` activity type, so `gh pr ready` fired no
// workflow event and sixteen PRs reported `e2e=skipping`. B-218 made the
// sentence true by adding the trigger, and neither the falsehood nor the fix
// was recorded here until a review found it.
//
// The shape of that defect is what this guards: **a sentence on a public page
// whose truth lives in a config file nobody re-reads when they edit it.**
// Deleting the trigger would make the page lie again, silently, and no other
// test in this repo would notice.
//
// B-262 moved every sentence on that page into the message dictionaries, so
// the claim is no longer IN the page source and a source grep would pass
// against a page that says nothing. The claim is read from `en` instead, and
// asserted in BOTH languages: a bilingual statement can now go false in one
// language and stay true in the other, which is a way for this page to lie
// that did not exist before the translation.
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')

const page = read('../apps/web/app/(public)/accessibility/page.tsx')
const workflow = read('../.github/workflows/ci.yml')

describe('the public accessibility statement', () => {
  it('only claims PR-time scanning while CI actually triggers on ready-for-review', () => {
    const claimsPullRequests = en['a11y.check.ci'].includes('pull request that is open for review')

    // The `types:` LINE, not any mention of the string. The first draft of this
    // test used `workflow.includes('ready_for_review')` and passed happily with
    // the trigger deleted, because `ci.yml` carries a comment explaining why
    // `ready_for_review` is not a default activity type. A guard that a comment
    // can satisfy is not a guard.
    const triggers = /^\s*types:\s*\[([^\]]*)\]/m.exec(workflow)?.[1] ?? ''
    const readyForReview = triggers.split(',').some((t) => t.trim() === 'ready_for_review')

    // Both directions: the claim and the trigger stand or fall together. If the
    // sentence is ever softened, this test must stop demanding the trigger
    // rather than fail — the page is allowed to claim less than it does.
    expect(
      claimsPullRequests && readyForReview,
      claimsPullRequests
        ? 'the page claims scans run on PRs open for review, but ci.yml has no ready_for_review trigger — the claim is false (B-218)'
        : 'the page no longer makes the PR claim; drop this assertion rather than leaving it inverted',
    ).toBe(claimsPullRequests)
  })

  it('dates its known-shortfalls list with the same constant the list is introduced by', () => {
    // The date appears twice in the rendered page — introducing "these are the
    // problems we know about, as of X" and again as "Last reviewed: X". A
    // future edit that hard-codes either one would let the two drift, and the
    // page would date its shortfalls differently from its review. B-254 owns
    // what MOVES the constant; this only holds the two uses to one value.
    //
    // Since B-262 both uses go through `reviewed`, which formats the one
    // constant per locale — so the pair can no longer drift by language
    // either, which a second hard-coded Spanish date would have allowed.
    expect(page.match(/\{ date: reviewed \}/g)?.length ?? 0).toBeGreaterThanOrEqual(2)
    expect(page).toMatch(/const LAST_REVIEWED = '\d{4}-\d{2}-\d{2}'/)
  })

  it('carries the CI claim in both languages or in neither', () => {
    // The bilingual failure mode: soften the English and leave the Spanish
    // promising PR-time scans, and half the readers are told something false.
    // Whichever way the sentence moves, the pair moves together.
    const enClaims = en['a11y.check.ci'].includes('pull request that is open for review')
    const esClaims = es['a11y.check.ci'].includes('solicitud de cambios que está abierta a revisión')
    expect(esClaims, 'the Spanish accessibility statement disagrees with the English about PR-time scanning').toBe(enClaims)
  })

  // B-302. `a11y.true.errors` is the one sentence in the "what is true today"
  // list that is NOT scoped — `a11y.true.keyboard` directly above it says "this
  // public site", and `a11y.intro` says "every page and every flow" — so it
  // reads as a claim about the product. It was false on the three screens where
  // an amount is typed: the refusal rendered as a standalone paragraph outside
  // the `<details>` holding the field, with no `aria-invalid` and no
  // `aria-describedby`, and the refused figure was overwritten with the whole
  // balance. Both halves of the sentence, on the money path, in the
  // OVERSTATING direction.
  //
  // Same shape as the CI test above and guarded the same way: the sentence's
  // truth lives in files nobody re-reads when editing this page.
  it('ties its error-message claim to the three screens where an amount is typed', () => {
    const claimsTied = en['a11y.true.errors'].includes('tied to the field itself')
    const claimsKept = en['a11y.true.errors'].includes('what you already entered is still there')

    const source = [
      // One screen per entry. `/portal/pay` is two files because the page
      // decides the id and the client form carries the ARIA, so neither half
      // is the whole answer.
      ['apps/web/app/portal/pay/page.tsx', 'apps/web/components/portal/pay-amount-form.tsx'],
      ['apps/web/app/pay/[token]/page.tsx'],
      // Staff-facing, and in scope because the sentence excludes nothing.
      ['apps/web/app/admin/pos/card/page.tsx'],
    ].map((files) => files.map((file) => read(`../${file}`)).join('\n'))

    const tied = source.every((f) => f.includes('aria-invalid=') && f.includes('aria-describedby='))
    // The bare fallback, which is what replaced the tenant's number. Anchored
    // to the seeding position rather than to `amountCents` itself, which every
    // one of these files legitimately still uses for the figure it charges.
    const kept = source.every(
      (f) => !/(?:defaultValue=|useState\()\{?\(amountCents \/ 100\)/.test(f),
    )

    expect(
      tied,
      claimsTied
        ? 'the statement says a rejection is tied to its field, but an amount form has no aria-invalid/aria-describedby'
        : 'the statement no longer makes the tied claim; scope this assertion to match rather than leaving it inverted',
    ).toBe(claimsTied)
    expect(
      kept,
      claimsKept
        ? 'the statement says a rejected value is still there, but an amount field is seeded from the fallback balance'
        : 'the statement no longer makes the kept claim; scope this assertion to match',
    ).toBe(claimsKept)
  })

  it('carries the error-message claim in both languages or in neither', () => {
    // The same bilingual failure the CI claim has, on a sentence B-283 and
    // B-284 had only just translated.
    const enClaims = en['a11y.true.errors'].includes('what you already entered is still there')
    const esClaims = es['a11y.true.errors'].includes('lo que ya había escrito sigue ahí')
    expect(
      esClaims,
      'the Spanish accessibility statement disagrees with the English about rejected values being kept',
    ).toBe(enClaims)
  })

  it('does not move the review date for a correction (D-115, B-254)', () => {
    // `LAST_REVIEWED` is a claim that a PERSON re-read the page, including the
    // "where we fall short" list. Correcting an overstatement does not make
    // that true, and B-254 — a VoiceOver/NVDA pass nobody has run — is the only
    // row allowed to move it. Pinned so a bump has to be a deliberate edit to
    // this line rather than a side effect of an accessibility fix.
    expect(page).toContain("const LAST_REVIEWED = '2026-08-19'")
  })
})
