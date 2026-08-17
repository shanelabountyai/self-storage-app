import { describe, expect, it } from 'vitest'
import {
  INDEX_STATE_LABELS,
  readInspection,
  summarise,
  type UrlIndexation,
} from '../packages/core/marketing'
import { INSPECT_LIMIT, searchConsoleConfig } from '../apps/web/lib/marketing/search-console'

// PRD 04 §7 Phase 2 (B-082 part 5). Google's answers, translated.

const URL = 'https://example.com/storage/tx/austin/demo-austin-south'

function payload(indexStatusResult: Record<string, string>) {
  return { inspectionResult: { indexStatusResult } }
}

describe('reading an inspection', () => {
  it('treats PASS, and only PASS, as indexed', () => {
    expect(readInspection(URL, payload({ verdict: 'PASS' })).state).toBe('indexed')
    // NEUTRAL and PARTIAL both mean "an opinion short of yes", and both need
    // the same action — five shades of "not really" is a report nobody reads
    // to the end.
    expect(readInspection(URL, payload({ verdict: 'NEUTRAL' })).state).toBe('not_indexed')
    expect(readInspection(URL, payload({ verdict: 'PARTIAL' })).state).toBe('not_indexed')
    expect(readInspection(URL, payload({ verdict: 'FAIL' })).state).toBe('not_indexed')
  })

  it('decides from the verdict enum, never from the English sentence', () => {
    // `coverageState` is free text Google rewords without warning. Switching on
    // it would break this report silently the next time somebody at Google
    // edits a string.
    const row = readInspection(
      URL,
      payload({ verdict: 'PASS', coverageState: 'Submitted and indexed' }),
    )
    expect(row.state).toBe('indexed')
    // Kept verbatim for display, so an operator can search Google's own docs
    // for the exact phrase.
    expect(row.coverageState).toBe('Submitted and indexed')
  })

  it('separates a page Google could not fetch from one it chose not to index', () => {
    // Completely different next actions: one is ours to repair, the other is a
    // content or linking problem.
    const row = readInspection(
      URL,
      payload({ verdict: 'PASS', pageFetchState: 'SOFT_404' }),
    )
    expect(row.state).toBe('error')
    expect(row.problem).toContain('SOFT_404')
  })

  it('accepts an unspecified fetch state as fine', () => {
    expect(
      readInspection(URL, payload({ verdict: 'PASS', pageFetchState: 'SUCCESSFUL' })).state,
    ).toBe('indexed')
    expect(
      readInspection(URL, payload({ verdict: 'PASS', pageFetchState: 'PAGE_FETCH_STATE_UNSPECIFIED' }))
        .state,
    ).toBe('indexed')
  })

  it('survives a response missing the fields it wants', () => {
    // A third-party payload. Treating any part as guaranteed is how a report
    // 500s on the day Google omits a field for one URL.
    expect(readInspection(URL, {}).state).toBe('error')
    expect(readInspection(URL, { inspectionResult: {} }).state).toBe('error')
    expect(readInspection(URL, payload({ coverageState: 'Discovered' })).state).toBe('error')
  })

  it('carries the crawl date through untouched', () => {
    const row = readInspection(URL, payload({ verdict: 'PASS', lastCrawlTime: '2026-08-01T00:00:00Z' }))
    expect(row.lastCrawledAt).toBe('2026-08-01T00:00:00Z')
  })
})

function row(state: UrlIndexation['state'], url: string): UrlIndexation {
  return { url, state, coverageState: null, lastCrawledAt: null, problem: null }
}

describe('the summary', () => {
  it('counts every state and lists only what needs attention', () => {
    const summary = summarise([
      row('indexed', '/a'),
      row('indexed', '/b'),
      row('not_indexed', '/c'),
      row('error', '/d'),
      row('unknown', '/e'),
    ])
    expect(summary.total).toBe(5)
    expect(summary.indexed).toBe(2)
    expect(summary.notIndexed).toBe(1)
    expect(summary.errors).toBe(1)
    expect(summary.unknown).toBe(1)
    // `unknown` is not actionable — nobody asked about it yet — so it stays out
    // of the list an operator works through.
    expect(summary.needsAttention.map((entry) => entry.url)).toEqual(['/d', '/c'])
  })

  it('puts errors before not-indexed', () => {
    // A page Google cannot fetch is a problem on our side and is fixable
    // today; one it chose not to index is a longer conversation.
    const summary = summarise([row('not_indexed', '/a'), row('error', '/z')])
    expect(summary.needsAttention[0].state).toBe('error')
  })

  it('is all zeroes for an empty check rather than undefined', () => {
    const summary = summarise([])
    expect(summary).toEqual({
      total: 0,
      indexed: 0,
      notIndexed: 0,
      errors: 0,
      unknown: 0,
      needsAttention: [],
    })
  })

  it('has a label for every state it can report', () => {
    // The count and the row would otherwise describe one state in two words.
    for (const state of ['indexed', 'not_indexed', 'error', 'unknown'] as const) {
      expect(INDEX_STATE_LABELS[state]).toBeTruthy()
    }
  })
})

