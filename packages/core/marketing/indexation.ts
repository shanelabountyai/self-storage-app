// PRD 04 §7 Phase 2 (B-082 part 5): "Search Console integration for
// indexation monitoring."
//
// The question this answers is not "how are we ranking" — that is a different
// report and a different API. It is narrower and more useful: **of the pages we
// publish, which ones has Google actually indexed?** A facility page that is in
// our sitemap, returns 200, and is not in the index earns nothing, and there is
// no way to notice that from inside our own logs.
//
// Everything here is pure: Google's vocabulary translated into ours, and the
// summary an operator reads. The HTTP lives in the app layer, so this file can
// be tested — and Google's response shapes pinned — without a network or a
// credential.

/// Our vocabulary, which is deliberately smaller than Google's.
///
/// `coverageState` is a free-text English sentence that Google changes without
/// warning ("Submitted and indexed", "Crawled - currently not indexed", …).
/// Switching on it directly would make this report break silently the next time
/// somebody rewords a string, so the SENTENCE is kept for display and the
/// DECISION is taken from `verdict`, which is an enum.
export type IndexState =
  | 'indexed'
  /// Google knows the URL and has decided not to index it, or has not got to it
  /// yet. The one an operator has to act on.
  | 'not_indexed'
  /// Google could not fetch it, or the inspection itself failed. Distinct from
  /// `not_indexed` because the fix is different: this is ours to repair.
  | 'error'
  /// Not asked yet. A URL in our sitemap that no inspection has covered.
  | 'unknown'

export type UrlIndexation = {
  url: string
  state: IndexState
  /// Google's own sentence, shown verbatim beside our verdict. An operator
  /// searching for the exact phrase in Google's documentation should find it,
  /// which a paraphrase would prevent.
  coverageState: string | null
  lastCrawledAt: string | null
  /// Present only for `error` — what went wrong, in our words.
  problem: string | null
}

/// Google's `urlInspection.index.inspect` response, narrowed to what is read.
///
/// Typed as optional throughout on purpose: this is a third-party payload and
/// treating any part of it as guaranteed is how a report 500s on the day Google
/// omits a field for one URL.
export type InspectionPayload = {
  inspectionResult?: {
    indexStatusResult?: {
      verdict?: string
      coverageState?: string
      lastCrawlTime?: string
      pageFetchState?: string
    }
  }
}

/// Maps one inspection response onto our verdict.
///
/// `PASS` is the only verdict that means indexed. `NEUTRAL` and `PARTIAL` both
/// mean Google has an opinion short of "yes", and both are actionable in the
/// same way, so they collapse — a report with five shades of "not really" is
/// one nobody reads to the end.
export function readInspection(url: string, payload: InspectionPayload): UrlIndexation {
  const result = payload.inspectionResult?.indexStatusResult
  const coverageState = result?.coverageState ?? null
  const lastCrawledAt = result?.lastCrawlTime ?? null

  if (!result || !result.verdict) {
    return {
      url,
      state: 'error',
      coverageState,
      lastCrawledAt,
      problem: 'Google answered without an index verdict for this URL.',
    }
  }

  // A fetch failure is ours to fix and must not read as "Google chose not to
  // index this" — the two have completely different next actions.
  if (result.pageFetchState && !['SUCCESSFUL', 'PAGE_FETCH_STATE_UNSPECIFIED'].includes(result.pageFetchState)) {
    return {
      url,
      state: 'error',
      coverageState,
      lastCrawledAt,
      problem: `Google could not fetch the page (${result.pageFetchState}).`,
    }
  }

  return {
    url,
    state: result.verdict === 'PASS' ? 'indexed' : 'not_indexed',
    coverageState,
    lastCrawledAt,
    problem: null,
  }
}

export type IndexationSummary = {
  total: number
  indexed: number
  notIndexed: number
  errors: number
  unknown: number
  /// The URLs an operator should look at, worst first. Errors before
  /// not-indexed because a page Google cannot fetch is a problem on our side.
  needsAttention: UrlIndexation[]
}

export function summarise(rows: readonly UrlIndexation[]): IndexationSummary {
  const rank: Record<IndexState, number> = { error: 0, not_indexed: 1, unknown: 2, indexed: 3 }
  return {
    total: rows.length,
    indexed: rows.filter((row) => row.state === 'indexed').length,
    notIndexed: rows.filter((row) => row.state === 'not_indexed').length,
    errors: rows.filter((row) => row.state === 'error').length,
    unknown: rows.filter((row) => row.state === 'unknown').length,
    needsAttention: rows
      .filter((row) => row.state === 'error' || row.state === 'not_indexed')
      .sort((a, b) => rank[a.state] - rank[b.state] || a.url.localeCompare(b.url)),
  }
}

/// Plain-language labels. One definition, because the count and the row would
/// otherwise describe the same state with two different words.
export const INDEX_STATE_LABELS: Record<IndexState, string> = {
  indexed: 'Indexed',
  not_indexed: 'Not indexed',
  error: 'Google could not fetch it',
  unknown: 'Not checked yet',
}
