import { prisma } from '@storage/db'
import { recordAudit } from '@storage/core/audit'
import { recordConsent } from '@storage/core/consent'
import { normalizePhoneE164 } from '@storage/core/comms'
import { systemActor } from '@/lib/rbac/actor'
import { toAuditActor } from '@/lib/rbac/audit-actor'
import { suppress } from './service'

// PRD 05 CN-13/CN-14 (B-074). The two things "an SMS number opted out/back in"
// actually means, shared by the two places that can trigger it: the inbound
// Twilio webhook (STOP/START keywords) and the tenant's own portal button
// (CN-13 AC2: "revoking SMS in the portal has the same effect as STOP").
// One function per direction, called from both, so the two entry points can
// never drift into doing slightly different things for the same event.

/// Best-effort tenant match by phone. `Tenant.phone` has no unique
/// constraint and is stored however checkout's loose validation left it
/// (`apps/web/lib/checkout/details.ts`) — dashes, spaces, or none — so this
/// matches on the last 10 digits rather than an exact string. Suppression
/// itself does NOT depend on finding a match (it is address-keyed, not
/// tenant-keyed); this is only for the Consent row, which needs an owner.
async function findTenantByPhone(e164: string): Promise<{ id: string } | null> {
  const last10 = e164.slice(-10)
  return prisma.tenant.findFirst({
    where: { phone: { endsWith: last10 } },
    select: { id: true },
  })
}

/// CN-14 AC: "HELP returns identification + support contact." The only
/// identity this inbound webhook has to go on is the FROM number, so this is
/// best-effort: the tenant matched by phone, their most recent lease, that
/// lease's facility. No match (a prospect who never rented, or two tenants
/// sharing a household number) falls back to no specific contact rather than
/// guessing — the caller's generic identification line still satisfies the
/// AC, just without a facility-specific phone number.
export async function facilityContactForPhone(
  rawPhone: string,
): Promise<{ facilityName: string; facilityPhone: string | null } | null> {
  const phone = normalizePhoneE164(rawPhone)
  if (!phone) return null
  const tenant = await findTenantByPhone(phone)
  if (!tenant) return null

  const lease = await prisma.lease.findFirst({
    where: { tenantId: tenant.id, status: { not: 'ended' } },
    orderBy: { startDate: 'desc' },
    select: { facility: { select: { name: true, phone: true } } },
  })
  return lease ? { facilityName: lease.facility.name, facilityPhone: lease.facility.phone } : null
}

export type SmsStopResult = { suppressed: boolean; tenantMatched: boolean }

/// CN-14 AC: suppress ALL SMS to this number (transactional included), audit
/// it, and record the consent revocation if the number is traceable to a
/// tenant. `suppress()` is an idempotent upsert — a duplicate STOP (a portal
/// click after an inbound STOP, or vice versa) changes nothing.
export async function applySmsStop(input: {
  rawPhone: string
  source: 'sms_stop_keyword' | 'portal_revoke'
  /// The portal caller already knows which tenant is asking — pass it rather
  /// than falling back to the same best-effort phone match the inbound
  /// webhook needs (it has nothing else to go on). Skips `findTenantByPhone`
  /// entirely when given, so a phone stored oddly enough to miss the
  /// last-10-digits match still gets its consent revoked correctly.
  tenantId?: string
}): Promise<SmsStopResult> {
  const phone = normalizePhoneE164(input.rawPhone)
  if (!phone) return { suppressed: false, tenantMatched: false }

  const tenant = input.tenantId ? { id: input.tenantId } : await findTenantByPhone(phone)

  await prisma.$transaction(async (tx) => {
    await suppress({ channel: 'sms', address: phone, reason: 'stop', note: input.source }, tx)
    await recordAudit(
      {
        actor: toAuditActor(systemActor(input.source)),
        action: 'suppression.added',
        entityType: 'Suppression',
        entityId: `sms:${phone}`,
        context: { channel: 'sms', reason: 'stop', source: input.source },
      },
      tx,
    )
    if (tenant) {
      await recordConsent(
        { tenantId: tenant.id, channel: 'account_sms', state: 'revoked', source: input.source },
        tx,
      )
    }
  })

  return { suppressed: true, tenantMatched: Boolean(tenant) }
}

export type SmsStartResult = { lifted: boolean; tenantMatched: boolean }

/// CN-14 AC: "START/UNSTOP re-enables with logged re-consent." Deliberately
/// its OWN path rather than `removeSuppression` (CN-20's admin lift) — that
/// function refuses `stop` entries outright, on purpose, because a STAFFER
/// overriding a tenant's own instruction is not a call an admin screen should
/// be able to make. The tenant re-texting START is a different act: it is
/// their own instruction changing, the same authority that set it in the
/// first place, so this bypasses that refusal deliberately rather than
/// working around it.
export async function applySmsStart(input: { rawPhone: string }): Promise<SmsStartResult> {
  const phone = normalizePhoneE164(input.rawPhone)
  if (!phone) return { lifted: false, tenantMatched: false }

  const existing = await prisma.suppression.findUnique({
    where: { channel_address: { channel: 'sms', address: phone } },
  })
  if (!existing || existing.reason !== 'stop') return { lifted: false, tenantMatched: false }

  const tenant = await findTenantByPhone(phone)

  await prisma.$transaction(async (tx) => {
    await tx.suppression.delete({ where: { id: existing.id } })
    await recordAudit(
      {
        actor: toAuditActor(systemActor('sms_start_keyword')),
        action: 'suppression.removed',
        entityType: 'Suppression',
        entityId: `sms:${phone}`,
        reasonCode: 'inbound_start_keyword',
        before: { reason: existing.reason, note: existing.note, createdAt: existing.createdAt.toISOString() },
        context: { channel: 'sms' },
      },
      tx,
    )
    if (tenant) {
      await recordConsent(
        { tenantId: tenant.id, channel: 'account_sms', state: 'granted', source: 'sms_start_keyword' },
        tx,
      )
    }
  })

  return { lifted: true, tenantMatched: Boolean(tenant) }
}
