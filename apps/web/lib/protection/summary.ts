import { formatRate } from '@/lib/format'
import { translate, type Dictionary, type MessageKey } from '@/lib/i18n'

// PRD 01 US-705 "what my protection covers" (B-423). The four draft coverage
// lines D-152 (4) settled on, filled with the tier's limit. The limit is the
// only thing that differs between tiers today; the perils, the valuation, the
// exclusions and the term are the same addendum at every level. Draft, not
// legal advice (D-10).

const COVERAGE_LINE_KEYS = [
  'prot.coversLine1',
  'prot.coversLine2',
  'prot.coversLine3',
  'prot.coversLine4',
] as const satisfies readonly MessageKey[]

export function coverageLines(dict: Dictionary, coverageCents: number): string[] {
  const coverage = formatRate(coverageCents)
  return COVERAGE_LINE_KEYS.map((key) => translate(dict, key, { coverage }))
}
