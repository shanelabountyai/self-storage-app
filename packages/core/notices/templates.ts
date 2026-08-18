// PRD 02 §4.6 US-27 / US-29 (B-061). What a lien notice template must contain,
// and the draft starting points an operator edits.
//
// ── Read this before changing the text below ─────────────────────────────────
//
// None of this is legal advice, and none of it is presented as compliant with
// any state's lien statute. US-29's rule for the timeline applies with more
// force here, because a timeline is a schedule while a notice is the document
// itself: "No default timeline is presented as legally compliant; defaults are
// labeled 'example configuration'." The same posture, the same label, and the
// same reason — an operator's attorney has to read this before it is sent to
// anybody, and the system must never imply that step was already taken.
//
// The MERGE FIELDS, by contrast, are not a draft. They are the set of facts
// US-27 requires a generated notice to carry, and `renderTemplate` (PRD 02
// FR-6) already fails loudly on a missing one — so a template that drops the
// deadline or the itemized claim cannot be saved and then silently render a
// notice with a hole where the deadline should be.

export const NOTICE_TYPES = ['pre_lien', 'lien'] as const
export type LienNoticeType = (typeof NOTICE_TYPES)[number]

/// What each notice type is called on screen and on the envelope.
///
/// Hoisted here in B-083 because two admin screens already held identical
/// copies and the certified-mail letter description needed a third. A notice
/// type's name is the same fact wherever it is printed, and three copies is how
/// the pre-lien notice ends up called two different things in one lien file.
///
/// Covers the whole `NoticeType` enum, not only the two lien types this module
/// generates. Both screens render `notice.type` straight from the database, and
/// the two-entry maps they held printed the raw enum value — `late_notice` — for
/// the other four.
const TYPE_LABELS: Readonly<Record<string, string>> = {
  late_notice: 'Late notice',
  pre_lien: 'Pre-lien notice',
  lien: 'Lien notice',
  auction: 'Auction notice',
  rate_change: 'Rate-change notice',
  move_out: 'Move-out notice',
}

/// Total over any string, because the caller has a database enum rather than
/// `LienNoticeType` and a lookup that can return `undefined` is how a blank
/// lands on an envelope.
export function noticeTypeLabel(type: string): string {
  return TYPE_LABELS[type] ?? type
}

/// US-27's own list: "tenant, unit, itemized balance with accrual dates,
/// deadline date, sale statement, facility contact info."
///
/// Required means required — `renderTemplate` throws rather than rendering a
/// blank, and `validateNoticeTemplate` below refuses to save a template that
/// omits one. Both halves matter: the first stops a bad send, the second stops
/// the bad template ever being saved to send from.
export const REQUIRED_NOTICE_FIELDS = [
  'tenantName',
  'tenantAddress',
  'facilityName',
  'facilityAddress',
  'facilityContact',
  'unitNumber',
  'claimTable',
  'claimTotal',
  'oldestAccrualDate',
  'deadlineDate',
  'saleStatement',
  'noticeDate',
] as const

export type NoticeMergeField = (typeof REQUIRED_NOTICE_FIELDS)[number]

/// Shown beside every notice template editor and on every generated preview.
/// Persistent, not dismissible, for the reason B-056 gave: the person approving
/// a sale eight months from now is not the person who read this today.
export const NOTICE_DISCLAIMER =
  'Draft only — not legal advice. Lien notice content, timing and delivery method are set by ' +
  'state statute and vary by state. These templates have not been reviewed by an attorney, and ' +
  'nothing here is presented as compliant with any state’s requirements. Have your attorney ' +
  'review and rewrite this text for your state before any notice is sent.'

export const EXAMPLE_TEMPLATE_LABEL = 'Example template — not legal advice'

export type NoticeTemplateProblem = { field: string; problem: string }

/// Refuses a template that would render a notice with a required fact missing.
///
/// Checked at save time as well as at render time. Render-time failure alone
/// would mean an operator discovers their template is unusable on day 15 of a
/// lien cycle, with a task open and a statutory clock running.
export function validateNoticeTemplate(body: string): NoticeTemplateProblem[] {
  const problems: NoticeTemplateProblem[] = []

  if (!body.trim()) {
    problems.push({ field: 'body', problem: 'A notice template cannot be empty.' })
    return problems
  }

  for (const field of REQUIRED_NOTICE_FIELDS) {
    if (!body.includes(`{{${field}}}`)) {
      problems.push({
        field,
        problem: `The template does not include {{${field}}}. US-27 requires every generated notice to carry it.`,
      })
    }
  }

  return problems
}

// ── The drafts ───────────────────────────────────────────────────────────────
//
// Written to be obviously a starting point rather than a finished document:
// every one carries the disclaimer in its own body, so a notice generated from
// an unedited template says so on its face rather than looking authoritative.

const SHARED_BLOCKS = `
<p>{{noticeDate}}</p>
<p>{{tenantName}}<br>{{tenantAddress}}</p>
<p><strong>Facility:</strong> {{facilityName}}<br>{{facilityAddress}}<br>{{facilityContact}}</p>
<p><strong>Unit:</strong> {{unitNumber}}</p>
`.trim()

const CLAIM_BLOCK = `
<h2>Amount claimed</h2>
<p>Our records show an unpaid balance on this unit, itemized below. The oldest unpaid charge on this account accrued on {{oldestAccrualDate}}.</p>
{{claimTable}}
<p><strong>Total claimed: {{claimTotal}}</strong></p>
`.trim()

export const EXAMPLE_TEMPLATES: Readonly<Record<LienNoticeType, { title: string; body: string }>> = {
  pre_lien: {
    title: 'Notice of past-due account (draft)',
    body: `
${SHARED_BLOCKS}
<h2>This is a draft notice</h2>
<p>${NOTICE_DISCLAIMER}</p>
${CLAIM_BLOCK}
<h2>What happens next</h2>
<p>Payment in full is due by <strong>{{deadlineDate}}</strong>.</p>
<p>{{saleStatement}}</p>
<p>If you believe this balance is wrong, contact us at {{facilityContact}} straight away so we can look at it with you.</p>
`.trim(),
  },
  lien: {
    title: 'Notice of lien and intent to sell (draft)',
    body: `
${SHARED_BLOCKS}
<h2>This is a draft notice</h2>
<p>${NOTICE_DISCLAIMER}</p>
${CLAIM_BLOCK}
<h2>Deadline</h2>
<p>The total above must be paid in full by <strong>{{deadlineDate}}</strong>.</p>
<h2>Sale of the property in your unit</h2>
<p>{{saleStatement}}</p>
<p>If you believe this balance is wrong, or you want to arrange payment, contact us at {{facilityContact}} before the date above.</p>
`.trim(),
  },
}

/// The `saleStatement` merge value. Kept here rather than in a template so the
/// two notice types cannot drift into saying different things about the same
/// consequence, and so the hedging language stays in one place.
export const EXAMPLE_SALE_STATEMENTS: Readonly<Record<LienNoticeType, string>> = {
  pre_lien:
    'If this balance is not paid, your account may proceed to a lien on the property stored in your ' +
    'unit, and that property may eventually be sold to satisfy the amount owed. The specific steps, ' +
    'timing and notice required are governed by state law.',
  lien:
    'A lien is claimed against the property stored in your unit. If the amount above is not paid by ' +
    'the deadline, the property may be advertised and sold to satisfy the lien, and your right to ' +
    'access the unit may remain suspended until the balance is paid. The specific steps, timing and ' +
    'notice required are governed by state law.',
}
