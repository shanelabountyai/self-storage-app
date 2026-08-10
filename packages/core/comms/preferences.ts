// PRD 05 CN-13 (B-074). The tenant preference center's default state.
//
// `NotificationPreference` only stores a row for what a tenant has explicitly
// CHANGED — seeding six rows (3 categories x 2 channels) for every tenant on
// signup would mean a schema change is also a data migration forever after.
// This is the one place "what applies when there is no row" is decided, so
// the send-time gate and the portal's own display can never disagree about it.

export type NotificationCategoryKey = 'payment_reminders' | 'receipts' | 'operational_notices'
export type NotificationChannelKey = 'email' | 'sms'

/// True unless explicitly overridden — EXCEPT receipts-by-SMS, which CN-6 /
/// D-11a default OFF ("SMS receipt only if tenant opted into SMS receipts").
export function defaultNotificationPreference(
  category: NotificationCategoryKey,
  channel: NotificationChannelKey,
): boolean {
  return !(category === 'receipts' && channel === 'sms')
}
