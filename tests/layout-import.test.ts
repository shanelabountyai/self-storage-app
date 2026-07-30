import { describe, expect, it } from 'vitest'
import { LAYOUT_IMPORT_LIMIT, parseLayout } from '../packages/core/inventory'

const valid = [{ number: 'A-1', unitTypeName: '10x10', building: 'A', floor: 1, mapX: 0, mapY: 0 }]

describe('parseLayout — accepted shapes', () => {
  it('accepts a bare array', () => {
    const result = parseLayout(JSON.stringify(valid))
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')
    expect(result.entries[0]).toMatchObject({ number: 'A-1', unitTypeName: '10x10', floor: 1 })
  })

  it('accepts an object wrapping a units array', () => {
    const result = parseLayout(JSON.stringify({ units: valid }))
    expect(result.ok).toBe(true)
  })

  it('defaults floor to 1 and optional fields to null', () => {
    const result = parseLayout(JSON.stringify([{ number: 'A-1', unitTypeName: '10x10' }]))
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')
    expect(result.entries[0]).toMatchObject({ floor: 1, building: null, doorType: null, mapX: null, mapY: null })
  })

  it('trims whitespace around identifiers', () => {
    const result = parseLayout(JSON.stringify([{ number: '  A-1  ', unitTypeName: ' 10x10 ' }]))
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')
    expect(result.entries[0].number).toBe('A-1')
    expect(result.entries[0].unitTypeName).toBe('10x10')
  })
})

describe('parseLayout — rejections', () => {
  it('rejects malformed JSON with a readable message', () => {
    const result = parseLayout('{ not json')
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.issues[0].field).toBe('file')
    expect(result.issues[0].message).toMatch(/not valid json/i)
  })

  it('rejects a non-array payload', () => {
    expect(parseLayout(JSON.stringify({ hello: 'world' })).ok).toBe(false)
  })

  it('rejects an empty layout', () => {
    expect(parseLayout('[]').ok).toBe(false)
  })

  it('rejects rows missing required fields, reporting each', () => {
    const result = parseLayout(JSON.stringify([{ building: 'A' }, { number: 'B-1' }]))
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    const fields = result.issues.map((i) => i.field)
    expect(fields).toContain('number')
    expect(fields).toContain('unitTypeName')
  })

  it('rejects duplicate unit numbers rather than letting last write win', () => {
    // Order-dependent imports are a nightmare to debug, so a file that
    // contradicts itself is refused outright.
    const result = parseLayout(
      JSON.stringify([
        { number: 'A-1', unitTypeName: '10x10' },
        { number: 'a-1', unitTypeName: '5x5' },
      ]),
    )
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.issues[0].message).toMatch(/duplicate/i)
  })

  it('rejects a non-positive or fractional floor', () => {
    for (const floor of [0, -1, 1.5, 'ground']) {
      const result = parseLayout(JSON.stringify([{ number: 'A-1', unitTypeName: '10x10', floor }]))
      expect(result.ok, String(floor)).toBe(false)
    }
  })

  it('rejects non-numeric coordinates', () => {
    const result = parseLayout(JSON.stringify([{ number: 'A-1', unitTypeName: '10x10', mapX: 'left' }]))
    expect(result.ok).toBe(false)
  })

  it('rejects a file over the import limit', () => {
    const many = Array.from({ length: LAYOUT_IMPORT_LIMIT + 1 }, (_, i) => ({
      number: `A-${i}`,
      unitTypeName: '10x10',
    }))
    const result = parseLayout(JSON.stringify(many))
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.issues[0].message).toMatch(/limit/i)
  })

  it('reports the row index so a human can find it', () => {
    const result = parseLayout(
      JSON.stringify([{ number: 'A-1', unitTypeName: '10x10' }, { number: 'A-2' }]),
    )
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.issues[0].index).toBe(1)
  })
})
