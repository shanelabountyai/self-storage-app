import { createHash, randomBytes } from 'node:crypto'
import { prisma, type Prisma } from '@storage/db'
import { OCCUPYING_LEASE_STATUSES } from '@storage/core/inventory'

// PRD 05 CN-4 / FR-12, FR-13 (B-051). The one-tap way to pay from a reminder.
//
// ── The security shape, and why it is not a portal session ───────────────────
//
// CN-4 asks for a link that "authenticates me into the tenant portal's payment
// screen ... without a password". What it must NOT do is hand someone a portal
// session: `/portal/*` shows gate codes (PRD 03 SR-2), lets a tenant change
// their address of record, and lets them detach the card autopay runs on. A
// link forwarded to a colleague, sitting in a shared inbox, or read off a
// shoulder must not reach any of that.
//
// So a pay link is deliberately NOT a session at all. It grants exactly one
// screen — `/pay/<token>` — for exactly one lease, and nothing else in the
// application knows the token exists. Every other route treats the visitor as
// anonymous, which is fail-closed by construction rather than by each page
// remembering to check a scope. The cost is that the pay screen is its own
// route rather than the portal's, which is a deviation from CN-4's literal
// wording and the reason for it is written here.
//
// Second-order consequences that fall out of the same choice, and are the point
// rather than an accident: the screen shows no gate code, no other unit, no
// contact details, and no way to remove a payment method.

/// CN-4: "Link expiry configurable (default 7 days)."
///
/// Long by the standards of the 15-minute magic link, and it has to be: this
/// arrives in an email a tenant may open on Saturday about a bill due Monday.
/// It is safe to be long precisely because the link is not a session — the
/// worst a stale one does is show a balance and offer to pay it.
export const PAY_LINK_TTL_DAYS = 7

/// 256 bits, URL-safe. Well above CN-4's ≥128-bit floor.
function generateToken(): string {
  return randomBytes(32).toString('base64url')
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function payLinkUrl(token: string, origin: string): string {
  return `${origin.replace(/\/$/, '')}/pay/${token}`
}

/// Mints a pay link for a lease, or reuses the one already minted for this
/// event.
///
/// Reuse is per EVENT, not per lease: one event can fire several notification
/// rules, and those are the same message from the tenant's point of view, so
/// they should carry the same link. Two different events — a due-soon reminder
/// and a decline notice — get different links, because CN-4 wants a payment
/// attributed to the message that prompted it, and a shared link could not say
/// which.
export async function mintPayLink(input: {
  tenantId: string
  leaseId: string
  eventId?: string | null
  ttlDays?: number
}): Promise<{ token: string; expiresAt: Date } | null> {
  if (input.eventId) {
    const existing = await prisma.payLink.findFirst({
      where: { eventId: input.eventId, leaseId: input.leaseId, revokedAt: null },
      select: { id: true },
    })
    // The plaintext is unrecoverable by design, so a reused event has to mint a
    // fresh row rather than re-render the old link. Revoke the old one so a
    // re-render cannot leave two live links for one message.
    if (existing) {
      await prisma.payLink.update({
        where: { id: existing.id },
        data: { revokedAt: new Date() },
      })
    }
  }

  const token = generateToken()
  const expiresAt = new Date(Date.now() + (input.ttlDays ?? PAY_LINK_TTL_DAYS) * 86_400_000)

  await prisma.payLink.create({
    data: {
      tokenHash: hashToken(token),
      tenantId: input.tenantId,
      leaseId: input.leaseId,
      eventId: input.eventId ?? null,
      expiresAt,
    },
  })

  return { token, expiresAt }
}

export type PayLinkCheck =
  | { ok: true; payLinkId: string; tenantId: string; leaseId: string }
  /// One reason for every failure mode, deliberately. An expired link, a
  /// revoked one and a token that never existed are indistinguishable from
  /// outside — there is nothing to enumerate and no reason to help someone try.
  | { ok: false }

/// Verifies a token and records the click.
///
/// Does NOT burn the token: CN-4 wants the balance "as of page load, not as of
/// send", which means the link is revisitable for its whole life. A tenant who
/// opens it, gets distracted, and comes back an hour later must not find a dead
/// link — that is the failure this whole item exists to remove.
export async function checkPayLink(token: string): Promise<PayLinkCheck> {
  if (!token) return { ok: false }

  const link = await prisma.payLink.findUnique({
    where: { tokenHash: hashToken(token) },
    select: {
      id: true,
      tenantId: true,
      leaseId: true,
      expiresAt: true,
      revokedAt: true,
      firstClickedAt: true,
      lease: { select: { status: true } },
    },
  })
  if (!link) return { ok: false }
  if (link.revokedAt) return { ok: false }
  if (link.expiresAt.getTime() <= Date.now()) return { ok: false }
  // Belt and braces alongside revocation on move-out: a lease that has ended
  // has no balance this screen should collect against, and relying on the
  // revocation sweep alone would leave a window.
  if (!OCCUPYING_LEASE_STATUSES.includes(link.lease.status as never)) return { ok: false }

  await prisma.payLink.update({
    where: { id: link.id },
    data: {
      clickCount: { increment: 1 },
      lastClickedAt: new Date(),
      // Only the first, so the funnel figure is "links that were opened at
      // all" rather than "times a page was refreshed".
      ...(link.firstClickedAt ? {} : { firstClickedAt: new Date() }),
    },
  })

  return { ok: true, payLinkId: link.id, tenantId: link.tenantId, leaseId: link.leaseId }
}

/// Attributes a payment to the link that produced it (CN-4, PRD 05 §7).
///
/// Called when the payment is raised rather than when it succeeds, so a payment
/// that ends up failing is still attributable — "the link produced an attempt"
/// and "the link produced money" are different questions and the report wants
/// both. `paymentId` is unique on the row, so a second attempt through the same
/// link overwrites rather than duplicating.
export async function attributePayment(payLinkId: string, paymentId: string): Promise<void> {
  await prisma.payLink.update({ where: { id: payLinkId }, data: { paymentId } })
}

/// CN-4: "revoked on move-out."
///
/// Takes an optional transaction client so the revocation commits with the
/// move-out itself — a lease that ended in a transaction that rolled back must
/// not have had its links killed.
export async function revokePayLinksForLease(
  leaseId: string,
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<number> {
  const result = await client.payLink.updateMany({
    where: { leaseId, revokedAt: null },
    data: { revokedAt: new Date() },
  })
  return result.count
}
