import { fileURLToPath } from 'node:url'
import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'

// B-295. The guard, not the fix: seven paragraphs on the portal wore
// `role="alert"` on content that is true when the page is drawn (B-245's
// ruling), and nothing notices a reintroduced one. The rule lives in
// `apps/web/eslint.config.mjs`; this pins that it refuses the attribute on a
// portal page, leaves the components that hold the REAL status messages alone
// (`AdminForm`'s refusal box, the Stripe decline mirror — each reports a press
// and takes focus, which is B-285's exception), and does not reach the public
// or staff screens this row did not audit.
//
// B-314 extends the same rule to `app/pay/**`, which carried the identical
// pattern and sat outside every lint block until this row.

const WEB = fileURLToPath(new URL('../apps/web/', import.meta.url))
const eslint = new ESLint({ cwd: WEB })

async function refusals(code: string, file: string): Promise<number> {
  const [result] = await eslint.lintText(code, { filePath: `${WEB}${file}` })
  return result.messages.filter((message) => message.ruleId === 'no-restricted-syntax').length
}

const ALERT = `export function Refusal() {
  return <p role="alert" className="text-sm">We could not do that.</p>
}
`

const NOT_AN_ALERT = `export function Refusal() {
  return <p role="status" className="text-sm">We could not do that.</p>
}
`

describe('role="alert" on a portal page (B-295)', () => {
  it.each(['app/portal/guard.tsx', 'app/pay/guard.tsx'])(
    'refuses it on %s, and leaves role="status" alone',
    async (file) => {
      expect(await refusals(ALERT, file)).toBe(1)
      expect(await refusals(NOT_AN_ALERT, file)).toBe(0)
    },
    30_000,
  )

  it.each([
    'components/admin/guard.tsx',
    'app/(public)/checkout/guard.tsx',
    'app/admin/guard.tsx',
  ])('does not reach %s', async (file) => {
    expect(await refusals(ALERT, file)).toBe(0)
  }, 30_000)
})
