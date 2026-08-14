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
///
/// `rawFields` names the few merge fields whose value is MARKUP THIS
/// APPLICATION BUILT, not a value read from a record — B-061's itemized claim
/// table is the only one today. Everything else is escaped, and the default
/// (no raw fields at all) keeps it that way.
///
/// The seam is narrow on purpose. A template author cannot reach it: the field
/// name has to be passed in by the calling code alongside the value, so making
/// a field raw is a deliberate act in a reviewed file rather than something a
/// notice template can opt into. Any caller using it owns escaping every
/// record-derived string inside that markup — see `claimTableHtml`, which
/// escapes each description and invoice number it embeds.
export function renderTemplate(
  template: string,
  values: Record<string, string>,
  rawFields: readonly string[] = [],
): string {
  const missing = mergeFieldsIn(template).filter(
    (field) => values[field] === undefined || values[field].trim() === '',
  )
  if (missing.length > 0) throw new MissingMergeFieldsError(missing)

  const raw = new Set(rawFields)
  return template.replace(FIELD, (_match, field: string) =>
    raw.has(field) ? values[field] : escapeHtml(values[field]),
  )
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
  /// The complete document — doctype, `<html lang>`, `<title>`, `<h1>`. This is
  /// what gets stored, hashed, signed and emailed.
  html: string
  /// The merged content alone, with no document wrapper.
  ///
  /// Embedding `html` in a page does not work: injecting a full document into a
  /// `<div>` leaves the markup in the DOM but unrendered, which is a bug that
  /// looks like "the element exists but is not visible" and wastes an afternoon.
  /// A stored document is a document; an on-page preview is a fragment.
  bodyHtml: string
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
  /// See `renderTemplate` — merge fields whose value is markup this
  /// application generated. Empty by default; everything is escaped.
  rawFields?: readonly string[]
  lang?: string
}): RenderedDocument {
  const body = renderTemplate(input.template, input.values, input.rawFields)
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

  return { title: input.title, html, bodyHtml: body, contentHash: hashContent(html) }
}

/// The embeddable fragment of a document we have already STORED — the same
/// thing `renderDocument` hands back as `bodyHtml`, recovered from the complete
/// document when only the stored bytes are to hand.
///
/// It exists because there were two answers. The checkout lease step built a
/// fresh lease from `bodyHtml` and a resumed one by stripping `<body>` inline,
/// which keeps the document's `<h1>` — so first visit and resume disagreed
/// about the heading outline of the same step, and only the resumed one
/// injected a second `<h1>` into a page that already has one. B-031 emails a
/// resume link precisely to make resuming the normal case.
///
/// Deliberately regex over a parser: the input is a document this module
/// generated four lines above, not arbitrary HTML, and its shape is fixed by
/// `renderDocument`.
export function bodyOf(html: string): string {
  return html
    .replace(/^[\s\S]*?<body>\s*/, '')
    .replace(/^<h1>[\s\S]*?<\/h1>\s*/, '')
    .replace(/\s*<\/body>[\s\S]*$/, '')
}

export function hashContent(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex')
}

/// Verifies a stored document against its recorded hash. What an audit or a
/// dispute actually asks: is this the document that was signed?
export function contentMatchesHash(content: string, contentHash: string): boolean {
  return hashContent(content) === contentHash
}
