import { prisma, type ConsentState } from '@storage/db'
import { currentConsent } from '@storage/core/consent'
import {
  defaultNotificationPreference,
  type NotificationCategoryKey,
  type NotificationChannelKey,
} from '@storage/core/comms'
import { applySmsStop } from '@/lib/comms/sms-consent'

// PRD 05 CN-13 (B-074). The tenant preference center's own read/write side —
// thin, since the storage and default rules live in
// `NotificationPreference`/`defaultNotificationPreference` already.

export const NOTIFICATION_CATEGORIES: readonly {
  key: NotificationCategoryKey
  label: string
  description: string
}[] = [
  { key: 'payment_reminders', label: 'Payment reminders', description: 'Rent due soon, due today, a card that needs updating.' },
  { key: 'receipts', label: 'Receipts', description: 'A copy of what was charged, each time.' },
  { key: 'operational_notices', label: 'Operational notices', description: 'Gate access, unit locks, insurance proof.' },
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
/// `account_sms` row directly rather than through `currentConsent` alone —
/// that returns only the state, and the portal needs the whole row.
export async function smsConsentView(tenantId: string): Promise<SmsConsentView> {
  const [state, row] = await Promise.all([
    currentConsent({ tenantId }, 'account_sms'),
    prisma.consent.findFirst({
      where: { tenantId, channel: 'account_sms' },
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
