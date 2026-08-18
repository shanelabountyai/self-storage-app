// PRD 05 §5 FR-9a (B-084 part 3). Generated email that a screen reader can
// read.
//
// This is the first email in the product that **nobody wrote by hand**, which
// is why FR-9a was added to PRD 05 before it existed — "cheap to state now and
// expensive once templates exist, are versioned, and have rendered snapshots
// stored against thousands of message rows". Every criterion in that clause is
// met here structurally rather than by a reviewer remembering:
//
//   * a text alternative part that is a real equivalent, built from the same
//     document rather than by stripping tags out of the HTML;
//   * `lang` on the root element;
//   * real `<h1>`/`<h2>` elements in order, never a styled `<div>`;
//   * `<th scope>` on every tabular figure, columns AND row headers;
//   * nothing carried by colour alone — a figure that needs a warning gets a
//     word;
//   * no text rendered as an image, and in fact no images at all;
//   * link text that names its destination.
//
// Pure, so all of that is testable without sending anything.

export type EmailTable = {
  /// Required. A table with no caption in an email is a grid of numbers whose
  /// subject a screen-reader user has to infer from whatever came before it.
  caption: string
  /// Column headings, in order. The FIRST one labels the row-header column.
  columns: string[]
  /// Each row's cells, in the same order as `columns`. The first cell is
  /// rendered as a `<th scope="row">`, because in every report here the first
  /// column names the thing the row is about.
  rows: string[][]
}

export type EmailSection = {
  heading: string
  paragraphs?: string[]
  table?: EmailTable
}

export type EmailLink = {
  /// Names the destination. "Open the occupancy report", never "click here" —
  /// a screen-reader user listing the links in a message hears only this.
  label: string
  url: string
}

export type EmailDocument = {
  /// The `<h1>` and the subject line. One document, one heading.
  title: string
  /// The sentence under the heading that says what this is and what period it
  /// covers. Never omitted: a bare table of figures is a message whose purpose
  /// has to be guessed.
  intro: string
  sections: EmailSection[]
  links?: EmailLink[]
  /// The last line — why this arrived and how to stop it. An operational email
  /// with no way back to its own settings is one that gets filtered.
  footer: string
}

export type RenderedEmail = { subject: string; html: string; text: string }

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ESCAPES[char])
}

/// Table cells are padded so the text part lines up in a monospace client.
function padded(cells: readonly string[], widths: readonly number[]): string {
  return cells.map((cell, index) => cell.padEnd(widths[index] ?? 0)).join('  ').trimEnd()
}

function tableText(table: EmailTable): string[] {
  // A real equivalent, not a stripped table. The columns keep their headings
  // and the rows keep their alignment, so somebody reading the plain-text part
  // is reading the same report rather than a run-on of numbers.
  const widths = table.columns.map((column, index) =>
    Math.max(column.length, ...table.rows.map((row) => (row[index] ?? '').length)),
  )
  return [
    table.caption,
    padded(table.columns, widths),
    padded(
      table.columns.map((_, index) => '-'.repeat(widths[index])),
      widths,
    ),
    ...table.rows.map((row) => padded(row, widths)),
  ]
}

function tableHtml(table: EmailTable): string {
  const head = table.columns
    .map((column) => `<th scope="col" align="left">${escapeHtml(column)}</th>`)
    .join('')
  const body = table.rows
    .map((row) => {
      const [first, ...rest] = row
      // The first cell is what the row is ABOUT — a facility name, a bucket —
      // so it is a row header. Without this a screen reader reads "12,900"
      // with nothing saying which site it belongs to.
      const header = `<th scope="row" align="left">${escapeHtml(first ?? '')}</th>`
      const cells = rest.map((cell) => `<td align="right">${escapeHtml(cell)}</td>`).join('')
      return `<tr>${header}${cells}</tr>`
    })
    .join('')

  return (
    `<table role="table" border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;width:100%">` +
    `<caption align="left" style="text-align:left;padding-bottom:4px">${escapeHtml(table.caption)}</caption>` +
    `<thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`
  )
}

/// Renders one document into the two parts a message carries.
///
/// Both are built from the same `EmailDocument`. That is the point: a text part
/// derived by stripping tags out of the HTML is the "tag soup" FR-9a names, and
/// it goes stale the moment the markup changes.
export function renderReportEmail(document: EmailDocument): RenderedEmail {
  const sections = document.sections
    .map((section) => {
      const parts = [`<h2>${escapeHtml(section.heading)}</h2>`]
      for (const paragraph of section.paragraphs ?? []) {
        parts.push(`<p>${escapeHtml(paragraph)}</p>`)
      }
      if (section.table) parts.push(tableHtml(section.table))
      return parts.join('')
    })
    .join('')

  const links = (document.links ?? [])
    .map(
      (link) =>
        `<li><a href="${escapeHtml(link.url)}">${escapeHtml(link.label)}</a></li>`,
    )
    .join('')

  const html =
    // `lang` on the root, per FR-9a. Without it a screen reader pronounces the
    // content in whatever language it was last set to.
    `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
    `<title>${escapeHtml(document.title)}</title></head><body>` +
    // A real h1, then h2 per section, in order and with nothing skipped.
    `<h1>${escapeHtml(document.title)}</h1>` +
    `<p>${escapeHtml(document.intro)}</p>` +
    sections +
    (links ? `<h2>Open these in the dashboard</h2><ul>${links}</ul>` : '') +
    `<p>${escapeHtml(document.footer)}</p>` +
    `</body></html>`

  const textParts = [document.title, '='.repeat(document.title.length), '', document.intro, '']
  for (const section of document.sections) {
    textParts.push(section.heading, '-'.repeat(section.heading.length))
    for (const paragraph of section.paragraphs ?? []) textParts.push(paragraph)
    if (section.table) textParts.push('', ...tableText(section.table))
    textParts.push('')
  }
  if (document.links?.length) {
    textParts.push('Open these in the dashboard', '---------------------------')
    for (const link of document.links) textParts.push(`${link.label}: ${link.url}`)
    textParts.push('')
  }
  textParts.push(document.footer)

  return { subject: document.title, html, text: textParts.join('\n') }
}
