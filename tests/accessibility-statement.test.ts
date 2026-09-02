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

describe('the public accessibility statement', () => {
  it('only claims PR-time scanning while CI actually triggers on ready-for-review', () => {
    const claimsPullRequests = page.includes('pull request that is open for review')

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
    // `LAST_REVIEWED` appears twice in the rendered page — introducing "these
    // are the problems we know about, as of X" and again as "Last reviewed: X".
    // A future edit that hard-codes either one would let the two drift, and the
    // page would date its shortfalls differently from its review. B-254 owns
    // what MOVES the constant; this only holds the two uses to one value.
    expect(page.match(/\{LAST_REVIEWED\}/g)?.length ?? 0).toBeGreaterThanOrEqual(2)
    expect(page).toMatch(/const LAST_REVIEWED = '[^']+'/)
  })
})
