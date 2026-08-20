import { describe, expect, it } from 'vitest'
import {
  checkStructuredData,
  pageKind,
  selfStorageJsonLd,
  summariseChecks,
  type LdBlock,
  type PageCheck,
} from '../packages/core/marketing'
import { DAYS_OF_WEEK, type WeeklySchedule } from '../packages/core/facility-settings/weekly-schedule'
import { extractJsonLd } from '../apps/web/lib/marketing/structured-data-monitor'
import { indexNowConfig, indexNowKeyPath, SUBMIT_LIMIT } from '../apps/web/lib/marketing/indexnow'

// PRD 04 §7 Phase 3 (B-087 part 1). The two halves that can be checked without
// a network: which pages carry a markup contract, and whether a served page
// still honours it.

const URL = 'https://example.com/storage/tx/austin/demo-austin-south'

function ok(node: Record<string, unknown>): LdBlock {
  return { ok: true, node }
}

const OPEN_ALL_WEEK: WeeklySchedule = Object.fromEntries(
  DAYS_OF_WEEK.map((day) => [day, { closed: false, open: '09:00', close: '18:00' }]),
) as WeeklySchedule

/// A facility node built by the real builder, so the monitor's expectations
/// cannot drift away from what the page actually emits. A hand-written fixture
/// here would keep passing after somebody changed `selfStorageJsonLd`.
function facilityNode(overrides: { officeHours?: WeeklySchedule | null } = {}) {
  return selfStorageJsonLd({
    url: URL,
    images: [],
    unitTypes: [
      { name: '10x10', sqFt: 100, description: null, webRateCents: 12900, availableCount: 3 },
    ],
    facility: {
      slug: 'demo-austin-south',
      name: 'Demo Austin South',
      phone: '512-555-0100',
      addressLine1: '100 Test Row',
      addressLine2: null,
      city: 'Austin',
      state: 'TX',
      postalCode: '78704',
      latitude: 30.2,
      longitude: -97.7,
      amenities: ['Climate controlled'],
      officeHours: overrides.officeHours === undefined ? OPEN_ALL_WEEK : overrides.officeHours,
      gateHours: OPEN_ALL_WEEK,
    },
  })
}

const breadcrumb = ok({
  '@type': 'BreadcrumbList',
  itemListElement: [{ '@type': 'ListItem', position: 1, name: 'Texas' }],
})

describe('which pages carry a markup contract', () => {
  it('classifies the generated page kinds from the path alone', () => {
    expect(pageKind('/storage/tx/austin/demo-austin-south')).toBe('facility')
    expect(pageKind('/storage/tx/austin')).toBe('city')
    expect(pageKind('/guides/how-to-pack-a-storage-unit')).toBe('guide')
  })

  it('does not mistake /storage/search for a city page', () => {
    // One segment shorter than a city page, so it falls through. Getting the
    // segment counts wrong here — and the first draft did — reports the search
    // page as a city page missing its ItemList, every night, forever.
    expect(pageKind('/storage/search')).toBe('static')
    expect(pageKind('/storage/size-guide')).toBe('static')
  })

  it('treats the guides hub and anything unrecognised as static', () => {
    expect(pageKind('/guides')).toBe('static')
    expect(pageKind('/')).toBe('static')
    expect(pageKind('/faq')).toBe('static')
    // A route added later is un-monitored rather than falsely reported broken.
    expect(pageKind('/something/new/here/entirely')).toBe('static')
  })
})

describe('checking a served page', () => {
  it('passes a facility page built by the real builder', () => {
    expect(checkStructuredData(URL, 'facility', [ok(facilityNode()), breadcrumb])).toEqual([])
  })

  it('reports a node the page has stopped emitting', () => {
    const findings = checkStructuredData(URL, 'facility', [breadcrumb])
    expect(findings).toHaveLength(1)
    expect(findings[0]!.type).toBe('SelfStorage')
    expect(findings[0]!.problem).toContain('no longer emits')
  })

  it('catches an address that prune emptied field by field', () => {
    // The realistic failure: the node is present and looks fine, but a facility
    // whose postal code was cleared emits an address object that `prune` left
    // present and useless. "Has an address" would pass this.
    const node = facilityNode()
    delete (node.address as Record<string, unknown>).postalCode
    const findings = checkStructuredData(URL, 'facility', [ok(node), breadcrumb])
    expect(findings.map((f) => f.problem)).toEqual([
      expect.stringContaining('address.postalCode'),
    ])
  })

  it('does not fire when a facility is simply full', () => {
    // `makesOffer` is absent when nothing is available, which is legitimate.
    // A monitor that alarms every time a site fills up gets muted in its first
    // busy month.
    const node = facilityNode()
    delete node.makesOffer
    expect(checkStructuredData(URL, 'facility', [ok(node), breadcrumb])).toEqual([])
  })

  it('reports an unparseable block as its own finding, not as a missing node', () => {
    const findings = checkStructuredData(URL, 'facility', [
      { ok: false, raw: '{"@type": "SelfStorage", "name": "broken' },
      breadcrumb,
    ])
    // Two: the block that does not parse, AND the SelfStorage that is
    // therefore absent. Reporting only the second would send somebody looking
    // for a missing script that is right there.
    expect(findings).toHaveLength(2)
    expect(findings[0]!.problem).toContain('does not parse')
  })

  it('reports an empty city list, which renders as a normal-looking page', () => {
    const findings = checkStructuredData(URL, 'city', [
      ok({ '@type': 'ItemList', itemListElement: [] }),
      breadcrumb,
    ])
    expect(findings.map((f) => f.problem)).toEqual([expect.stringContaining('itemListElement')])
  })

  it('asserts nothing about a static page', () => {
    expect(checkStructuredData('https://example.com/faq', 'static', [])).toEqual([])
  })
})

