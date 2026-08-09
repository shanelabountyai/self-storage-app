import { createHmac } from 'node:crypto'
import { prisma } from '@storage/db'
import { emitEvent } from '@storage/core/events'
import {
  dedupKeys,
  deriveChannel,
  isWithinDedupWindow,
  type TouchPoint,
} from '@storage/core/marketing'

// PRD 04 §3.5 US-8, FR-LEAD-1..3 (B-068). The web half of lead capture.
//
// B-097 built the counter half — a staffer taking a call. This is the same
// `Lead` entity reached by an anonymous stranger over the public internet,
// which changes three things and only three: nobody is authenticated, the input
// is hostile, and the same person will submit twice.

export type LeadFormInput = {
  facilityId: string
  name: string
  email: string
  phone: string
  unitTypeId?: string | null
  moveInDate?: Date | null
  note?: string | null
  /// US-8 AC1: "phone (optional for quote, required for callback)".
  kind: 'quote' | 'callback'
  /// US-8 AC4's honeypot. A field no human sees and every naive bot fills.
  honeypot?: string | null
}

export type LeadContext = {
  firstTouch: TouchPoint | null
  lastTouch: TouchPoint | null
  landingPage: string | null
  referrer: string | null
  gclid: string | null
  selfHost: string | null
  /// For rate limiting. Hashed before it touches the database — see
  /// `submitterHash` — so the raw address never lands anywhere.
  ip: string | null
}

export type CaptureResult =
  | { ok: true; leadId: string; deduplicated: boolean }
  | { ok: false; field: string; problem: string }
  /// Silently accepted and thrown away. Returned distinctly so the route can
  /// answer with the same success page a real submission gets — telling a bot
  /// it was detected is how it learns to try again differently.
  | { ok: false; field: 'silent'; problem: 'discarded' }

/// US-8 AC4: "honeypot + rate limiting; CAPTCHA only as escalation (protect
/// conversion rate)."
///
/// The ordering in that AC is the whole design. A CAPTCHA costs real
/// submissions from real people — a measurable share on mobile — and this form
/// sits at the top of the funnel, so it is the escalation and not the default.
const RATE_LIMIT_WINDOW_MS = 10 * 60_000
const RATE_LIMIT_MAX = 5

