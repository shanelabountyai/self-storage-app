import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { RouteLoading } from '../apps/web/components/ui/loading'

// B-389. A loading route must tell a screen reader something is happening.
describe('RouteLoading', () => {
  it('carries sr-only "Loading" text, hidden skeletons and no live region', () => {
    const html = renderToStaticMarkup(<RouteLoading />)
    expect(html).not.toContain('role="status"')
    expect(html).toContain('<span class="sr-only">Loading</span>')
    expect(html).toContain('aria-hidden="true"')
  })
})

void React // classic JSX runtime under vitest needs React in scope
