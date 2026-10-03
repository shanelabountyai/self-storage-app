import { createHash } from 'node:crypto'
import { escapeHtml, OPTIONAL_MERGE_FIELDS } from '@storage/core/comms'

// PRD 05 FR-9 / FR-16. Pure, DB-free helpers: turning a template + a context
// into a rendered message, and deriving the idempotency key that makes a send
// happen at most once.

/// The merge context is a flat map keyed by the dotted field names FR-10 lists
/// (`tenant.first_name`, `unit.number`, …). Flat rather than nested so a
/// template's `{{tenant.first_name}}` is a single lookup and the required-field
/// check is a single `in`.
export type MergeContext = Record<string, MergeValue>

/// Most merged values are one string that reads the same in both parts of the
/// message. A few are inherently tabular — a payment plan's schedule (CN-24) —
/// and a table flattened to a string can only come back as prose. Those supply
/// BOTH renderings of the one value, built side by side from the same data by
/// whoever has it, which is the same rule `renderReportEmail` follows and the
/// opposite of deriving one part from the other.
///
/// B-198: this is what `MessageTemplate.bodyHtml` was for and never did. A
/// second editable body made every template two documents that could disagree;
/// a structured VALUE keeps one document and lets the tabular field carry its
/// own structure into the HTML part.
export type MergeValue = string | { text: string; html: string }

const textOf = (value: MergeValue): string => (typeof value === 'string' ? value : value.text)
const htmlOf = (value: MergeValue): string =>
  typeof value === 'string' ? escapeHtml(value) : value.html

export class RenderError extends Error {
  readonly missing: string[]

  constructor(missing: string[]) {
    super(`Template is missing required merge field(s): ${missing.join(', ')}`)
    this.name = 'RenderError'
    this.missing = missing
  }
}

const PLACEHOLDER = /\{\{\s*([\w.]+)\s*\}\}/g

/// Renders one template string. Fails loudly (FR-9, inherits PRD 02 FR-6
/// "never send with blank merge fields") in two cases a blank-substitution
/// approach would let through silently:
///   1. a declared required field is absent or empty in the context, and
///   2. a `{{placeholder}}` survives substitution — a template referencing a
///      field nobody supplied would otherwise mail literal "{{balance.total}}"
///      to a tenant.
export function renderString(
  template: string,
  context: MergeContext,
  requiredMergeFields: readonly string[] = [],
): string {
  return render(template, context, requiredMergeFields, 'text')
}

/// The text and HTML parts differ in exactly two ways, both of them here: the
/// literal template text is escaped (and its newlines become `<br>`), and a
/// structured value contributes its HTML rendering instead of its text one.
/// Everything else — which fields are required, what counts as unresolved — is
/// one implementation, so the two parts cannot disagree about what a message
/// says.
function render(
  template: string,
  context: MergeContext,
  requiredMergeFields: readonly string[],
  mode: 'text' | 'html',
): string {
  const missingRequired = requiredMergeFields.filter((field) => {
    const value = context[field]
    return value === undefined || textOf(value) === ''
  })
  if (missingRequired.length > 0) throw new RenderError(missingRequired)

  const literal = (part: string) =>
    mode === 'html' ? escapeHtml(part).replace(/\n/g, '<br>') : part

  const unresolved = new Set<string>()
  let out = ''
  let cursor = 0
  for (const match of template.matchAll(PLACEHOLDER)) {
    out += literal(template.slice(cursor, match.index))
    const value = context[match[1]]
    if (value === undefined || (textOf(value) === '' && !OPTIONAL_MERGE_FIELDS.has(match[1])))
      unresolved.add(match[1])
    else out += mode === 'html' ? htmlOf(value) : textOf(value)
    cursor = match.index + match[0].length
  }
  out += literal(template.slice(cursor))

  if (unresolved.size > 0) throw new RenderError([...unresolved])
  return out
}

export type RenderedEmail = { subject: string; html: string; text: string }

