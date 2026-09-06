import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

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
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')

const page = read('../apps/web/app/(public)/accessibility/page.tsx')
const workflow = read('../.github/workflows/ci.yml')

// B-262 moved every sentence on that page into the dictionaries so it could be
// read in Spanish, which quietly broke this file: the claim below stopped being
// IN the page, so `page.includes(...)` went false and the assertion started
// passing vacuously — the exact "guard a comment can satisfy" failure the note
// above was written about, one level up. The claim is checked where it now
// lives, in BOTH languages, because a Spanish statement is a public claim about
// this codebase on the same footing as the English one.
const dictionaries = {
  en: read('../apps/web/lib/i18n/en.ts'),
  es: read('../apps/web/lib/i18n/es.ts'),
}

describe('the public accessibility statement', () => {
  it('only claims PR-time scanning while CI actually triggers on ready-for-review', () => {
    const claimsPullRequests = dictionaries.en.includes('pull request that is open for review')

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

  it('makes the same scanning claim in Spanish as in English', () => {
    // Not a translation check — the dictionary key test covers that. This is
    // about the two pages making the SAME claim: if the English sentence is
    // ever softened because the trigger went away, a Spanish sentence left
    // behind still tells a Spanish reader the scans run on every PR. The
    // Spanish wording for it is "cada propuesta de cambio que está abierta
    // para revisión".
    expect(dictionaries.en.includes('pull request that is open for review')).toBe(
      dictionaries.es.includes('propuesta de cambio que está abierta para revisión'),
    )
  })

  it('dates its known-shortfalls list with the same constant the list is introduced by', () => {
    // The date appears twice in the rendered page — introducing "these are the
    // problems we know about, as of X" and again as "Last reviewed: X". A
    // future edit that hard-codes either one would let the two drift, and the
    // page would date its shortfalls differently from its review. B-254 owns
    // what MOVES the constant; this only holds the two uses to one value.
    //
    // B-262 put a formatter between the constant and the page — the date is
    // rendered "19 de agosto de 2026" in Spanish — so what is counted is the
    // formatted value rather than the constant. The constant is still checked
    // for its shape, and it is an ISO date now precisely so it can be
    // formatted per language rather than being an English string in a Spanish
    // sentence.
    expect(page.match(/\{ date: reviewed \}/g)?.length ?? 0).toBeGreaterThanOrEqual(2)
    expect(page).toMatch(/const LAST_REVIEWED = '\d{4}-\d{2}-\d{2}'/)
  })
})
