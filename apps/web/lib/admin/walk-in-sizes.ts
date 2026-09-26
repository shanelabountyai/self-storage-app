// B-403. The counter's move-in list: smallest size first, sold-out sizes last.
export type WalkInSize = {
  name: string
  widthFt: number
  lengthFt: number
  climateControlled: boolean
  available: number
}

export function orderWalkInSizes<T extends WalkInSize>(sizes: T[]): T[] {
  return [...sizes].sort(
    (a, b) =>
      Number(a.available === 0) - Number(b.available === 0) ||
      a.widthFt * a.lengthFt - b.widthFt * b.lengthFt ||
      a.name.localeCompare(b.name),
  )
}

export function walkInSizeLabel(s: WalkInSize): string {
  return `${s.widthFt}×${s.lengthFt}${s.climateControlled ? ' · Climate' : ''} · ${s.name}`
}
