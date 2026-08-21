import { expect, type Locator } from '@playwright/test'

// B-156 / PRD 02 §5.5 FR-25(3). "A control that does nothing fails CI" — the
// cheapest catch the accessibility review named: after a submit, a live
// region that was ALREADY ATTACHED before the submit has non-empty text.
//
// The locator must be captured and checked BEFORE the action, not fetched
// fresh afterward — a fresh locator would pass even if the element had been
// unmounted and remounted already populated, which is the exact announcement
// failure `AdminForm`'s own comment warns against (FR-20: "a live region
// inserted into the DOM already populated is unreliably announced by
// VoiceOver and routinely missed by NVDA"). `expectPreexisting` is what turns
// that into something CI checks rather than something a comment asserts.
//
// Only safe to use on a region that is unconditionally mounted — `AdminForm`'s
// own success `role="status"` paragraph is (empty at idle, always present);
// its error/confirm summary is NOT (conditionally rendered only once the
// action has failed once), so this helper cannot yet verify the error path
// pre-exists — that gap is real and is left for a future item, not silently
// worked around here.
export async function expectPreexisting(region: Locator): Promise<void> {
  await expect(region).toBeAttached()
  await expect(region).toHaveText('')
}

export async function expectAnnounced(region: Locator, pattern: string | RegExp): Promise<void> {
  await expect(region).toHaveText(pattern)
}
