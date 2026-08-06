// PRD 02 US-39: "CSV export matching on-screen data exactly."
//
// The "exactly" is the whole point, and it is why callers build one array of
// rows and hand the SAME array to both the table and this function — never
// two queries, never a second formatting pass.

/// Escapes one field per RFC 4180: quote it if it contains a comma, a quote,
/// or a newline, and double any embedded quotes.
///
/// The leading-character guard is not RFC 4180 — it is the spreadsheet
/// formula-injection defence. A tenant whose name begins `=` or `+` would
/// otherwise be interpreted as a formula the moment an operator opens the
/// export in Excel, which is a real attack against a file staff are told to
/// trust. Prefixing a tab keeps the value readable and inert.
export function csvField(value: unknown): string {
  const raw = value === null || value === undefined ? '' : String(value)
  const needsGuard = /^[=+\-@\t\r]/.test(raw)
  const guarded = needsGuard ? `\t${raw}` : raw
  // Always quote a guarded value: a leading tab in an UNQUOTED field is
  // whitespace a spreadsheet may trim on import, which would hand back the
  // live formula the guard exists to defuse.
  return needsGuard || /[",\n\r]/.test(guarded)
    ? `"${guarded.replace(/"/g, '""')}"`
    : guarded
}

export function toCsv(headers: readonly string[], rows: readonly (readonly unknown[])[]): string {
  const lines = [headers.map(csvField).join(',')]
  for (const row of rows) lines.push(row.map(csvField).join(','))
  // CRLF per RFC 4180 — Excel is the consumer that cares.
  return lines.join('\r\n')
}

/// Money for a CSV cell: a plain decimal, no currency symbol and no thousands
/// separator, so a spreadsheet reads it as a number rather than text.
export function csvCents(cents: number): string {
  return (cents / 100).toFixed(2)
}

/// A ratio as a percentage with one decimal, matching how the screen renders
/// it — the "matching exactly" rule applies to rounding too.
export function csvPercent(ratio: number): string {
  return (ratio * 100).toFixed(1)
}
