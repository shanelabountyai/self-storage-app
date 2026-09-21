import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { NO_EMAIL_ON_FILE } from '@storage/core/tasks'
import { taskDetailSegments } from '../apps/web/lib/admin/tasks'
import { MessageSegments } from '../apps/web/components/message-segments'

// B-341 / SC 3.1.2. B-323's task detail quotes a Spanish tenant's subject in an
// English sentence; the quote carries its own `lang`, and nothing else does.

const detail = (subject: string) =>
  `${NO_EMAIL_ON_FILE} — '${subject}' could not be sent. Its text is in the message log on their profile, to print and mail.`

const render = (text: string, lang: 'en' | 'es' | null) =>
  renderToStaticMarkup(createElement('p', null, createElement(MessageSegments, { segments: taskDetailSegments(text, lang) })))

describe('taskDetailSegments', () => {
  it('wraps a Spanish subject in lang="es", apostrophes and all', () => {
    expect(render(detail("Recibo de su pago 'mensual'"), 'es')).toBe(
      `<p>${NO_EMAIL_ON_FILE} — &#x27;<span lang="es">Recibo de su pago &#x27;mensual&#x27;</span>&#x27; could not be sent. Its text is in the message log on their profile, to print and mail.</p>`,
    )
  })

  it('leaves an English tenant, or no known tenant, as plain text', () => {
    expect(render(detail('Your receipt'), 'en')).not.toContain('<span')
    expect(render(detail('Your receipt'), null)).not.toContain('<span')
  })

  it('leaves a detail it did not write alone', () => {
    expect(taskDetailSegments(`${NO_EMAIL_ON_FILE} — a message could not be sent.`, 'es')).toEqual([
      { text: `${NO_EMAIL_ON_FILE} — a message could not be sent.` },
    ])
  })
})