export async function captureLead(
  input: LeadFormInput,
  context: LeadContext,
  now: Date = new Date(),
): Promise<CaptureResult> {
  // Honeypot first, before any validation. A bot that filled it gets the same
  // shaped response as a success and nothing is written.
  if (input.honeypot?.trim()) {
    return { ok: false, field: 'silent', problem: 'discarded' }
  }

  const name = input.name.trim()
  if (!name) return { ok: false, field: 'name', problem: 'Tell us what to call you.' }

  const email = input.email.trim().toLowerCase()
  const phone = input.phone.trim()

  if (!email && !phone) {
    return { ok: false, field: 'email', problem: 'An email address or a phone number — we need one way to reply.' }
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, field: 'email', problem: 'Check the email address — it looks incomplete.' }
  }
  if (input.kind === 'callback' && phone.replace(/\D/g, '').length < 10) {
    // AC1 makes phone required for a callback, and the reason is in the word:
    // there is nothing to call back without it.
    return { ok: false, field: 'phone', problem: 'A phone number with at least 10 digits, so somebody can call you.' }
  }

  const submitterHash = hashSubmitter(context.ip)
  if (submitterHash && (await isRateLimited(submitterHash, now))) {
    return {
      ok: false,
      field: 'name',
      problem: 'That is a lot of enquiries from one place in a short time. Give it a few minutes, or call us.',
    }
  }

  const keys = dedupKeys({ email, phone })
  const [firstName, ...rest] = name.split(/\s+/)
  const lastName = rest.join(' ') || null

  // The attribution of THIS submission. Falls back to deriving from the
  // request when no cookie survived — a visitor with cookies blocked still gets
  // a channel rather than a null.
  const thisTouch: TouchPoint =
    context.lastTouch ?? {
      source: null,
      medium: null,
      campaign: null,
      landingPage: context.landingPage,
      channel: deriveChannel({
        gclid: context.gclid,
        referrer: context.referrer,
        selfHost: context.selfHost,
      }),
    }

  // FR-LEAD-1's dedup.
  const existing = keys.email || keys.phone
    ? await prisma.lead.findFirst({
        where: {
          facilityId: input.facilityId,
          OR: [
            ...(keys.email ? [{ email: keys.email }] : []),
            // Phone is stored as typed, so a digits-only comparison cannot be a
            // simple equality. `endsWith` on the last ten digits is the closest
            // an index-friendly query gets; the exact match is re-checked below.
            ...(keys.phone ? [{ phone: { contains: keys.phone.slice(-4) } }] : []),
          ],
        },
        orderBy: { createdAt: 'desc' },
        select: { id: true, createdAt: true, email: true, phone: true, status: true },
      })
    : null

  const matched =
    existing &&
    isWithinDedupWindow(existing.createdAt, now) &&
    // Re-checked properly: the `contains` above is a coarse index filter and
    // would otherwise match somebody whose number merely ends the same way.
    (
      (keys.email && existing.email === keys.email) ||
      (keys.phone && dedupKeys({ phone: existing.phone }).phone === keys.phone)
    )

  if (matched && existing) {
    await prisma.leadActivity.create({
      data: {
        leadId: existing.id,
        type: 'inquiry',
        body: describeSubmission(input),
        channel: thisTouch.channel,
      },
    })

    // Last touch moves; first touch never does. That is the entire point of
    // keeping both — the ad that closed them and the search that found them are
    // different spend, and overwriting the first would credit the last for
    // work it did not do.
    await prisma.lead.update({
      where: { id: existing.id },
      data: {
        lastTouchSource: thisTouch.source,
        lastTouchMedium: thisTouch.medium,
        lastTouchCampaign: thisTouch.campaign,
        lastTouchLandingPage: thisTouch.landingPage,
        // A repeat ask from somebody already marked lost is a live lead again.
        ...(existing.status === 'lost' ? { status: 'new', contactedAt: null } : {}),
      },
    })

    await emitLeadEvent(existing.id, input.facilityId, thisTouch.channel, true)
    return { ok: true, leadId: existing.id, deduplicated: true }
  }

  const firstTouch = context.firstTouch ?? thisTouch

  const lead = await prisma.lead.create({
    data: {
      facilityId: input.facilityId,
      unitTypeId: input.unitTypeId || null,
      firstName,
      lastName,
      email: email || null,
      phone: phone || null,
      message: describeSubmission(input),
      source: 'web',
      status: 'new',
      targetMoveInDate: input.moveInDate ?? null,
      channel: thisTouch.channel,
      firstTouchSource: firstTouch.source,
      firstTouchMedium: firstTouch.medium,
      firstTouchCampaign: firstTouch.campaign,
      firstTouchLandingPage: firstTouch.landingPage,
      lastTouchSource: thisTouch.source,
      lastTouchMedium: thisTouch.medium,
      lastTouchCampaign: thisTouch.campaign,
      lastTouchLandingPage: thisTouch.landingPage,
      referrer: context.referrer?.slice(0, 500) ?? null,
      gclid: context.gclid?.slice(0, 200) ?? null,
      landingPage: context.landingPage?.slice(0, 500) ?? null,
      submitterHash,
    },
  })

  await emitLeadEvent(lead.id, input.facilityId, thisTouch.channel, false)
  return { ok: true, leadId: lead.id, deduplicated: false }
}

function describeSubmission(input: LeadFormInput): string {
  const parts = [input.kind === 'callback' ? 'Asked for a callback.' : 'Asked for a quote.']
  if (input.note?.trim()) parts.push(input.note.trim())
  return parts.join(' ')
}

/// FR-LEAD-3: "webhook/event (`lead.created`) emitted for real-time
/// notification."
///
/// The event, not a direct email. The comms pipeline (B-030) already owns who
/// gets told and through which template, and a second notification path here
/// would be one the kill switch and the suppression list do not cover.
async function emitLeadEvent(
  leadId: string,
  facilityId: string,
  channel: string,
  repeat: boolean,
): Promise<void> {
  await emitEvent({
    name: 'lead.created',
    facilityId,
    entityType: 'Lead',
    entityId: leadId,
    payload: { channel, repeat },
  })
}

/// A keyed digest of the submitter's IP. Never the address itself.
///
/// Keyed with `AUTH_SECRET` because the IPv4 space is small enough to
/// enumerate against a plain SHA-256 — an unkeyed hash of an IP is an IP.
/// Returns null with no address or no secret, which disables the limit rather
/// than silently bucketing every visitor together under one constant hash.
export function hashSubmitter(ip: string | null | undefined): string | null {
  const secret = process.env.AUTH_SECRET
  if (!ip || !secret) return null
  return createHmac('sha256', secret).update(ip).digest('hex')
}

/// US-8 AC4's rate limit, per submitter.
///
/// Counted over `Lead` rows rather than a dedicated table: what is worth
/// limiting is leads created, the rows are already indexed by
/// (submitterHash, createdAt), and a bespoke counter would be a second thing to
/// prune. Generous on purpose — five in ten minutes is well above somebody
/// comparing three facilities and well below a script, and this form sits at
/// the top of the funnel where a false positive costs a real customer.
async function isRateLimited(submitterHash: string, now: Date): Promise<boolean> {
  const recent = await prisma.lead.count({
    where: {
      submitterHash,
      createdAt: { gte: new Date(now.getTime() - RATE_LIMIT_WINDOW_MS) },
    },
  })
  return recent >= RATE_LIMIT_MAX
}
