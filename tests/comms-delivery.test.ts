import { describe, expect, it } from 'vitest'
import {
  consequencesOf,
  maskAddress,
  nextDeliveryStatus,
  statusFromResendEvent,
  suppressionIsRemovable,
} from '../packages/core/comms/delivery'

// B-054 / PRD 05 FR-14, FR-15, CN-20. The pure half.

describe('nextDeliveryStatus', () => {
  it('moves forward', () => {
    expect(nextDeliveryStatus('queued', 'sent')).toBe('sent')
    expect(nextDeliveryStatus('sent', 'delivered')).toBe('delivered')
    expect(nextDeliveryStatus('sent', 'bounced')).toBe('bounced')
  })

  it('ignores a redelivery of the same event — FR-14 idempotency', () => {
    expect(nextDeliveryStatus('delivered', 'delivered')).toBeNull()
  })

  it('never walks backwards when events arrive out of order', () => {
    // The real case this exists for: providers routinely deliver `sent` after
    // `delivered`. Writing it would leave the log claiming less than we know.
    expect(nextDeliveryStatus('delivered', 'sent')).toBeNull()
    expect(nextDeliveryStatus('bounced', 'queued')).toBeNull()
  })

  it('never lets a provider overwrite a decision we made', () => {
    // We refused to send this at all. A provider callback saying otherwise is
    // either a mismatch or a forgery; neither should rewrite it.
    expect(nextDeliveryStatus('suppressed', 'delivered')).toBeNull()
    expect(nextDeliveryStatus('cancelled', 'sent')).toBeNull()
  })

  it('does not pick a winner between two terminal outcomes', () => {
    expect(nextDeliveryStatus('delivered', 'bounced')).toBeNull()
    expect(nextDeliveryStatus('bounced', 'delivered')).toBeNull()
  })
})

describe('statusFromResendEvent', () => {
  it('maps the events we act on', () => {
    expect(statusFromResendEvent('email.sent')).toBe('sent')
    expect(statusFromResendEvent('email.delivered')).toBe('delivered')
    expect(statusFromResendEvent('email.bounced')).toBe('bounced')
  })

  it('records a complaint as delivered, because it was', () => {
    expect(statusFromResendEvent('email.complained')).toBe('delivered')
  })

  it('ignores a delay rather than calling it a failure', () => {
    expect(statusFromResendEvent('email.delivery_delayed')).toBeNull()
    expect(statusFromResendEvent('email.opened')).toBeNull()
  })
})

describe('consequencesOf', () => {
  it('suppresses, flags and raises a task on a hard bounce — FR-15', () => {
    expect(consequencesOf('email.bounced')).toEqual({
      suppress: 'hard_bounce',
      flagTenant: true,
      raiseTask: true,
    })
  })

  it('suppresses a complaint without asking anyone to chase them', () => {
    expect(consequencesOf('email.complained')).toEqual({
      suppress: 'complaint',
      flagTenant: true,
      raiseTask: false,
    })
  })

  it('does nothing on a delay — a full mailbox is not a dead address', () => {
    expect(consequencesOf('email.delivery_delayed')).toEqual({
      suppress: null,
      flagTenant: false,
      raiseTask: false,
    })
  })
})

describe('suppressionIsRemovable — CN-20', () => {
  it('allows staff entries and bounces', () => {
    expect(suppressionIsRemovable('manual')).toBe(true)
    expect(suppressionIsRemovable('hard_bounce')).toBe(true)
  })

  it('refuses STOP and complaints', () => {
    expect(suppressionIsRemovable('stop')).toBe(false)
    expect(suppressionIsRemovable('complaint')).toBe(false)
  })

  it('refuses anything it does not recognise', () => {
    // Fail closed: a reason added later is not liftable until somebody decides
    // it should be.
    expect(suppressionIsRemovable('unsubscribe')).toBe(false)
    expect(suppressionIsRemovable('kill_switch')).toBe(false)
    expect(suppressionIsRemovable('whatever')).toBe(false)
  })
})

describe('maskAddress — CN-18', () => {
  it('keeps enough to recognise the address', () => {
    expect(maskAddress('ada@example.com')).toBe('ad•@example.com')
    expect(maskAddress('a@example.com')).toBe('a•@example.com')
  })

  it('shows the last four of a phone number', () => {
    expect(maskAddress('+15125550100')).toBe('••••0100')
  })

  it('never leaks a short value whole', () => {
    expect(maskAddress('0100')).toBe('••••')
  })
})
