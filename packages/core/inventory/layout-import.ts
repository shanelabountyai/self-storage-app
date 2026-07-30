// PRD 02 US-5: "MVP: grid view + optional pre-built JSON layout import."
//
// Parsing and validation are pure and live here so a malformed file is
// rejected with per-row reasons before anything touches the database, and so
// the same validation backs both the preview and the apply.
//
// The realistic workflow is standing up a new facility: the layout describes
// units that mostly do not exist yet. So an import creates missing units and
// updates existing ones, matched by unit number — it is not position-only.

export type LayoutEntry = {
  number: string
  unitTypeName: string
  building: string | null
  floor: number
  doorType: string | null
  /// Optional grid coordinates. The P2 layout editor writes these; a hand-built
  /// JSON may omit them and get the auto-arranged grid instead.
  mapX: number | null
  mapY: number | null
}

export type LayoutParseIssue = { index: number; field: string; message: string }

export type LayoutParseResult =
  | { ok: true; entries: LayoutEntry[] }
  | { ok: false; issues: LayoutParseIssue[] }

/// Cap matches the bulk-edit limit — an import is a bulk write with the same
/// transaction-size concern.
export const LAYOUT_IMPORT_LIMIT = 500

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

function asOptionalNumber(value: unknown): number | null | undefined {
  if (value === undefined || value === null) return null
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/// Accepts either a bare array or `{ units: [...] }`, since both shapes turn up
/// in hand-built files and rejecting one on a technicality helps nobody.
export function parseLayout(raw: string): LayoutParseResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    return {
      ok: false,
      issues: [{ index: -1, field: 'file', message: `Not valid JSON: ${(error as Error).message}` }],
    }
  }

  const list = Array.isArray(parsed)
    ? parsed
    : typeof parsed === 'object' && parsed !== null && Array.isArray((parsed as { units?: unknown }).units)
      ? ((parsed as { units: unknown[] }).units)
      : null

  if (!list) {
    return {
      ok: false,
      issues: [{ index: -1, field: 'file', message: 'Expected an array of units, or an object with a "units" array.' }],
    }
  }

  if (list.length === 0) {
    return { ok: false, issues: [{ index: -1, field: 'file', message: 'No units in the layout.' }] }
  }

  if (list.length > LAYOUT_IMPORT_LIMIT) {
    return {
      ok: false,
      issues: [
        {
          index: -1,
          field: 'file',
          message: `${list.length} units exceeds the ${LAYOUT_IMPORT_LIMIT}-unit import limit. Split the file.`,
        },
      ],
    }
  }

  const issues: LayoutParseIssue[] = []
  const entries: LayoutEntry[] = []
  const seen = new Map<string, number>()

  list.forEach((row, index) => {
    if (typeof row !== 'object' || row === null) {
      issues.push({ index, field: 'row', message: 'Expected an object.' })
      return
    }
    const record = row as Record<string, unknown>

    const number = asString(record.number)
    const unitTypeName = asString(record.unitTypeName)
    if (!number) issues.push({ index, field: 'number', message: 'Required, non-empty string.' })
    if (!unitTypeName) issues.push({ index, field: 'unitTypeName', message: 'Required, non-empty string.' })

    // Duplicate numbers inside one file would make the import order-dependent,
    // so they're rejected up front rather than last-write-wins.
    if (number) {
      const firstSeen = seen.get(number.toLowerCase())
      if (firstSeen !== undefined) {
        issues.push({ index, field: 'number', message: `Duplicate of row ${firstSeen + 1} ("${number}").` })
      } else {
        seen.set(number.toLowerCase(), index)
      }
    }

    const floorRaw = record.floor === undefined ? 1 : record.floor
    const floor = typeof floorRaw === 'number' && Number.isInteger(floorRaw) && floorRaw > 0 ? floorRaw : null
    if (floor === null) issues.push({ index, field: 'floor', message: 'Must be a positive integer.' })

    const mapX = asOptionalNumber(record.mapX)
    const mapY = asOptionalNumber(record.mapY)
    if (mapX === undefined) issues.push({ index, field: 'mapX', message: 'Must be a number if present.' })
    if (mapY === undefined) issues.push({ index, field: 'mapY', message: 'Must be a number if present.' })

    if (!number || !unitTypeName || floor === null || mapX === undefined || mapY === undefined) return

    entries.push({
      number,
      unitTypeName,
      building: asString(record.building),
      floor,
      doorType: asString(record.doorType),
      mapX,
      mapY,
    })
  })

  return issues.length > 0 ? { ok: false, issues } : { ok: true, entries }
}
