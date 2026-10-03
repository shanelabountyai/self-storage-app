// B-432. Where a unit sits inside the site, in the renter's words. Shared by
// the confirmation page and the move-in email so the two cannot disagree.
export type UnitPlace = { number: string; building: string | null; floor: number }

export type PlaceWords = {
  building: (name: string) => string
  floor: (n: number) => string
}

/// "Building B, floor 2", or null when there is nothing to say. `floor` is
/// never null (default 1), so on a site with no buildings floor 1 is silence
/// rather than a claim; with a building named, floor 1 is worth saying.
export function unitPlace(unit: UnitPlace, words: PlaceWords): string | null {
  const parts = [
    unit.building ? words.building(unit.building) : null,
    unit.building || unit.floor !== 1 ? words.floor(unit.floor) : null,
  ].filter((part): part is string => part !== null)
  return parts.length > 0 ? parts.join(', ') : null
}
