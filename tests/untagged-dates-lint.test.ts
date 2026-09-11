import { fileURLToPath } from 'node:url'
import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'

// B-284. The guard, not the fix: ten dates on the portal and the checkout were
// written in English under a Spanish page because `formatCalendarDate` and
// `formatDay` default to en-US, and nothing notices a missing argument. The
// rule lives in `apps/web/eslint.config.mjs`; this pins that it refuses each
// shape, accepts the tagged one, and stays out of the staff screens (D-122).

const WEB = fileURLToPath(new URL('../apps/web/', import.meta.url))
const eslint = new ESLint({ cwd: WEB })

async function refusals(code: string, file: string): Promise<number> {
  const [result] = await eslint.lintText(code, { filePath: `${WEB}${file}` })
  return result.messages.filter((message) => message.ruleId === 'no-restricted-syntax').length
}

const UNTAGGED = `import { formatCalendarDate, formatDay } from '@/lib/format'
export const a = formatCalendarDate(new Date(), { month: 'long' })
export const b = formatDay('2026-09-11')
export const c = new Intl.DateTimeFormat('en-US', { month: 'long' }).format(new Date())
`

const TAGGED = `import { formatCalendarDate, formatDay } from '@/lib/format'
import { LOCALE_TAG } from '@/lib/i18n'
export const a = formatCalendarDate(new Date(), { month: 'long' }, LOCALE_TAG.es)
export const b = formatDay('2026-09-11', LOCALE_TAG.es)
export const c = new Intl.DateTimeFormat(LOCALE_TAG.es, { month: 'long' }).format(new Date())
`

describe('untagged dates on customer screens (B-284)', () => {
  it.each(['app/portal/guard.tsx', 'app/(public)/checkout/guard.tsx'])(
    'refuses each untagged shape and accepts the tagged ones in %s',
    async (file) => {
      expect(await refusals(UNTAGGED, file)).toBe(3)
      expect(await refusals(TAGGED, file)).toBe(0)
    },
    30_000,
  )

  it('leaves the staff screens in English', async () => {
    expect(await refusals(UNTAGGED, 'app/admin/guard.tsx')).toBe(0)
  }, 30_000)
})
