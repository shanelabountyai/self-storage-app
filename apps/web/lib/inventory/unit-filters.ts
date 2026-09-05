import type { PublicUnitType } from './public-inventory'
import type { MessageKey } from '@/lib/i18n'

// PRD 01 US-201. Filtering and sorting the unit list, as pure functions over
// what the inventory read already returned — no second query, and no client
// state: the whole thing round-trips through the URL so a filtered view is
// shareable and the back button behaves (same rule as B-015's search).

/// US-201's three size buckets. Boundaries are stated in square feet because
/// that is what survives an operator naming a type "5x10 Locker" or "Small".
/// B-090 part 6: the customer-facing wording moved into the dictionaries and
/// what stays here is the KEY, so a filter cannot render English inside a
/// Spanish page. The boundaries did not move — only where the words live.
export const SIZE_BANDS = {
  small: { labelKey: 'filter.size.small', max: 25 },
  medium: { labelKey: 'filter.size.medium', min: 26, max: 100 },
  large: { labelKey: 'filter.size.large', min: 101 },
} as const satisfies Record<string, { labelKey: MessageKey; min?: number; max?: number }>

export type SizeBand = keyof typeof SIZE_BANDS

export const FEATURE_FILTERS = {
  climate: { labelKey: 'filter.feature.climate', matches: (u: PublicUnitType) => u.climateControlled },
  driveUp: { labelKey: 'filter.feature.driveUp', matches: (u: PublicUnitType) => u.driveUp },
  power: { labelKey: 'filter.feature.power', matches: (u: PublicUnitType) => u.powerAvailable },
  groundFloor: { labelKey: 'filter.feature.groundFloor', matches: (u: PublicUnitType) => u.floor <= 1 },
} as const satisfies Record<string, { labelKey: MessageKey; matches: (u: PublicUnitType) => boolean }>

export type FeatureKey = keyof typeof FEATURE_FILTERS

/// Price low→high is the default because it is what a comparer is here for.
export const SORTS = {
  price: { labelKey: 'sort.price', compare: (a: PublicUnitType, b: PublicUnitType) => a.webRateCents - b.webRateCents },
  size: { labelKey: 'sort.size', compare: (a: PublicUnitType, b: PublicUnitType) => a.sqFt - b.sqFt },
} as const

export type SortKey = keyof typeof SORTS

export type UnitFilters = {
  size?: SizeBand
  features: FeatureKey[]
  sort: SortKey
}

function isSizeBand(value: string | undefined): value is SizeBand {
  return value !== undefined && value in SIZE_BANDS
}

/// Parsed defensively: these arrive in a URL anyone can edit, and an
/// unrecognised value must fall back to "no filter" rather than showing an
/// empty list the visitor cannot explain.
export function parseFilters(params: {
  size?: string
  features?: string | string[]
  sort?: string
}): UnitFilters {
  const rawFeatures = Array.isArray(params.features)
    ? params.features
    : params.features
      ? [params.features]
      : []

  return {
    size: isSizeBand(params.size) ? params.size : undefined,
    features: rawFeatures.filter((key): key is FeatureKey => key in FEATURE_FILTERS),
    sort: params.sort === 'size' ? 'size' : 'price',
  }
}

function matchesSize(unitType: PublicUnitType, band: SizeBand): boolean {
  const bounds = SIZE_BANDS[band] as { min?: number; max?: number }
  if (bounds.min !== undefined && unitType.sqFt < bounds.min) return false
  if (bounds.max !== undefined && unitType.sqFt > bounds.max) return false
  return true
}

export function applyFilters(
  unitTypes: readonly PublicUnitType[],
  filters: UnitFilters,
): PublicUnitType[] {
  const matched = unitTypes.filter((unitType) => {
    if (filters.size && !matchesSize(unitType, filters.size)) return false
    // Features are ANDed: ticking "climate controlled" and "drive-up" means
    // both, which is what a person ticking two boxes expects even though it
    // often returns nothing.
    return filters.features.every((key) => FEATURE_FILTERS[key].matches(unitType))
  })

  return [...matched].sort(SORTS[filters.sort].compare)
}

/// True when anything is actually narrowing the list, so the page can offer a
/// "clear filters" escape only when there is something to clear.
export function hasActiveFilters(filters: UnitFilters): boolean {
  return filters.size !== undefined || filters.features.length > 0
}
