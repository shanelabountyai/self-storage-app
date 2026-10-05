import { prisma } from '@storage/db'
import { PAYER_NOMINATION_CONSENT } from '@/lib/consent/disclosures'
import type { Locale, MessageKey } from '@/lib/i18n'

// PRD 01 US-703 "someone else can pay" (B-437). The one person a tenant has
// asked us to send the bill to. Every write to `NominatedPayer` is here; the
// send path (`resolveRecipients` in lib/comms/service.ts) only reads.
//
// A payer who is removed or who stops loses their live pay links in the same
// transaction: a link already sitting in an inbox must not keep opening the
// tenant's balance for somebody the tenant has taken off.

export type NominatedPayerView = {
  id: string
  name: string
  email: string
  phone: string | null
  consentedAt: Date
  /// The payer's own stop. The row stays the tenant's current payer so the
  /// portal can say the bill is no longer reaching them.
  stoppedAt: Date | null
}

/// The tenant's current payer, stopped or not. Null once removed.
export async function nominatedPayerFor(tenantId: string): Promise<NominatedPayerView | null> {
  return prisma.nominatedPayer.findFirst({
    where: { tenantId, removedAt: null },
    orderBy: { createdAt: 'desc' },
    select: { id: true, name: true, email: true, phone: true, consentedAt: true, stoppedAt: true },
  })
}

export type NominateInput = {
  name: string
  email: string
  phone: string
  /// The consent box. Unticked is a refusal, never a default.
  consent: boolean
  /// The language the consent sentence was shown in.
  locale: Locale
}

export type NominateResult =
  | { ok: true; payer: NominatedPayerView }
  | { ok: false; problems: Partial<Record<'name' | 'email' | 'phone' | 'consent', MessageKey>> }

/// Names a payer, replacing any the tenant already had (one at a time).
export async function nominatePayer(tenantId: string, input: NominateInput): Promise<NominateResult> {
  const name = input.name.trim()
  const email = input.email.trim().toLowerCase()
  const phone = input.phone.trim() || null

  const problems: Extract<NominateResult, { ok: false }>['problems'] = {}
  if (!name) problems.name = 'payer.problem.name'
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) problems.email = 'payer.problem.email'
  // Loose on purpose, as on the contact form: it is a number to call.
  if (phone && phone.replace(/\D/g, '').length < 10) problems.phone = 'payer.problem.phone'
  if (!input.consent) problems.consent = 'payer.problem.consent'
  if (Object.keys(problems).length > 0) return { ok: false, problems }

  const payer = await prisma.$transaction(async (tx) => {
    await removeWithin(tx, tenantId)
    return tx.nominatedPayer.create({
      data: {
        tenantId,
        name,
        email,
        phone,
        disclosureVersion: PAYER_NOMINATION_CONSENT[input.locale].version,
        locale: input.locale,
      },
      select: { id: true, name: true, email: true, phone: true, consentedAt: true, stoppedAt: true },
    })
  })
  return { ok: true, payer }
}

/// The tenant takes their payer off. True when there was one.
export async function removeNominatedPayer(tenantId: string): Promise<boolean> {
  return prisma.$transaction((tx) => removeWithin(tx, tenantId))
}

/// The payer's own stop, from the link in every message they are sent. Safe to
/// repeat, and silent about a payer who is already gone: the page it answers
/// says "stopped" either way, which is true either way.
export async function stopNominatedPayer(payerId: string): Promise<void> {
  const now = new Date()
  await prisma.$transaction([
    prisma.nominatedPayer.updateMany({
      where: { id: payerId, stoppedAt: null, removedAt: null },
      data: { stoppedAt: now },
    }),
    prisma.payLink.updateMany({
      where: { nominatedPayerId: payerId, revokedAt: null },
      data: { revokedAt: now },
    }),
  ])
}

async function removeWithin(
  tx: Pick<typeof prisma, 'nominatedPayer' | 'payLink'>,
  tenantId: string,
): Promise<boolean> {
  const now = new Date()
  await tx.payLink.updateMany({
    where: { tenantId, nominatedPayerId: { not: null }, revokedAt: null },
    data: { revokedAt: now },
  })
  const removed = await tx.nominatedPayer.updateMany({
    where: { tenantId, removedAt: null },
    data: { removedAt: now },
  })
  return removed.count > 0
}
