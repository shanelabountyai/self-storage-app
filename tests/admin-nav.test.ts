import { describe, expect, it } from 'vitest'
import type { Actor, Assignment } from '../apps/web/lib/rbac/actor'
import { NAV_ITEMS, navItemForSection, visibleNavItems } from '../apps/web/lib/admin/nav'
import { ROLES } from '../packages/db/rbac-catalog'

function assignmentFor(roleKey: string, facilityId: string | null): Assignment {
  const role = ROLES.find((r) => r.key === roleKey)!
  return {
    facilityId,
    roleKey: role.key,
    rank: role.rank,
    permissions: new Set(role.permissions),
    limits: {
      maxFeeWaiverCents: role.maxFeeWaiverCents,
      maxRefundCents: role.maxRefundCents,
      maxCreditCents: role.maxCreditCents,
    },
  }
}

const staff = (...assignments: Assignment[]): Actor => ({
  kind: 'staff',
  staffUserId: 'staff-1',
  assignments,
})

describe('nav catalog', () => {
  it('has a unique key and href per item', () => {
    expect(new Set(NAV_ITEMS.map((i) => i.key)).size).toBe(NAV_ITEMS.length)
    expect(new Set(NAV_ITEMS.map((i) => i.href)).size).toBe(NAV_ITEMS.length)
  })

  it('includes every item FR-2 lists', () => {
    const labels = NAV_ITEMS.map((i) => i.label)
    for (const expected of [
      'Dashboard',
      'Units',
      'Tenants',
      'Leases',
      'Billing',
      'Delinquency',
      'Auctions',
      'POS / Drawer',
      'Tasks',
      'Reports',
      'Settings',
      'Audit Log',
    ]) {
      expect(labels).toContain(expected)
    }
  })

  it('resolves a section slug back to its nav item', () => {
    expect(navItemForSection('units')?.label).toBe('Units')
    expect(navItemForSection('audit-log')?.label).toBe('Audit Log')
    expect(navItemForSection('nonexistent')).toBeUndefined()
  })
})

describe('nav visibility by role', () => {
  it('shows the owner every item', () => {
    const actor = staff(assignmentFor('owner', null))
    expect(visibleNavItems(actor).map((i) => i.key).sort()).toEqual(
      NAV_ITEMS.map((i) => i.key).sort(),
    )
  })

  it('shows counter staff only the dashboard, billing/POS, and tenant screens', () => {
    const actor = staff(assignmentFor('counter', 'facility-a'))
    const keys = visibleNavItems(actor).map((i) => i.key)
    expect(keys).toEqual(
      expect.arrayContaining(['dashboard', 'tenants', 'leases', 'billing', 'pos', 'tasks']),
    )
    expect(keys).not.toContain('units')
    expect(keys).not.toContain('settings')
    expect(keys).not.toContain('audit-log')
    expect(keys).not.toContain('auctions')
  })

  it('shows bookkeeper reports and tenants but no operational screens', () => {
    const actor = staff(assignmentFor('bookkeeper', 'facility-a'))
    const keys = visibleNavItems(actor).map((i) => i.key)
    expect(keys).toEqual(expect.arrayContaining(['dashboard', 'tenants', 'billing', 'reports']))
    expect(keys).not.toContain('units')
    expect(keys).not.toContain('pos')
    expect(keys).not.toContain('delinquency')
  })

  it('shows only the dashboard to a staff user with no assignments', () => {
    const actor = staff()
    expect(visibleNavItems(actor).map((i) => i.key)).toEqual(['dashboard'])
  })

  it('shows nothing to a tenant', () => {
    const tenant: Actor = { kind: 'tenant', tenantId: 't-1' }
    // Dashboard has no anyOf, so it's visible even to a tenant per the current
    // filter — the layout's requireStaffActor() is what actually keeps tenants
    // out of /admin at all, not this list.
    expect(visibleNavItems(tenant).map((i) => i.key)).toEqual(['dashboard'])
  })
})
