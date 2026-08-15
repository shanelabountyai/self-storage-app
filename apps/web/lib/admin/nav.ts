import type { PermissionKey } from '@storage/db/rbac-catalog'
import type { Actor } from '@/lib/rbac/actor'
import { hasPermissionAnywhere } from '@/lib/rbac/authorize'

// Left nav catalog, per PRD 02 FR-2. Every item beyond Dashboard is a
// placeholder route until its own backlog item builds the real screen — see
// app/admin/[section]/page.tsx.
export type NavGroup = 'today' | 'property' | 'money' | 'admin'

export type NavItem = {
  key: string
  label: string
  href: string
  /// B-116 (UX review 2026-08-12, findings 11/16). Twenty destinations in one
  /// undifferentiated column read as an org chart of the codebase, and became
  /// a horizontal scroll strip on a phone with no sign there was more to the
  /// right — Walkthrough and Tasks, the two screens meant to be used
  /// phone-in-hand on the property, landed at positions 9 and 14. Grouped
  /// here rather than in a second list, so the group can never drift out of
  /// sync with the item it names.
  group: NavGroup
  /// Visible if the actor holds ANY of these. Omit for "every signed-in staff
  /// member". A few items lean on the nearest existing permission because the
  /// catalog has no dedicated one yet (noted per item) — tighten later rather
  /// than blocking the shell on new permissions.
  anyOf?: readonly PermissionKey[]
}

export const NAV_GROUP_LABELS: Record<NavGroup, string> = {
  today: 'Today',
  property: 'Property',
  money: 'Money & tenants',
  admin: 'Admin',
}
export const NAV_GROUP_ORDER: readonly NavGroup[] = ['today', 'property', 'money', 'admin']

export const NAV_ITEMS: readonly NavItem[] = [
  { key: 'dashboard', label: 'Dashboard', href: '/admin', group: 'today' },
  // No Task entity yet (B-060) — gated the same as Tenants for now.
  { key: 'tasks', label: 'Tasks', href: '/admin/tasks', group: 'today', anyOf: ['tenants:view'] },
  { key: 'leads', label: 'Inquiries', href: '/admin/leads', group: 'today', anyOf: ['tenants:view'] },
  { key: 'units', label: 'Units', href: '/admin/units', group: 'property', anyOf: ['units:edit'] },
  { key: 'walkthrough', label: 'Walkthrough', href: '/admin/walkthrough', group: 'property', anyOf: ['units:edit'] },
  { key: 'maintenance', label: 'Maintenance', href: '/admin/maintenance', group: 'property', anyOf: ['units:edit'] },
  { key: 'overlocks', label: 'Overlocks', href: '/admin/overlocks', group: 'property', anyOf: ['delinquency:execute_step'] },
  { key: 'access', label: 'Gate Activity', href: '/admin/access', group: 'property', anyOf: ['access:events'] },
  { key: 'keypad-queue', label: 'Keypad Queue', href: '/admin/access/queue', group: 'property', anyOf: ['tenants:view'] },
  // PRD 03 §8 Phase 2 (B-080). Where a quiet webhook feed or a dead-lettered
  // command becomes visible before a tenant phones about it.
  { key: 'gate-health', label: 'Gate Health', href: '/admin/access/health', group: 'property', anyOf: ['access:events'] },
  { key: 'tenants', label: 'Tenants', href: '/admin/tenants', group: 'money', anyOf: ['tenants:view'] },
  { key: 'billing', label: 'Billing', href: '/admin/billing', group: 'money', anyOf: ['payments:take', 'reports:financial'] },
  { key: 'pos', label: 'POS / Drawer', href: '/admin/pos', group: 'money', anyOf: ['payments:take'] },
  { key: 'delinquency', label: 'Delinquency', href: '/admin/delinquency', group: 'money', anyOf: ['delinquency:execute_step'] },
  // B-076 / PRD 02 US-11. The rate-increase review screen. Gated on the
  // permission that schedules them; the regional-rank check that governs
  // APPROVAL lives in the service, since a site manager may legitimately
  // build a worklist they cannot sign off.
  { key: 'rate-increases', label: 'Rate Increases', href: '/admin/rate-increases', group: 'money', anyOf: ['rates:tenant_increase'] },
  { key: 'auctions', label: 'Auctions', href: '/admin/auctions', group: 'money', anyOf: ['auctions:approve'] },
  { key: 'reports', label: 'Reports', href: '/admin/reports', group: 'money', anyOf: ['reports:operational', 'reports:financial', 'reports:rollup'] },
  { key: 'settings', label: 'Settings', href: '/admin/settings', group: 'admin', anyOf: ['facility:settings'] },
  // 'leases' and 'audit-log' are DELETED, not hidden — both resolved only to
  // the "built in a later backlog item" placeholder, and a nav promising two
  // destinations it does not have reads as unfinished to the person being
  // asked to trust it with rent. Leases are already reachable from the tenant
  // profile. Re-add either the day its own screen ships, not before.
] as const

export function visibleNavItems(actor: Actor): NavItem[] {
  return NAV_ITEMS.filter((item) => !item.anyOf || hasPermissionAnywhere(actor, item.anyOf))
}

export type VisibleNavGroup = { key: NavGroup; label: string; items: NavItem[] }

/// The same visibility rule as `visibleNavItems`, grouped and in display
/// order, with an empty group dropped rather than rendered as a bare heading.
export function groupedNavItems(actor: Actor): VisibleNavGroup[] {
  const visible = visibleNavItems(actor)
  return NAV_GROUP_ORDER.map((key) => ({
    key,
    label: NAV_GROUP_LABELS[key],
    items: visible.filter((item) => item.group === key),
  })).filter((group) => group.items.length > 0)
}

export function navItemForSection(section: string): NavItem | undefined {
  return NAV_ITEMS.find((item) => item.href === `/admin/${section}`)
}