/// PRD 05 FR-9a, for the TEMPLATED email — B-084 part 3 established the
/// criteria on the generated report kind, and B-191/CN-24 is the first item
/// whose acceptance criteria named them for a template.
///
/// Every template in this product is ONE document: the text body, with
/// `{{fields}}` in it. The HTML part is that same document rendered as markup —
/// not a second body somebody maintains alongside it (B-198 deleted
/// `MessageTemplate.bodyHtml` for exactly that reason), and not the text part
/// with tags bolted on afterwards. Blank lines separate paragraphs, the subject
/// is the single `<h1>`, and every merged value is escaped on its way in: a
/// facility called "Bob & Sons" emitted broken markup before B-191.
///
/// A structured value (`MergeValue`) placed alone in its own paragraph owns
/// that block and contributes its markup unwrapped — a `<table>` inside a `<p>`
/// is invalid, and the browser's fixup for it is to close the paragraph early
/// and leave the caption stranded. Inline in a sentence it still renders, so a
/// staffer who moves `{{plan.schedule}}` onto a line with other words gets a
/// table beside them rather than a broken page; keeping it on its own line is
/// what keeps it a paragraph of its own.
///
/// It is a FRAGMENT, not a page — the `<html>` root is the provider's, and the
/// two call sites in `service.ts` append the postal footer and the unsubscribe
/// link after it. So `lang` goes on the wrapper element, which is where it can
/// actually be honoured.
const SOLO_PLACEHOLDER = /^\{\{\s*([\w.]+)\s*\}\}$/

function htmlBody(subject: string, bodyText: string, context: MergeContext, lang: string): string {
  const blocks = bodyText
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const solo = block.match(SOLO_PLACEHOLDER)
      const value = solo ? context[solo[1]] : undefined
      if (value !== undefined && typeof value !== 'string') return value.html
      return `<p>${render(block, context, [], 'html')}</p>`
    })
    .join('')
  // The subject as the `<h1>`: one document, one heading (the same rule
  // `EmailDocument.title` states). Omitted rather than faked when a template
  // has no subject, since an empty heading is worse than none.
  const heading = subject ? `<h1>${escapeHtml(subject)}</h1>` : ''
  return `<div lang="${lang}">${heading}${blocks}</div>`
}

/// Renders an email template into the two parts a message carries, both from
/// the one body. Plaintext is what every serious deliverability check wants
/// alongside HTML, and it is the part FR-9a requires be a real equivalent.
/// B-261. `lang` is the language the rendered document IS, and it has to be
/// passed rather than assumed: the wrapper carried a hardcoded `lang="en"`,
/// so a Spanish template rendered through it told every screen reader to
/// pronounce Spanish with English phonemes — 3.1.2, and the one accessibility
/// failure a translation introduces rather than fixes.
///
/// It is the LOCALE, not a BCP-47 region tag: `lang="es"` is the correct
/// declaration for Spanish prose whose regional variant is not being asserted,
/// and `es-US` here would claim something about the dialect that the
/// translation does not.
export function renderEmail(
  template: { subject: string | null; bodyText: string; requiredMergeFields: string[] },
  context: MergeContext,
  lang: string = 'en',
): RenderedEmail {
  const required = template.requiredMergeFields
  const subject = renderString(template.subject ?? '', context, required)
  const text = renderString(template.bodyText, context, required)
  return { subject, html: htmlBody(subject, template.bodyText, context, lang), text }
}

/// PRD 05 FR-16. The deterministic idempotency key: one message per
/// (event, rule, recipient, channel). SHA-256 of the joined parts — a hash
/// rather than the raw join so the key is fixed-length and safe as a unique
/// column value regardless of how odd an id ever gets.
export function messageIdempotencyKey(
  eventId: string,
  ruleId: string,
  recipientId: string,
  channel: string,
): string {
  return createHash('sha256').update([eventId, ruleId, recipientId, channel].join(' ')).digest('hex')
}