describe('configuration', () => {
  it('names every missing variable rather than saying "not configured"', () => {
    // Somebody has to go and set these. A message that does not say which ones
    // costs them a search through the repo.
    const previous = {
      email: process.env.GOOGLE_SEARCH_CONSOLE_CLIENT_EMAIL,
      key: process.env.GOOGLE_SEARCH_CONSOLE_PRIVATE_KEY,
      site: process.env.GOOGLE_SEARCH_CONSOLE_SITE_URL,
    }
    delete process.env.GOOGLE_SEARCH_CONSOLE_CLIENT_EMAIL
    delete process.env.GOOGLE_SEARCH_CONSOLE_PRIVATE_KEY
    delete process.env.GOOGLE_SEARCH_CONSOLE_SITE_URL
    try {
      const result = searchConsoleConfig()
      expect(result.configured).toBe(false)
      if (result.configured) return
      expect(result.missing).toEqual([
        'GOOGLE_SEARCH_CONSOLE_CLIENT_EMAIL',
        'GOOGLE_SEARCH_CONSOLE_PRIVATE_KEY',
        'GOOGLE_SEARCH_CONSOLE_SITE_URL',
      ])
    } finally {
      if (previous.email) process.env.GOOGLE_SEARCH_CONSOLE_CLIENT_EMAIL = previous.email
      if (previous.key) process.env.GOOGLE_SEARCH_CONSOLE_PRIVATE_KEY = previous.key
      if (previous.site) process.env.GOOGLE_SEARCH_CONSOLE_SITE_URL = previous.site
    }
  })

  it('treats a whitespace-only value as missing', () => {
    const previous = process.env.GOOGLE_SEARCH_CONSOLE_CLIENT_EMAIL
    process.env.GOOGLE_SEARCH_CONSOLE_CLIENT_EMAIL = '   '
    try {
      const result = searchConsoleConfig()
      expect(result.configured).toBe(false)
      if (!result.configured) {
        expect(result.missing).toContain('GOOGLE_SEARCH_CONSOLE_CLIENT_EMAIL')
      }
    } finally {
      if (previous === undefined) delete process.env.GOOGLE_SEARCH_CONSOLE_CLIENT_EMAIL
      else process.env.GOOGLE_SEARCH_CONSOLE_CLIENT_EMAIL = previous
    }
  })

  it('un-escapes a PEM stored on one line', () => {
    // Vercel and most dashboards store it that way. Without this the signature
    // fails with an error naming neither the cause nor the variable.
    const previous = {
      email: process.env.GOOGLE_SEARCH_CONSOLE_CLIENT_EMAIL,
      key: process.env.GOOGLE_SEARCH_CONSOLE_PRIVATE_KEY,
      site: process.env.GOOGLE_SEARCH_CONSOLE_SITE_URL,
    }
    process.env.GOOGLE_SEARCH_CONSOLE_CLIENT_EMAIL = 'a@b.iam.gserviceaccount.com'
    process.env.GOOGLE_SEARCH_CONSOLE_PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\\nAAAA\\n-----END PRIVATE KEY-----\\n'
    process.env.GOOGLE_SEARCH_CONSOLE_SITE_URL = 'sc-domain:example.com'
    try {
      const result = searchConsoleConfig()
      expect(result.configured).toBe(true)
      if (!result.configured) return
      expect(result.config.privateKey).toContain('\n')
      expect(result.config.privateKey).not.toContain('\\n')
    } finally {
      for (const [name, value] of [
        ['GOOGLE_SEARCH_CONSOLE_CLIENT_EMAIL', previous.email],
        ['GOOGLE_SEARCH_CONSOLE_PRIVATE_KEY', previous.key],
        ['GOOGLE_SEARCH_CONSOLE_SITE_URL', previous.site],
      ] as const) {
        if (value === undefined) delete process.env[name]
        else process.env[name] = value
      }
    }
  })

  it('caps how many URLs one report checks', () => {
    // Google rate-limits per minute as well as per day, and the report says
    // out loud when it has truncated rather than reading as "everything is
    // fine" to somebody counting rows.
    expect(INSPECT_LIMIT).toBeGreaterThan(0)
    expect(INSPECT_LIMIT).toBeLessThanOrEqual(2_000)
  })
})
