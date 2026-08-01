import type { PublicUnitType } from './public-inventory'

// PRD 01 US-201. Filtering and sorting the unit list, as pure functions over
// what the inventory read already returned — no second query, and no client
// state: the whole thing round-trips through the URL so a filtered view is
// shareable and the back button behaves (same rule as B-015's search).

/// US-201's three size buckets. Boundaries are stated in square feet because
/// that is what survives an operator naming a type "5x10 Locker" or "Small".
export const SIZE_BANDS = {
  small: { label: 'Small (up to 5×5)', max: 25 },
  medium: { label: 'Medium (5×10 to 10×10)', min: 26, max: 100 },
  large: { label: 'Large (10×15 and up)', min: 101 },
} as const

export type SizeBand = keyof typeof SIZE_BANDS

export const FEATURE_FILTERS = {
  climate: { label: 'Climate controlled', matches: (u: PublicUnitType) => u.climateControlled },
  driveUp: { label: 'Drive-up access', matches: (u: PublicUnitType) => u.driveUp },
  power: { label: 'Power outlet', matches: (u: PublicUnitType) => u.powerAvailable },
  groundFloor: { label: 'Ground floor', matches: (u: PublicUnitType) => u.floor <= 1 },
} as const

export type FeatureKey = keyof typeof FEATURE_FILTERS

/// Price low→high is the default because it is what a comparer is here for.
export const SORTS = {
  price: { label: 'Price: low to high', compare: (a: PublicUnitType, b: PublicUnitType) => a.webRateCents - b.webRateCents },
  size: { label: 'Size: small to large', compare: (a: PublicUnitType, b: PublicUnitType) => a.sqFt - b.sqFt },
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
