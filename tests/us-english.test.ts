import { describe, expect, it } from 'vitest'
import { COMMS_TEMPLATES } from '../packages/db/comms-catalog'
import { en } from '../apps/web/lib/i18n/en'
import { es } from '../apps/web/lib/i18n/es'

// B-345 (D-15). Customer English is US English. B-182 removed "ring the
// office"; this catches the next British "post" (mail) before it ships.
const BRITISH = /in the post|post to you|ring the office/i

describe('customer English is US English', () => {
  it('the en dictionary', () => {
    expect(Object.entries(en).filter(([, text]) => BRITISH.test(String(text)))).toEqual([])
  })

  it('the English template catalog', () => {
    const hits = COMMS_TEMPLATES.filter(({ subject, bodyText }) => BRITISH.test(`${subject ?? ''} ${bodyText}`))
    expect(hits.map((template) => template.key)).toEqual([])
  })
})

// B-408 (D-15's "one word per concept"). Wordings B-408 retired in favor of a
// single canonical string for the concept — checked as an exact value, not a
// substring, since a couple ("Your lease") are still legitimate mid-sentence.
// Reintroducing one of these as a dictionary VALUE is the several-names bug
// the review found, back again.
const RETIRED_SYNONYMS = [
  'Reserve this unit',
  'Apply',
  'Clear all',
  'Clear them',
  'You are moved in',
  'Your lease',
  'Month-to-month, no long-term commitment · Reserving is free and needs no card',
]

// D-122 binds the same rule to Spanish.
const RETIRED_SYNONYMS_ES = [
  'Reserve esta unidad',
  'Aplicar',
  'Borrar todo',
  'Quítelos',
  'Ya se mudó',
  'Su contrato',
  'Mes a mes, sin compromiso a largo plazo · Reservar es gratis y no pide tarjeta',
]

describe('one string per concept (B-408)', () => {
  it('the en dictionary keeps no retired synonym', () => {
    const hits = Object.entries(en).filter(([, text]) => RETIRED_SYNONYMS.includes(String(text)))
    expect(hits).toEqual([])
  })

  it('the es dictionary keeps no retired synonym', () => {
    const hits = Object.entries(es).filter(([, text]) => RETIRED_SYNONYMS_ES.includes(String(text)))
    expect(hits).toEqual([])
  })
})
