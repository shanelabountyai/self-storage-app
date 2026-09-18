import { describe, expect, it } from 'vitest'
import { proseFor } from '../apps/web/lib/comms/prose'

// B-325. An auth email is read by somebody who may not know the product, so
// no sentence may stack conditionals ("if ...; if ..."). A semicolon does not
// end a sentence here — that is exactly how the old copy hid its second "if".
const CONDITIONAL = /\b(if|unless|si|a menos que)\b/gi

describe('auth email sentences', () => {
  for (const locale of ['en', 'es'] as const) {
    const say = proseFor(locale).direct
    const texts = [say.authAccountAccess('Vance Roofing', 'Site'), say.authExpiry(30), say.authIgnore]

    it(`carry at most one conditional each (${locale})`, () => {
      for (const sentence of texts.join(' ').split(/(?<=[.!?:])\s+/)) {
        expect(sentence.match(CONDITIONAL)?.length ?? 0, sentence).toBeLessThanOrEqual(1)
      }
    })
  }
})
