import { describe, expect, it } from 'vitest'
import {
  escapeHtml,
  periodFor,
  renderReportEmail,
  sendIdempotencyKey,
  sendsOn,
  type EmailDocument,
} from '../packages/core/comms'

// PRD 05 FR-9a (B-084 part 3). The accessibility criteria for generated email,
// asserted rather than reviewed.
//
// FR-9a was written into PRD 05 before any such email existed, on the grounds
// that it is "cheap to state now and expensive once templates exist, are
// versioned, and have rendered snapshots stored against thousands of message
// rows". This file is where that bet pays off: each clause is a test.

const DOC: EmailDocument = {
  title: 'Revenue — Austin South, July 2026',
  intro: 'Billed against collected. July 2026 is closed, so these figures are filed.',
  sections: [
    {
      heading: 'Revenue',
      paragraphs: ['Refunded in the period: $0.00. This is already deducted from collected.'],
      table: {
        caption: 'Billed and collected in July 2026',
        columns: ['Measure', 'Amount'],
        rows: [
          ['Billed', '$1,000.00'],
          ['Collected', '$900.00'],
        ],
      },
    },
  ],
  links: [{ label: 'Open the revenue report', url: 'https://example.com/admin/reports/revenue' }],
  footer: 'You are getting this because Austin South has a scheduled weekly revenue report.',
}

describe('FR-9a: the HTML part', () => {
  const { html } = renderReportEmail(DOC)

  it('declares its language', () => {
    // Without it a screen reader pronounces the content in whatever language it
    // was last set to.
    expect(html).toContain('<html lang="en">')
  })

  it('uses real heading elements, in order, with nothing skipped', () => {
    // "Actual headings in order rather than styled divs" — the clause's own
    // words. A styled div is invisible to the heading list a screen-reader user
    // navigates by.
    const headings = [...html.matchAll(/<h([1-6])>/g)].map((match) => Number(match[1]))
    expect(headings[0]).toBe(1)
    expect(headings.filter((level) => level === 1)).toHaveLength(1)
    for (let index = 1; index < headings.length; index += 1) {
      expect(headings[index] - headings[index - 1]).toBeLessThanOrEqual(1)
    }
  })

  it('puts a scope on every table header, columns AND rows', () => {
    // A row header is the half people forget. Without it a screen reader reads
    // "$900.00" with nothing saying which measure it belongs to.
    expect(html).toContain('<th scope="col"')
    expect(html).toContain('<th scope="row"')
    // `<th(?=[\s>])` so the check does not also match `<thead`, which has no
    // scope and correctly should not.
    expect(html).not.toMatch(/<th(?=[\s>])(?![^>]*scope=)/)
  })

  it('captions every table', () => {
    expect(html).toContain('<caption')
    expect(html).toContain('Billed and collected in July 2026')
  })

  it('contains no images at all, so nothing carries text as a picture', () => {
    // The simplest way to satisfy "no text rendered as an image" and the alt
    // rules together: a report needs no pictures.
    expect(html).not.toContain('<img')
  })

  it('gives every link text that names its destination', () => {
    const linkTexts = [...html.matchAll(/<a [^>]*>([^<]*)<\/a>/g)].map((match) => match[1])
    expect(linkTexts.length).toBeGreaterThan(0)
    for (const text of linkTexts) {
      expect(text.toLowerCase()).not.toContain('click here')
      expect(text.toLowerCase()).not.toBe('here')
      expect(text.length).toBeGreaterThan(8)
    }
  })

  it('escapes anything a facility name could contain', () => {
    // A facility called "Bob & Sons <Storage>" must not close a tag.
    const rendered = renderReportEmail({
      ...DOC,
      title: 'Revenue — Bob & Sons <Storage>',
    })
    expect(rendered.html).toContain('Bob &amp; Sons &lt;Storage&gt;')
    expect(rendered.html).not.toContain('<Storage>')
  })

  it('escapes a URL as well as the label', () => {
    const rendered = renderReportEmail({
      ...DOC,
      links: [{ label: 'Open the revenue report', url: 'https://example.com/a?b=1&c=2' }],
    })
    expect(rendered.html).toContain('b=1&amp;c=2')
  })
})

