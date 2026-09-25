import { describe, expect, it } from 'vitest'
import { alreadyPaidCode } from '../apps/web/lib/checkout/payment-codes'
import { en } from '../apps/web/lib/i18n/en'
import { es } from '../apps/web/lib/i18n/es'

// B-392.
describe('payment confirming copy', () => {
  it('maps payment_intent_unexpected_state to "already paid", and nothing else', () => {
    expect(alreadyPaidCode('payment_intent_unexpected_state')).toBe(true)
    expect(alreadyPaidCode('card_declined')).toBe(false)
    expect(alreadyPaidCode(undefined)).toBe(false)
  })

  it.each(['alreadyPaid', 'confirmingHeading', 'confirmingStatus', 'confirmingSlow', 'checkAgain', 'cardFormLoading'])(
    'has pay.%s in both locales',
    (key) => {
      expect((en as Record<string, string>)[`pay.${key}`]).toBeTruthy()
      expect((es as Record<string, string>)[`pay.${key}`]).toBeTruthy()
    },
  )
})
