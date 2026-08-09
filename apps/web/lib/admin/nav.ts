import type { PermissionKey } from '@storage/db/rbac-catalog'
import type { Actor } from '@/lib/rbac/actor'
import { hasPermissionAnywhere } from '@/lib/rbac/authorize'

// Left nav catalog, per PRD 02 FR-2. Every item beyond Dashboard is a
// placeholder route until its own backlog item builds the real screen — see
// app/admin/[section]/page.tsx.
export type NavItem = {
  key: string
  label: string
  href: string
  /// Visible if the actor holds ANY of these. Omit for "every signed-in staff
  /// member". A few items lean on the nearest existing permission because the
  /// catalog has no dedicated one yet (noted per item) — tighten later rather
  /// than blocking the shell on new permissions.
  anyOf?: readonly PermissionKey[]
}

export const NAV_ITEMS: readonly NavItem[] = [
  { key: 'dashboard', label: 'Dashboard', href: '/admin' },
  { key: 'units', label: 'Units', href: '/admin/units', anyOf: ['units:edit'] },
  { key: 'tenants', label: 'Tenants', href: '/admin/tenants', anyOf: ['tenants:view'] },
  { key: 'leads', label: 'Inquiries', href: '/admin/leads', anyOf: ['tenants:view'] },
  // No dedicated lease permission — leases are part of tenant management.
  { key: 'leases', label: 'Leases', href: '/admin/leases', anyOf: ['tenants:view'] },
  { key: 'billing', label: 'Billing', href: '/admin/billing', anyOf: ['payments:take', 'reports:financial'] },
  { key: 'delinquency', label: 'Delinquency', href: '/admin/delinquency', anyOf: ['delinquency:execute_step'] },
  { key: 'auctions', label: 'Auctions', href: '/admin/auctions', anyOf: ['auctions:approve'] },
  { key: 'pos', label: 'POS / Drawer', href: '/admin/pos', anyOf: ['payments:take'] },
  // No Task entity yet (B-060) — gated the same as Tenants for now.
  { key: 'tasks', label: 'Tasks', href: '/admin/tasks', anyOf: ['tenants:view'] },
  { key: 'access', label: 'Gate Activity', href: '/admin/access', anyOf: ['access:events'] },
  { key: 'keypad-queue', label: 'Keypad Queue', href: '/admin/access/queue', anyOf: ['tenants:view'] },
  { key: 'reports', label: 'Reports', href: '/admin/reports', anyOf: ['reports:operational', 'reports:financial', 'reports:rollup'] },
  { key: 'settings', label: 'Settings', href: '/admin/settings', anyOf: ['facility:settings'] },
  { key: 'audit-log', label: 'Audit Log', href: '/admin/audit-log', anyOf: ['audit:view'] },
] as const

export function visibleNavItems(actor: Actor): NavItem[] {
  return NAV_ITEMS.filter((item) => !item.anyOf || hasPermissionAnywhere(actor, item.anyOf))
}

export function navItemForSection(section: string): NavItem | undefined {
  return NAV_ITEMS.find((item) => item.href === `/admin/${section}`)
}
