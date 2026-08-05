import { describe, expect, it } from 'vitest'
import { missingProofFields, taskTypeIsSensitive, taskTypeSpec } from '../packages/core/tasks'

// B-095 / PRD 02 §4.9 US-41. Pure catalog logic — no database.

describe('taskTypeSpec', () => {
  it('finds a registered type', () => {
    expect(taskTypeSpec('move_in_provisioning_failed')?.label).toBe('Move-in provisioning failed')
  })

  it('returns undefined for an unknown type', () => {
    expect(taskTypeSpec('not_a_real_type')).toBeUndefined()
  })
})

describe('missingProofFields', () => {
  it('is empty once every required field is a non-empty string', () => {
    expect(missingProofFields('move_in_provisioning_failed', { note: 'Retried and it worked.' })).toEqual([])
  })

  it('lists the required field when proof is missing entirely', () => {
    expect(missingProofFields('move_in_provisioning_failed', null)).toEqual(['note'])
  })

  it('treats whitespace-only proof as missing', () => {
    expect(missingProofFields('move_in_provisioning_failed', { note: '   ' })).toEqual(['note'])
  })

  it('rejects a non-string value for a required field', () => {
    expect(missingProofFields('move_in_provisioning_failed', { note: 42 })).toEqual(['note'])
  })

  it('fails closed for an unregistered type — the default floor still applies', () => {
    // A typo'd type string must not silently accept an empty proof object as
    // sufficient. The very first version of this function got this backwards:
    // an unknown type had an empty required-fields list, so nothing was ever
    // "missing" — the fail-open bug this test exists to catch.
    expect(missingProofFields('not_a_real_type', { anything: 'here' })).toEqual(['note'])
    expect(missingProofFields('not_a_real_type', { note: 'Handled it.' })).toEqual([])
  })
})

describe('taskTypeIsSensitive', () => {
  it('is true for a type the catalog marks sensitive', () => {
    expect(taskTypeIsSensitive('returned_mail_review')).toBe(true)
  })

  it('is false for an ordinary operational type', () => {
    expect(taskTypeIsSensitive('move_in_provisioning_failed')).toBe(false)
  })

  it('is false for an unknown type rather than throwing', () => {
    expect(taskTypeIsSensitive('not_a_real_type')).toBe(false)
  })
})
