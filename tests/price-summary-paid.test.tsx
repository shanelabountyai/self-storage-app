import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { PriceSummary } from '../apps/web/components/checkout/price-summary'
import { dictionaryFor } from '../apps/web/lib/i18n'

// B-425. On the confirmation the summary says the money was paid, not due.

const units = [{ id: 'u1', name: 'Unit 12', label: '10x10', rateCents: 12900, streetRateCents: 12900 }]
const html = (paid: boolean, locale: 'en' | 'es' = 'en') =>
  renderToStaticMarkup(
    createElement(PriceSummary, {
      units,
      facilityName: 'Demo',
      paid,
      dict: dictionaryFor(locale),
    }),
  )

describe('PriceSummary paid', () => {
  it('reads "Paid today" once provisioned, never "Due today"', () => {
    const out = html(true)
    expect(out).toContain('Paid today')
    expect(out).toContain('Total paid today')
    expect(out).not.toMatch(/due today/i)
  })
  it('keeps "Due today" before payment', () => {
    expect(html(false)).toContain('Due today')
  })
  it('is translated', () => {
    expect(html(true, 'es')).toContain('Pagado hoy')
  })
})
