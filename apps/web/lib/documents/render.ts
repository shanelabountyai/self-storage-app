import { createHash } from 'node:crypto'

// PRD 02 FR-6 / PRD 01 §6.8.1. Templated documents with merge-field validation.
//
// ── Why HTML and not PDF ─────────────────────────────────────────────────────
//
// The backlog row asks for "templated PDFs" that are **tagged**: heading
// structure, reading order, table headers, document `lang`, `/Title`, real text
// not raster. That is not a stylistic preference — an untagged lease PDF is the
// classic accessibility failure that gets discovered years later, and PRD 01
// §6.8.1 lists it explicitly.
//
// No JavaScript PDF library available to this project emits tagged PDFs.
// `pdf-lib`, `pdfkit` and `@react-pdf/renderer` all produce untagged output;
// tagging is a structure tree the encoder has to build, and none of them expose
// one. The routes that do work are a headless browser's print pipeline (Chrome
// does emit tagged PDFs from semantic HTML) or a paid API — both a runtime or
// vendor decision this project has not taken, and Vercel's serverless runtime
// has no Chrome.
//
// So: semantic HTML is the canonical rendered document. It is genuinely more
// accessible than any PDF we could produce today, it hashes and stores exactly
// the same way, and it is what the e-signature evidence chain signs. The PDF
// encoder is a port with no adapter yet — the same posture D-4 took for gate
// vendors and D-14 for geocoding: ship a real implementation of the thing we
// can do well, and leave a named seam rather than a bad version of the thing we
// cannot.

export class MissingMergeFieldsError extends Error {
  readonly fields: string[]

  constructor(fields: string[]) {
    super(`Template is missing values for: ${fields.join(', ')}`)
    this.name = 'MissingMergeFieldsError'
    this.fields = fields
  }
}

/// `{{field}}`, no filters, no logic. A template language with conditionals is
/// a template language that needs its own tests and its own error messages; a
/// lease that needs a conditional clause gets two templates.
const FIELD = /\{\{(\w+)\}\}/g

export function mergeFieldsIn(template: string): string[] {
  return [...new Set([...template.matchAll(FIELD)].map((match) => match[1]))]
}

/// Fills a template, failing loudly on anything missing.
///
/// FR-6's "fails loudly on missing fields" is the whole requirement. A lease
/// that renders "Dear {{firstName}}" or, worse, "Dear " is a document somebody
/// signs — silence here produces a legal artifact with a hole in it, so an
/// absent or blank value throws rather than rendering.
export function renderTemplate(template: string, values: Record<string, string>): string {
  const missing = mergeFieldsIn(template).filter(
    (field) => values[field] === undefined || values[field].trim() === '',
  )
  if (missing.length > 0) throw new MissingMergeFieldsError(missing)

  return template.replace(FIELD, (_match, field: string) => escapeHtml(values[field]))
}

/// Values are merged into markup, so they are escaped. A tenant whose surname
/// contains an ampersand must not be able to break the document, and a lease is
/// exactly the place someone would try.
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export type RenderedDocument = {
  title: string
  html: string
  /// SHA-256 over the exact rendered bytes. PRD 01 FR-4.2's evidence: a signed
  /// document whose hash no longer matches is one that changed after signing.
  contentHash: string
}

/// Wraps merged content in a complete, accessible document.
///
/// The `lang`, the `<title>`, the single `<h1>` and the real text are the same
/// things the tagged-PDF requirement asks for — expressed in the format that
/// can actually carry them today.
export function renderDocument(input: {
  title: string
  template: string
  values: Record<string, string>
  lang?: string
}): RenderedDocument {
  const body = renderTemplate(input.template, input.values)
  const html = [
    '<!doctype html>',
    `<html lang="${input.lang ?? 'en'}">`,
    '<head>',
    '<meta charset="utf-8">',
    `<title>${escapeHtml(input.title)}</title>`,
    '</head>',
    '<body>',
    `<h1>${escapeHtml(input.title)}</h1>`,
    body,
    '</body>',
    '</html>',
  ].join('\n')

  return { title: input.title, html, contentHash: hashContent(html) }
}

export function hashContent(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex')
}

/// Verifies a stored document against its recorded hash. What an audit or a
/// dispute actually asks: is this the document that was signed?
export function contentMatchesHash(content: string, contentHash: string): boolean {
  return hashContent(content) === contentHash
}