describe('extracting blocks from served HTML', () => {
  it('reads a pretty-printed block across lines', () => {
    const html = `<html><head><script type="application/ld+json">\n{\n  "@type": "Article"\n}\n</script></head></html>`
    expect(extractJsonLd(html)).toEqual([{ ok: true, node: { '@type': 'Article' } }])
  })

  it('flattens an array of nodes served in one script', () => {
    const html = `<script type="application/ld+json">[{"@type":"Article"},{"@type":"BreadcrumbList"}]</script>`
    expect(extractJsonLd(html).map((b) => (b.ok ? b.node['@type'] : null))).toEqual([
      'Article',
      'BreadcrumbList',
    ])
  })

  it('keeps a malformed block instead of dropping it', () => {
    const html = `<script type="application/ld+json">{"@type": "Article",}</script>`
    expect(extractJsonLd(html)).toEqual([{ ok: false, raw: '{"@type": "Article",}' }])
  })

  it('ignores scripts that are not JSON-LD', () => {
    const html = `<script>window.x = 1</script><script type="application/json">{"a":1}</script>`
    expect(extractJsonLd(html)).toEqual([])
  })
})

describe('the summary an operator reads', () => {
  const check = (url: string, findings: number, fetchProblem: string | null = null): PageCheck => ({
    url,
    kind: 'facility',
    status: fetchProblem ? null : 200,
    fetchProblem,
    findings: Array.from({ length: findings }, (_, index) => ({
      url,
      type: 'SelfStorage',
      problem: `problem ${index}`,
    })),
  })

  it('separates unreachable from broken, and counts the rest intact', () => {
    const summary = summariseChecks([
      check('https://example.com/a', 0),
      check('https://example.com/b', 2),
      check('https://example.com/c', 0, 'HTTP 500'),
    ])
    expect(summary).toMatchObject({ checked: 3, intact: 1, findingCount: 2 })
    expect(summary.broken.map((c) => c.url)).toEqual(['https://example.com/b'])
    expect(summary.unreachable.map((c) => c.url)).toEqual(['https://example.com/c'])
  })

  it('puts the worst page first', () => {
    const summary = summariseChecks([check('https://example.com/a', 1), check('https://example.com/b', 3)])
    expect(summary.broken.map((c) => c.url)).toEqual(['https://example.com/b', 'https://example.com/a'])
  })
})

describe('the IndexNow key', () => {
  const withKey = async <T,>(value: string | undefined, run: () => T): Promise<T> => {
    const previous = process.env.INDEXNOW_KEY
    if (value === undefined) delete process.env.INDEXNOW_KEY
    else process.env.INDEXNOW_KEY = value
    try {
      return run()
    } finally {
      if (previous === undefined) delete process.env.INDEXNOW_KEY
      else process.env.INDEXNOW_KEY = previous
    }
  }

  it('is unconfigured by default, and names the variable', async () => {
    expect(await withKey(undefined, indexNowConfig)).toEqual({
      configured: false,
      missing: ['INDEXNOW_KEY'],
    })
  })

  it('refuses a key the protocol would reject, rather than discovering it as a 422', async () => {
    // Seven characters: one below the protocol's floor of eight.
    const result = await withKey('abc1234', indexNowConfig)
    expect(result.configured).toBe(false)
    const shape = await withKey('has spaces and punctuation!', indexNowConfig)
    expect(shape.configured).toBe(false)
  })

  it('accepts a UUID with its hyphens, which is what the docs suggest', async () => {
    const key = 'f1e2d3c4-b5a6-4789-9abc-def012345678'
    expect(await withKey(key, indexNowConfig)).toEqual({ configured: true, config: { key } })
  })

  it('serves the key file under a fixed segment, not at the host root', () => {
    // The protocol's default is `/{key}.txt`, which would need a catch-all
    // route directly under `/` shadowing every future top-level path.
    // `keyLocation` in the payload exists to allow exactly this.
    expect(indexNowKeyPath('abcd1234')).toBe('/indexnow/abcd1234.txt')
  })

  it('caps a submission well below the protocol limit', () => {
    expect(SUBMIT_LIMIT).toBeLessThan(10_000)
  })
})
