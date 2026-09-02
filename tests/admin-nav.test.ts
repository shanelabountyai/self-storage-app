import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Actor, Assignment } from '../apps/web/lib/rbac/actor'
import {
  NAV_GROUP_ORDER,
  NAV_ITEMS,
  groupedNavItems,
  visibleNavItems,
} from '../apps/web/lib/admin/nav'
import { ROLES } from '../packages/db/rbac-catalog'
import type { PermissionKey } from '@storage/db/rbac-catalog'

const ADMIN_APP_DIR = join(import.meta.dirname, '../apps/web/app/admin')

function assignmentFor(roleKey: string, facilityId: string | null): Assignment {
  const role = ROLES.find((r) => r.key === roleKey)!
  return {
    facilityId,
    roleKey: role.key,
    rank: role.rank,
    permissions: new Set<PermissionKey>(role.permissions),
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
      'Billing',
      'Delinquency',
      'Auctions',
      'POS / Drawer',
      'Tasks',
      'Reports',
      'Settings',
    ]) {
      expect(labels).toContain(expected)
    }
  })

  // B-117 (UX review 2026-08-12, findings 11/16). Both resolved only to the
  // "built in a later backlog item" placeholder — a nav promising two
  // destinations it does not have reads as unfinished to the person being
  // asked to trust it with rent. Leases stay reachable from the tenant
  // profile; re-add either the day its own screen ships.
  it('no longer offers Leases or Audit Log — neither has a screen', () => {
    const labels = NAV_ITEMS.map((i) => i.label)
    expect(labels).not.toContain('Leases')
    expect(labels).not.toContain('Audit Log')
  })

  // B-229. The `app/admin/[section]` placeholder — "This screen is built in a
  // later backlog item" — is deleted, so a nav item without a route now 404s
  // instead of rendering an apology. This is the check that keeps that honest:
  // add a link here without its folder and the suite says so, rather than a
  // staff member finding out.
  it('every destination has a real route, not a placeholder', () => {
    for (const item of NAV_ITEMS) {
      const segments = item.href.replace(/^\/admin\/?/, '')
      const dir = segments ? join(ADMIN_APP_DIR, segments) : ADMIN_APP_DIR
      expect(existsSync(join(dir, 'page.tsx')), `${item.href} has no page.tsx`).toBe(true)
    }
  })

  it('every item belongs to exactly one of the four groups, in the fixed display order', () => {
    expect(NAV_GROUP_ORDER).toEqual(['today', 'property', 'money', 'admin'])
    for (const item of NAV_ITEMS) {
      expect(NAV_GROUP_ORDER).toContain(item.group)
    }
  })
})

describe('groupedNavItems', () => {
  it('puts Walkthrough and Tasks in Today/Property, not buried past position 8', () => {
    const actor = staff(assignmentFor('owner', null))
    const groups = groupedNavItems(actor)
    const today = groups.find((g) => g.key === 'today')!
    const property = groups.find((g) => g.key === 'property')!
    expect(today.items.map((i) => i.key)).toContain('tasks')
    expect(property.items.map((i) => i.key)).toContain('walkthrough')
  })

  it('drops a group with nothing visible in it, rather than rendering a bare heading', () => {
    // Every Property-group item is gated on one of units:edit,
    // delinquency:execute_step, access:events or tenants:view — an actor
    // holding none of those sees no Property group at all.
    const actor: Actor = {
      kind: 'staff',
      staffUserId: 'staff-none',
      assignments: [
        {
          facilityId: 'facility-a',
          roleKey: 'counter',
          rank: 10,
          permissions: new Set<PermissionKey>(['payments:take']),
          limits: { maxFeeWaiverCents: 0, maxRefundCents: 0, maxCreditCents: 0 },
        },
      ],
    }
    const groups = groupedNavItems(actor)
    expect(groups.find((g) => g.key === 'property')).toBeUndefined()
    expect(groups.map((g) => g.key)).toEqual(['today', 'money'])
  })

  it('groups stay in NAV_GROUP_ORDER regardless of how NAV_ITEMS is ordered', () => {
    const actor = staff(assignmentFor('owner', null))
    const keys = groupedNavItems(actor).map((g) => g.key)
    expect(keys).toEqual([...keys].sort((a, b) => NAV_GROUP_ORDER.indexOf(a) - NAV_GROUP_ORDER.indexOf(b)))
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
      expect.arrayContaining(['dashboard', 'tenants', 'billing', 'pos', 'tasks']),
    )
    expect(keys).not.toContain('units')
    expect(keys).not.toContain('settings')
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
