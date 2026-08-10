import { prisma } from '@storage/db'
import type { Consent, ConsentChannel, ConsentState, Prisma } from '@storage/db'

// D-8. The shared consent table — neither PRD 04 (marketing) nor PRD 05
// (SMS/notice consent) owns it; both read and write through this one function.

export type RecordConsentInput = {
  tenantId?: string | null
  leadId?: string | null
  channel: ConsentChannel
  state: ConsentState
  /// Where the opt-in (or decline) happened, e.g. "checkout_step_1".
  source: string
  disclosureVersion?: string | null
  ipAddress?: string | null
}

/// Records one consent event. Append-only in practice — never call this to
/// "update" an existing row; a later grant or revoke is a new row with a later
/// `capturedAt`, so the full history a dispute or an audit needs to read stays
/// intact rather than being overwritten by whatever is currently true.
export async function recordConsent(
  input: RecordConsentInput,
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<Consent> {
  if (!input.tenantId && !input.leadId) {
    throw new Error('recordConsent requires a tenantId or a leadId')
  }
  return client.consent.create({
    data: {
      tenantId: input.tenantId ?? null,
      leadId: input.leadId ?? null,
      channel: input.channel,
      state: input.state,
      source: input.source,
      disclosureVersion: input.disclosureVersion ?? null,
      ipAddress: input.ipAddress ?? null,
    },
  })
}

/// The owner's current state for one channel, or null if they have never been
/// asked.
///
/// `recordConsent` is append-only, so "current" means the newest row — read
/// here, once, rather than by each caller writing its own `orderBy`. The
/// distinction between `null` and `revoked` is load-bearing for notice
/// delivery (B-061) and the lead drip (B-072) alike: never asked and said-no
/// need different things from whoever is deciding whether to ask again, and
/// collapsing them into a boolean loses that.
///
/// Takes a tenant OR a lead — the same either/or `recordConsent` accepts —
/// because a lead has no tenant id to read consent by, and this is the read
/// half of the same table.
export async function currentConsent(
  owner: { tenantId: string } | { leadId: string },
  channel: ConsentChannel,
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<ConsentState | null> {
  const latest = await client.consent.findFirst({
    where: { ...owner, channel },
    orderBy: [{ capturedAt: 'desc' }, { createdAt: 'desc' }],
    select: { state: true },
  })
  return latest?.state ?? null
}