describe('FR-9a: the text part is a real equivalent', () => {
  const { text, html } = renderReportEmail(DOC)

  it('is built from the document, not by stripping tags', () => {
    // The clause asks for "a real text alternative part rather than a stripped
    // tag soup". The tell is that it contains no markup at all and still says
    // everything the HTML says.
    expect(text).not.toMatch(/<[a-z/]/i)
    expect(html).toContain('<table')
  })

  it('keeps the headings, the caption and every figure', () => {
    expect(text).toContain('Revenue — Austin South, July 2026')
    expect(text).toContain('Billed and collected in July 2026')
    expect(text).toContain('$1,000.00')
    expect(text).toContain('$900.00')
  })

  it('keeps the table readable rather than running the cells together', () => {
    // Anchored to a whole line: the intro sentence also begins with "Billed",
    // and matching it would have passed for the wrong reason.
    // Two columns, still separated — a screen reader reading the plain part is
    // reading a table, not a sentence of numbers.
    expect(text).toMatch(/^Billed\s{2,}\$1,000\.00$/m)
  })

  it('names the destination of every link, with its address', () => {
    expect(text).toContain('Open the revenue report: https://example.com/admin/reports/revenue')
  })

  it('carries the footer that says why it arrived', () => {
    expect(text).toContain('scheduled weekly revenue report')
  })
})

describe('nothing is carried by colour alone', () => {
  it('has no colour styling to carry meaning in the first place', () => {
    const { html } = renderReportEmail(DOC)
    expect(html).not.toMatch(/color\s*:/i)
    expect(html).not.toMatch(/bgcolor=/i)
  })
})

describe('escapeHtml', () => {
  it('handles every character that could break out of an attribute or a tag', () => {
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;')
  })
})

describe('when a report goes out', () => {
  it('sends a daily every day', () => {
    expect(sendsOn('daily', { year: 2026, month: 8, day: 13 })).toBe(true)
    expect(sendsOn('daily', { year: 2026, month: 8, day: 1 })).toBe(true)
  })

  it('sends a weekly on Monday and no other day', () => {
    // 2026-08-17 is a Monday.
    expect(sendsOn('weekly', { year: 2026, month: 8, day: 17 })).toBe(true)
    for (const day of [15, 16, 18, 19, 20, 21, 22]) {
      expect(sendsOn('weekly', { year: 2026, month: 8, day })).toBe(false)
    }
  })

  it('sends a monthly on the 1st and no other day', () => {
    expect(sendsOn('monthly', { year: 2026, month: 8, day: 1 })).toBe(true)
    expect(sendsOn('monthly', { year: 2026, month: 8, day: 2 })).toBe(false)
    expect(sendsOn('monthly', { year: 2026, month: 8, day: 31 })).toBe(false)
  })
})

describe('what period a send covers', () => {
  const TZ = 'America/Chicago'

  it('reports on the day that just ended, not the one in progress', () => {
    const period = periodFor('daily', { year: 2026, month: 8, day: 18 }, TZ)
    // Local midnight, not UTC midnight — a payment taken at 8pm on the 17th
    // belongs to the 17th.
    expect(period.start.toISOString()).toBe('2026-08-17T05:00:00.000Z')
    expect(period.end.toISOString()).toBe('2026-08-18T05:00:00.000Z')
  })

  it('reports on the seven days before a Monday', () => {
    const period = periodFor('weekly', { year: 2026, month: 8, day: 17 }, TZ)
    expect(period.start.toISOString()).toBe('2026-08-10T05:00:00.000Z')
    expect(period.end.toISOString()).toBe('2026-08-17T05:00:00.000Z')
  })

  it('reports on the month before, and rolls the year back in January', () => {
    const july = periodFor('monthly', { year: 2026, month: 8, day: 1 }, TZ)
    expect(july.key).toBe('2026-07')
    expect(july.label).toBe('July 2026')

    const december = periodFor('monthly', { year: 2026, month: 1, day: 1 }, TZ)
    expect(december.key).toBe('2025-12')
    expect(december.label).toBe('December 2025')
  })

  it('counts a week in whole local days across a DST change', () => {
    // The week containing the US spring-forward is 167 hours, not 168. A
    // fixed-millisecond window would drop an hour of payments at one end.
    const period = periodFor('weekly', { year: 2026, month: 3, day: 9 }, TZ)
    const hours = (period.end.getTime() - period.start.getTime()) / 3_600_000
    expect(hours).toBe(167)
  })
})

describe('the idempotency key', () => {
  it('is stable for a period, so a re-run cannot send twice', () => {
    const period = periodFor('monthly', { year: 2026, month: 8, day: 1 }, 'America/Chicago')
    expect(sendIdempotencyKey('sub_1', period)).toBe('report:sub_1:2026-07')
    expect(sendIdempotencyKey('sub_1', period)).toBe(sendIdempotencyKey('sub_1', period))
  })

  it('differs between two subscriptions on the same period', () => {
    const period = periodFor('daily', { year: 2026, month: 8, day: 18 }, 'America/Chicago')
    expect(sendIdempotencyKey('sub_1', period)).not.toBe(sendIdempotencyKey('sub_2', period))
  })
})
