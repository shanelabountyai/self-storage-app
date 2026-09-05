import { prisma, type ConsentState } from '@storage/db'
import { currentConsent, recordConsent } from '@storage/core/consent'
import {
  defaultNotificationPreference,
  type NotificationCategoryKey,
  type NotificationChannelKey,
} from '@storage/core/comms'
import { applySmsStop } from '@/lib/comms/sms-consent'
import type { MessageKey } from '@/lib/i18n'

// PRD 05 CN-13 (B-074). The tenant preference center's own read/write side —
// thin, since the storage and default rules live in
// `NotificationPreference`/`defaultNotificationPreference` already.

export const NOTIFICATION_CATEGORIES: readonly {
  key: NotificationCategoryKey
  /// B-260 (D-122): keys, not words. The label is also the accessible name of
  /// two checkboxes per row, so a mismatch between the visible category and the
  /// spoken one is a 2.5.3 failure — one entry per concept keeps them the same
  /// string in either language.
  labelKey: MessageKey
  descriptionKey: MessageKey
}[] = [
  {
    key: 'payment_reminders',
    labelKey: 'notif.cat.payment_reminders',
    descriptionKey: 'notif.cat.payment_reminders.desc',
  },
  { key: 'receipts', labelKey: 'notif.cat.receipts', descriptionKey: 'notif.cat.receipts.desc' },
  {
    key: 'operational_notices',
    labelKey: 'notif.cat.operational_notices',
    descriptionKey: 'notif.cat.operational_notices.desc',
  },
]

export type PreferenceGrid = Record<NotificationCategoryKey, Record<NotificationChannelKey, boolean>>

export async function currentPreferences(tenantId: string): Promise<PreferenceGrid> {
  const rows = await prisma.notificationPreference.findMany({ where: { tenantId } })
  const byKey = new Map(rows.map((row) => [`${row.category}:${row.channel}`, row.enabled]))

  const grid = {} as PreferenceGrid
  for (const { key: category } of NOTIFICATION_CATEGORIES) {
    grid[category] = {
      email: byKey.get(`${category}:email`) ?? defaultNotificationPreference(category, 'email'),
      sms: byKey.get(`${category}:sms`) ?? defaultNotificationPreference(category, 'sms'),
    }
  }
  return grid
}

export async function setPreference(
  tenantId: string,
  category: NotificationCategoryKey,
  channel: NotificationChannelKey,
  enabled: boolean,
): Promise<void> {
  await prisma.notificationPreference.upsert({
    where: { tenantId_category_channel: { tenantId, category, channel } },
    create: { tenantId, category, channel, enabled },
    update: { enabled },
  })
}

export type SmsConsentView = {
  state: ConsentState | null
  capturedAt: Date | null
  disclosureVersion: string | null
  source: string | null
}

/// CN-13 AC: "SMS consent state (granted/revoked, timestamp, disclosure
/// version, capture source) is displayed read-only." Read from the newest
/// row of that channel directly rather than through `currentConsent` alone —
/// that returns only the state, and the portal needs the whole row.
///
/// B-123 made the channel a parameter rather than copying the function: the
/// marketing text lane needs exactly the same four facts displayed, and two
/// near-identical readers are how the two lanes come to show different things
/// about the same kind of record.
export async function smsConsentView(
  tenantId: string,
  channel: 'account_sms' | 'marketing_sms' = 'account_sms',
): Promise<SmsConsentView> {
  const [state, row] = await Promise.all([
    currentConsent({ tenantId }, channel),
    prisma.consent.findFirst({
      where: { tenantId, channel },
      orderBy: { capturedAt: 'desc' },
      select: { capturedAt: true, disclosureVersion: true, source: true },
    }),
  ])
  return {
    state,
    capturedAt: row?.capturedAt ?? null,
    disclosureVersion: row?.disclosureVersion ?? null,
    source: row?.source ?? null,
  }
}

/// D-51 (B-123). The tenant's own switch for MARKETING texts.
///
/// Consent-only, and deliberately NOT `applySmsStop`. Revoking here must not
/// touch the suppression list, because that list is address-keyed and global:
/// a STOP silences every SMS to that number including payment reminders and
/// gate codes, which is the right answer to "stop texting me" and the wrong
/// answer to "stop texting me about sales". A tenant turning marketing off
/// keeps their gate code.
///
/// Granting from here is a real opt-in and is stamped with the disclosure
/// version the portal showed, the same as the checkout capture — a consent row
/// with no version is one nobody can later prove the wording of.
export async function setMarketingSmsConsent(
  tenantId: string,
  granted: boolean,
  disclosureVersion: string,
): Promise<void> {
  await recordConsent({
    tenantId,
    channel: 'marketing_sms',
    state: granted ? 'granted' : 'revoked',
    source: 'portal_preferences',
    disclosureVersion,
  })
}

export type RevokeSmsResult = { revoked: boolean }

/// CN-13 AC2: "revoking SMS in the portal has the same effect as STOP."
/// Literally the same function the inbound STOP keyword calls — see
/// `sms-consent.ts` for why that is one function, not two that could drift.
export async function revokeSmsFromPortal(tenantId: string): Promise<RevokeSmsResult> {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { phone: true } })
  if (!tenant?.phone) return { revoked: false }
  const result = await applySmsStop({ rawPhone: tenant.phone, source: 'portal_revoke', tenantId })
  return { revoked: result.suppressed }
}
