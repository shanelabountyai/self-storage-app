import type { JsonLd } from './structured-data.ts'
import type { PageKind } from './urls.ts'

// PRD 04 §7 Phase 3 (B-087 part 1): "structured-data monitoring alerts."
//
// The failure this exists to catch is silent by construction. Structured data
// is invisible on the rendered page, so a refactor that drops a `<script>`, a
// facility whose address fields were emptied, or a `prune()` that removed a
// node because its input went undefined all look exactly like a working page
// in a browser. The first signal is a rich result disappearing from search
// weeks later, and by then nobody can say which deploy did it.
//
// **This checks OUR markup, not Google's opinion of it.** There is no public
// Rich Results Test API, so the alternative would be scraping a testing UI —
// and a verdict scraped from a page Google may change tomorrow is the same
// fabricated-claim problem B-082 part 5 refused for the index status. What is
// checked here is checkable without asking anybody: does the page still emit
// the node it is supposed to emit, does it parse, and does it still carry the
// fields that make it eligible for anything.
//
// Everything is pure — the fetching and the HTML extraction live in the app
// layer, so the rules can be tested against fixtures with no network.

/// One JSON-LD `<script>` from a page. A block that failed to parse is kept
/// rather than dropped: an unparseable block is the single worst finding here
/// (it means the whole node is invisible to every consumer), and dropping it
/// would report the page as merely "missing SelfStorage".
export type LdBlock = { ok: true; node: JsonLd } | { ok: false; raw: string }

export type SchemaFinding = {
  url: string
  /// The `@type` the finding is about, or null when it is about the page.
  type: string | null
  /// What is wrong, in words an operator can act on without knowing schema.org.
  problem: string
}

/// The nodes each page kind is expected to carry.
///
/// Deliberately short. Only types the page emits UNCONDITIONALLY belong here:
/// `FAQPage` is absent because `faqPageJsonLd` returns null below two entries
/// by design, and asserting it would fail every facility with one FAQ.
const REQUIRED_TYPES: Record<PageKind, readonly string[]> = {
  facility: ['SelfStorage', 'BreadcrumbList'],
  city: ['ItemList', 'BreadcrumbList'],
  guide: ['Article', 'BreadcrumbList'],
  static: [],
}

function typeOf(node: JsonLd): string | null {
  const value = node['@type']
  return typeof value === 'string' ? value : null
}

function isNonEmptyString(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

function isNonEmptyArray(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0
}

/// Per-type field rules, checked only when the node is present.
///
/// The fields listed are the ones whose absence removes the page's eligibility
/// for the rich result the node exists to earn — not every field schema.org
/// documents. `makesOffer` is deliberately NOT required on `SelfStorage`: a
/// fully rented facility legitimately offers nothing, and a monitor that fires
/// every time a site fills up is one that gets muted in its first busy month.
function checkNode(url: string, node: JsonLd): SchemaFinding[] {
  const type = typeOf(node)
  const findings: SchemaFinding[] = []
  const missing = (field: string, why: string) =>
    findings.push({ url, type, problem: `${type} is missing ${field} — ${why}.` })

  switch (type) {
    case 'SelfStorage': {
      if (!isNonEmptyString(node.name)) missing('name', 'the business name is what the result is titled with')
      if (!isNonEmptyString(node.url)) missing('url', 'without it the node does not identify a page')
      const address = node.address as Record<string, unknown> | undefined
      // Checked field by field rather than "has an address": `prune` drops
      // undefined values, so a facility whose postal code was cleared emits an
      // address object that is present and useless.
      for (const field of ['streetAddress', 'addressLocality', 'addressRegion', 'postalCode'] as const) {
        if (!address || !isNonEmptyString(address[field])) {
          missing(`address.${field}`, 'a local result needs a complete postal address')
        }
      }
      if (!isNonEmptyArray(node.openingHoursSpecification)) {
        missing('openingHoursSpecification', 'hours are the field this page type is shown for')
      }
      break
    }
    case 'ItemList':
      if (!isNonEmptyArray(node.itemListElement)) {
        missing('itemListElement', 'the list is empty, so the page is advertising nothing')
      }
      break
    case 'Article':
      if (!isNonEmptyString(node.headline)) missing('headline', 'it is the title the result shows')
      if (!isNonEmptyString(node.datePublished)) missing('datePublished', 'an undated article is not eligible')
      break
    case 'BreadcrumbList':
      if (!isNonEmptyArray(node.itemListElement)) {
        missing('itemListElement', 'an empty breadcrumb shows the bare URL instead of the path')
      }
      break
  }

  return findings
}

/// Every finding for one page. Empty means the markup is intact.
export function checkStructuredData(
  url: string,
  kind: PageKind,
  blocks: readonly LdBlock[],
): SchemaFinding[] {
  const findings: SchemaFinding[] = []

  for (const block of blocks) {
    if (block.ok) continue
    findings.push({
      url,
      type: null,
      // The raw text is truncated into the message rather than stored: it is
      // the only clue to WHICH script broke, and the whole block would be a
      // page of JSON in an email.
      problem: `A JSON-LD block on this page does not parse, so every consumer ignores it: ${block.raw.slice(0, 120).trim()}…`,
    })
  }

  const present = new Set(
    blocks.flatMap((block) => (block.ok ? [typeOf(block.node)] : [])).filter((type): type is string => type !== null),
  )

  for (const required of REQUIRED_TYPES[kind]) {
    if (!present.has(required)) {
      findings.push({
        url,
        type: required,
        problem: `This page no longer emits ${required} markup.`,
      })
    }
  }

  for (const block of blocks) {
    if (block.ok) findings.push(...checkNode(url, block.node))
  }

  return findings
}

export type PageCheck = {
  url: string
  kind: PageKind
  /// Null when the page could not be fetched at all — a different problem from
  /// bad markup, and one that is ours to fix first.
  status: number | null
  findings: SchemaFinding[]
  fetchProblem: string | null
}

export type MonitorSummary = {
  checked: number
  /// Pages with no findings and a successful fetch.
  intact: number
  /// Pages with at least one finding, worst first.
  broken: PageCheck[]
  unreachable: PageCheck[]
  findingCount: number
}

export function summariseChecks(checks: readonly PageCheck[]): MonitorSummary {
  const unreachable = checks.filter((check) => check.fetchProblem !== null)
  const broken = checks
    .filter((check) => check.fetchProblem === null && check.findings.length > 0)
    // Most findings first: a page that lost its whole node has more to say
    // than one missing a postal code, and both are on the same screen.
    .sort((a, b) => b.findings.length - a.findings.length || a.url.localeCompare(b.url))

  return {
    checked: checks.length,
    intact: checks.length - unreachable.length - broken.length,
    broken,
    unreachable,
    findingCount: checks.reduce((total, check) => total + check.findings.length, 0),
  }
}
