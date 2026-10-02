import { describe, expect, it } from 'vitest'
import { moveCounts, sumMoveCounts, MOVE_OUT_CAUSES } from '@storage/core/metrics'
import { movesCsv } from '../apps/web/lib/admin/reports'

// B-430. Per row, the reason columns sum to the move-out count.
describe('movesCsv', () => {
  it('reason columns sum to Move-outs on every row, including the roll-up', () => {
    const a = moveCounts([], 4, ['moved_away', 'moved_away', 'other', null])
    const b = moveCounts([], 2, ['system_lien_sale', 'bought_home'])
    const row = (facilityName: string, moves: typeof a) => ({ facilityId: facilityName, facilityName, moves }) as never
    const csv = movesCsv({
      rows: [row('A', a), row('B', b)],
      total: { moves: sumMoveCounts([a, b]), conversion: {} as never },
    })
    const [header, ...lines] = csv.split('\r\n').map((l) => l.split(','))
    expect(header).toHaveLength(4 + MOVE_OUT_CAUSES.length)
    expect(lines).toHaveLength(3)
    for (const cells of lines) {
      const sum = cells.slice(4).reduce((n, c) => n + Number(c), 0)
      expect(sum).toBe(Number(cells[2]))
    }
    expect(lines[2][0]).toBe('All facilities')
  })
})
