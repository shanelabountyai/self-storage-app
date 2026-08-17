import { DUPLICATE_THRESHOLD, similarity } from './profile.ts'

// PRD 04 §7 Phase 2 (B-082 part 6). Duplicate content, across the whole site
// rather than one field at a time.
//
// B-067 already warns a marketer when the facility meta description they are
// typing matches another facility's. That is the right warning in the right
// place and it covers ONE field, at edit time, for the one page being edited.
// It cannot see the two collisions that actually matter:
//
//   * Long-form descriptions, which are the largest block of text on a facility
//     page and therefore the biggest thin-content lever there is.
//   * GENERATED copy, which no editor ever opens. The city pages' intro text is
//     derived from the facilities in the city (D-58) and is templated by
//     construction — that was accepted deliberately, with the honest note that
//     it is thin-content protection at the floor rather than a marketing asset.
//     This is the check that says whether the floor is holding.
//
// Pairwise within a field kind and never across kinds. Comparing a 155-character
// meta description against a 600-word long description would score low for
// reasons of length rather than content, and the pairs it did surface would be
// noise — which is how a report like this gets ignored and then deleted.

/// One piece of text that a page publishes.
export type ContentItem = {
  /// Unique within the corpus. Used to pair rows, never shown.
  key: string
  /// What a reader should click to go and fix it.
  url: string
  /// Which page this belongs to, in the operator's words ("Demo — Austin South").
  label: string
  /// Only items sharing a kind are compared. Also the heading a group renders
  /// under, so it is written for a person.
  kind: string
  /// Whether a person wrote this or the product derived it. The fix is
  /// completely different — an authored collision means somebody pasted, a
  /// generated one means nobody has written real copy for that page yet — so
  /// the report says which rather than leaving it to be inferred.
  origin: 'authored' | 'generated'
  text: string
}

export type DuplicatePair = {
  kind: string
  left: ContentItem
  right: ContentItem
  similarity: number
  /// True when BOTH sides are generated. Named because it is the least
  /// alarming and most expected case — templated copy resembling templated
  /// copy — and mixing it in with two pasted descriptions would make the
  /// urgent ones harder to find.
  bothGenerated: boolean
}

/// Every pair above the threshold, worst first.
///
/// ponytail: an O(n²) comparison inside each kind. At a few hundred pages that
/// is tens of thousands of trigram intersections and runs in well under a
/// second; the upgrade when it stops being small is a minhash/LSH prefilter so
/// only plausible pairs are scored, and the trigger is this report taking long
/// enough that somebody notices it loading.
export function findDuplicatePairs(
  items: readonly ContentItem[],
  threshold: number = DUPLICATE_THRESHOLD,
): DuplicatePair[] {
  const usable = items.filter((item) => item.text.trim().length > 0)
  const pairs: DuplicatePair[] = []

  const byKind = new Map<string, ContentItem[]>()
  for (const item of usable) {
    const bucket = byKind.get(item.kind)
    if (bucket) bucket.push(item)
    else byKind.set(item.kind, [item])
  }

  for (const [kind, group] of byKind) {
    for (let i = 0; i < group.length; i += 1) {
      for (let j = i + 1; j < group.length; j += 1) {
        const score = similarity(group[i].text, group[j].text)
        if (score < threshold) continue
        // Ordered by label so the same pair always renders the same way round;
        // otherwise the report reshuffles itself between loads for no reason.
        const [left, right] =
          group[i].label.localeCompare(group[j].label) <= 0
            ? [group[i], group[j]]
            : [group[j], group[i]]
        pairs.push({
          kind,
          left,
          right,
          similarity: score,
          bothGenerated: left.origin === 'generated' && right.origin === 'generated',
        })
      }
    }
  }

  return pairs.sort(
    (a, b) =>
      // Authored collisions first whatever their score: somebody pasted, and
      // that is both more surprising and more likely to be a mistake than two
      // generated pages resembling each other.
      Number(a.bothGenerated) - Number(b.bothGenerated) ||
      b.similarity - a.similarity ||
      a.left.label.localeCompare(b.left.label),
  )
}

export type DuplicateReport = {
  pairs: DuplicatePair[]
  /// How many items were compared, so an empty report reads as "we checked 41
  /// pages and found nothing" rather than as "this is broken".
  compared: number
  /// Kinds that had fewer than two items — nothing to compare them against.
  /// Reported rather than hidden, because "no duplicates in guides" and "there
  /// is only one guide" are different statements.
  singletons: string[]
}

export function duplicateReport(
  items: readonly ContentItem[],
  threshold: number = DUPLICATE_THRESHOLD,
): DuplicateReport {
  const usable = items.filter((item) => item.text.trim().length > 0)
  const counts = new Map<string, number>()
  for (const item of usable) counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1)

  return {
    pairs: findDuplicatePairs(usable, threshold),
    compared: usable.length,
    singletons: [...counts.entries()]
      .filter(([, count]) => count < 2)
      .map(([kind]) => kind)
      .sort(),
  }
}
