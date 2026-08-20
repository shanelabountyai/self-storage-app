// PRD 04 §7 Phase 3 (B-087 part 1). Fetching our own pages and checking that
// the markup they serve is still intact. The rules are pure and live in
// `@storage/core/marketing`; this is the HTTP and the HTML.
//
// It reads the SERVED page rather than calling the builders directly, and that
// is the whole point. Calling `selfStorageJsonLd()` here would prove that the
// function works, which the unit tests already prove. What can only be checked
// this way is whether the page is still calling it, still passing it real
// data, and still rendering the result into the document.

import { checkStructuredData, pageKind, summariseChecks, type LdBlock, type PageCheck } from '@storage/core/marketing'
import sitemap from '@/app/sitemap'
import { siteOrigin } from './origin'

/// How many pages one run covers.
///
/// Sized by patience rather than by any external limit: the pages are ours,
/// but this is opened by a person and also runs in a nightly job, and a
/// portfolio of a few facilities is far below this. Sequential fetches at
/// ~150ms each means 60 pages is about nine seconds.
///
/// ponytail: a fixed cap, oldest-first, no rotation. The upgrade when a
/// portfolio outgrows it is storing each verdict with a timestamp and checking
/// the least-recently-checked slice per run; the trigger is the sitemap
/// exceeding this number, which the report says out loud.
export const CHECK_LIMIT = 60

/// Extracts every JSON-LD block from a served HTML document.
///
/// A regex over HTML, which is normally the wrong tool — it is the right one
/// here because the target is exactly one unambiguous tag with no nesting and
/// no attribute ambiguity, and the alternative is a DOM parser dependency
/// added to make one substring match. The `[\s\S]` rather than `.` is not
/// stylistic: JSON-LD is pretty-printed across lines.
export function extractJsonLd(html: string): LdBlock[] {
  const pattern = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  const blocks: LdBlock[] = []

  for (const match of html.matchAll(pattern)) {
    const raw = match[1] ?? ''
    try {
      const parsed = JSON.parse(raw) as unknown
      // A page may emit an array of nodes in one script. Flattened, because the
      // rules are about which TYPES the page carries, not how they were
      // packaged into script tags.
      for (const node of Array.isArray(parsed) ? parsed : [parsed]) {
        if (node && typeof node === 'object') blocks.push({ ok: true, node: node as Record<string, unknown> })
      }
    } catch {
      blocks.push({ ok: false, raw })
    }
  }

  return blocks
}

async function checkOne(url: string): Promise<PageCheck> {
  const kind = pageKind(new URL(url).pathname)

  try {
    // `no-store`, because a cached copy would let this report a page as intact
    // using HTML from before the deploy that broke it.
    const response = await fetch(url, { cache: 'no-store', redirect: 'follow' })
    if (!response.ok) {
      return {
        url,
        kind,
        status: response.status,
        findings: [],
        fetchProblem: `The page answered HTTP ${response.status}.`,
      }
    }

    const html = await response.text()
    return { url, kind, status: response.status, findings: checkStructuredData(url, kind, extractJsonLd(html)), fetchProblem: null }
  } catch (error) {
    return {
      url,
      kind,
      status: null,
      findings: [],
      fetchProblem: `Could not fetch the page: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

export type MonitorRun = Awaited<ReturnType<typeof runStructuredDataMonitor>>

/// Checks the pages the sitemap advertises that have a markup contract.
///
/// The URL list is `sitemap()` for the same reason the indexation report uses
/// it: these are the pages we have told crawlers to look at, and monitoring a
/// different set would answer a question nobody asked. `static` pages are
/// dropped because they have no asserted contract — see `pageKind`.
export async function runStructuredDataMonitor() {
  const entries = await sitemap()
  const urls = entries
    .map((entry) => entry.url)
    .filter((url) => pageKind(new URL(url).pathname) !== 'static')

  const wanted = urls.slice(0, CHECK_LIMIT)
  const checks: PageCheck[] = []
  // Sequential. These are our own pages and a burst of sixty concurrent
  // requests against our own serverless functions during a nightly job is a
  // self-inflicted load spike, not a speed-up.
  for (const url of wanted) checks.push(await checkOne(url))

  return {
    ...summariseChecks(checks),
    origin: siteOrigin(),
    truncated: Math.max(0, urls.length - wanted.length),
  }
}
