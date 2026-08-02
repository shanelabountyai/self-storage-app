// PRD 01 US-501 step 4 / FR-4.2, PRD 02 US-15. The lease itself.
//
// ── This is draft text and is not legal advice ───────────────────────────────
//
// D-10 makes Texas the default and everything per-state configurable. The
// clauses below are a plausible, plain-language starting point for a Texas
// self-storage rental agreement written so a renter can understand it — they
// have not been reviewed by an attorney, and this project's convention is to
// say so rather than let generated text acquire authority by looking official.
//
// Specifically outstanding before this is used against a real tenant: the lien
// and notice language (Texas Property Code ch. 59), the rate-increase notice
// period (PRD 01 §10 open question), and the protection-plan clause that D-17's
// auto-enrolment depends on.

export const LEASE_MERGE_FIELDS = [
  'tenantName',
  'tenantAddress',
  'facilityName',
  'facilityAddress',
  'unitNumber',
  'unitSize',
  'monthlyRate',
  'protectionSummary',
  'moveInDate',
  'billingDay',
  'lateFeeSummary',
  'gateHoursSummary',
] as const

/// The plain-language summary US-501 step 4 requires *above* the full text.
///
/// It is real page content, not a tooltip and not a collapsed panel: §6.4 wants
/// the summary read first, and PRD 01 §6.8.1 is explicit that the signature
/// control gates on the summary having rendered — never on "scrolled to
/// bottom", which is hostile to everyone and simply broken for a screen-reader
/// user who never scrolls at all.
export const LEASE_SUMMARY_TEMPLATE = `
<h2>The short version</h2>
<p>This is a plain-language summary of the agreement below. The full text is what you are signing.</p>
<dl>
  <dt>What you are renting</dt>
  <dd>Unit {{unitNumber}} ({{unitSize}}) at {{facilityName}}, {{facilityAddress}}.</dd>

  <dt>What it costs</dt>
  <dd>{{monthlyRate}} per month, due on day {{billingDay}} of each month. {{protectionSummary}}</dd>

  <dt>How long for</dt>
  <dd>Month to month. There is no fixed term and no early-termination penalty.</dd>

  <dt>If you pay late</dt>
  <dd>{{lateFeeSummary}} If you fall far enough behind, we can deny access to your unit and eventually sell the contents to recover what you owe. We will write to you first.</dd>

  <dt>When you can get in</dt>
  <dd>{{gateHoursSummary}}</dd>

  <dt>What we do not cover</dt>
  <dd>We are not responsible for your belongings. That is what the protection plan or your own insurance is for.</dd>
</dl>
`.trim()

export const LEASE_TEMPLATE = `
<h2>Storage rental agreement</h2>
<p>This agreement is between {{facilityName}} ("we", "us") of {{facilityAddress}}, and {{tenantName}} ("you") of {{tenantAddress}}, and starts on {{moveInDate}}.</p>

<h3>1. The space</h3>
<p>We rent you unit {{unitNumber}}, approximately {{unitSize}}, at the facility named above. You rent space only. We are not a warehouse and we do not take custody of what you store.</p>

<h3>2. Rent</h3>
<p>Rent is {{monthlyRate}} per month, payable in advance on day {{billingDay}} of each month. Your first payment covers the period from {{moveInDate}}. If you move in part-way through a month, that first payment is prorated for the days you actually have the unit.</p>

<h3>3. Term</h3>
<p>This agreement runs month to month. Either of us may end it by giving notice as described in section 8. There is no fixed term and no penalty for leaving.</p>

<h3>4. Late payment</h3>
<p>{{lateFeeSummary}} If your account stays unpaid, we may deny you access to the unit, and we may exercise a lien on the contents and sell them to recover what you owe. Before that happens we will send you written notice at the address in this agreement, and we will follow the process the law requires.</p>

<h3>5. Protection and insurance</h3>
<p>{{protectionSummary}}</p>
<p>Your belongings are not insured by us. We are not responsible for loss or damage to what you store, however it happens, except where the law says otherwise.</p>

<h3>6. What you may store</h3>
<p>You may not store anything alive, anything perishable, anything stolen, and nothing flammable, explosive or hazardous. You may not live in the unit or run a business from it that brings people to the site.</p>

<h3>7. Access</h3>
<p>{{gateHoursSummary}} We may enter the unit without notice in an emergency, and otherwise on reasonable notice — to inspect it, to repair it, or where the law allows.</p>

<h3>8. Ending the agreement</h3>
<p>You may end this agreement by telling us and removing everything from the unit. We may end it by giving you written notice. Rent already paid for the current month is not refunded unless we say otherwise in writing.</p>

<h3>9. Your address</h3>
<p>Notices go to the address in this agreement. If it changes, you must tell us in writing — a notice we send to the address on file is a notice properly given, even if you no longer live there.</p>

<h3>10. Changes</h3>
<p>We may change the rent or the terms of this agreement by giving you written notice in advance. If you keep the unit after a change takes effect, you have accepted it.</p>
`.trim()

/// The sentence a renter agrees to when they tick the consent box.
///
/// E-SIGN requires consent to transact electronically as its own affirmative
/// act — not something a signature implies — so this is deliberately separate
/// from the signature field and unticked by default.
export const ELECTRONIC_RECORDS_CONSENT =
  'I agree to sign this agreement electronically and to receive my lease, receipts and notices by email rather than on paper. I can ask for a paper copy at any time.'

/// A typed name is a signature under E-SIGN when it is the signer's own act and
/// is attributable to them. Comparing it to the name on the lease is the
/// cheapest attribution check there is, and catches the common real error —
/// someone typing "yes" or their initials — without rejecting genuine variants.
export function signatureMatchesName(typed: string, legalName: string): boolean {
  const normalise = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^a-z\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim()

  const typedNormal = normalise(typed)
  const nameNormal = normalise(legalName)
  if (typedNormal === '' || nameNormal === '') return false
  if (typedNormal === nameNormal) return true

  // Accept a signer who includes a middle name, or omits one that is on file.
  const typedParts = typedNormal.split(' ')
  const nameParts = nameNormal.split(' ')
  const first = nameParts[0]
  const last = nameParts[nameParts.length - 1]
  return typedParts[0] === first && typedParts[typedParts.length - 1] === last
}
