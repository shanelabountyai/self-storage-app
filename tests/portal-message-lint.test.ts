import { fileURLToPath } from 'node:url'
import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'

// B-310. `success(...)` and `fieldError(...)` are the sentence a tenant reads
// at the moment their press succeeded or failed — the highest-stakes moment
// on a portal screen — so a string literal there is untranslatable by
// construction. The rule lives in `apps/web/eslint.config.mjs`; this pins
// that it refuses a literal or template-literal first argument to either
// call on a portal action, and does not reach checkout or the admin screens
// D-122 keeps English.

const WEB = fileURLToPath(new URL('../apps/web/', import.meta.url))
const eslint = new ESLint({ cwd: WEB })

async function refusals(code: string, file: string): Promise<number> {
  const [result] = await eslint.lintText(code, { filePath: `${WEB}${file}` })
  return result.messages.filter((message) => message.ruleId === 'no-restricted-syntax').length
}

const LITERAL_SUCCESS = `import { success } from '@/lib/admin/form-state'
export async function x() {
  return success('Saved.')
}
`

const TEMPLATE_SUCCESS = "import { success } from '@/lib/admin/form-state'\n" +
  'export async function x(name: string) {\n' +
  '  return success(`Hello ${name}`)\n' +
  '}\n'

const KEYED_SUCCESS = `import { success } from '@/lib/admin/form-state'
import { messages } from '@/lib/i18n/server'
export async function x() {
  const { t } = await messages()
  return success(t('acc.added'))
}
`

// `fieldError` always takes an OBJECT, never a bare string, so this exercises
// the rule against a call that would be a type error too — the same reason
// `PROBLEM_COPY`-style literals nested inside the object are a manual review
// concern rather than a lint one (see the eslint.config.mjs comment).
const LITERAL_FIELD_ERROR = `import { fieldError } from '@/lib/admin/form-state'
export async function x() {
  // @ts-expect-error exercising the AST rule, not the type
  return fieldError('Choose a card first.')
}
`

describe('literal success()/fieldError() on a portal action (B-310)', () => {
  it('refuses a literal or template-literal success() message', async () => {
    expect(await refusals(LITERAL_SUCCESS, 'app/portal/guard/actions.ts')).toBe(1)
    expect(await refusals(TEMPLATE_SUCCESS, 'app/portal/guard/actions.ts')).toBe(1)
  }, 30_000)

  it('leaves a message resolved through messages() alone', async () => {
    expect(await refusals(KEYED_SUCCESS, 'app/portal/guard/actions.ts')).toBe(0)
  }, 30_000)

  it('refuses a literal fieldError() call', async () => {
    expect(await refusals(LITERAL_FIELD_ERROR, 'app/portal/guard/actions.ts')).toBe(1)
  }, 30_000)

  it.each(['components/admin/guard.tsx', 'app/(public)/checkout/guard.tsx', 'app/admin/guard.tsx'])(
    'does not reach %s',
    async (file) => {
      expect(await refusals(LITERAL_SUCCESS, file)).toBe(0)
    },
    30_000,
  )
})
