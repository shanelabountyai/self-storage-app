import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import { resolveAudience, setPassword } from '../apps/web/lib/auth/accounts'

// The defect this pins cost the owner three rounds of debugging on the day the
// first real account was created, and both the UX and accessibility reviews
// raised it as their top finding: `/login` and `/forgot-password` inferred the
// audience from the `from` query parameter and DEFAULTED TO TENANT when it was
// absent. A staff member who typed either URL was looked up in the Tenant
// table, where they do not exist — so password reset said "a link is on its
// way" and sent nothing, and sign-in said "incorrect email or password" about
// a correct password.
//
// Every assertion below is about resolution alone. What each caller then does
// with the answer (throttling, the generic failure message, the staff
// magic-link refusal) is asserted in login-flow-db.test.ts.

const suffix = randomUUID().slice(0, 8)
const staffOnly = `audience-staff-${suffix}@demo.example.com`
const tenantOnly = `audience-tenant-${suffix}@demo.example.com`
const both = `audience-both-${suffix}@demo.example.com`
const nobody = `audience-nobody-${suffix}@demo.example.com`

let disabledStaffId: string

beforeAll(async () => {
  await prisma.staffUser.create({
    data: { email: staffOnly, firstName: 'Sam', lastName: 'Staff' },
  })
  await prisma.tenant.create({
    data: { email: tenantOnly, firstName: 'Tess', lastName: 'Tenant' },
  })

  // The employee who also rents a unit. Genuinely ambiguous, so it gets its own
  // assertions rather than being left to whichever query happens to run first.
  const staff = await prisma.staffUser.create({
    data: { email: both, firstName: 'Bo', lastName: 'Both' },
  })
  disabledStaffId = staff.id
  await prisma.tenant.create({
    data: { email: both, firstName: 'Bo', lastName: 'Both' },
  })
})

afterAll(async () => {
  await prisma.staffUser.deleteMany({ where: { email: { in: [staffOnly, both] } } })
  await prisma.tenant.deleteMany({ where: { email: { in: [tenantOnly, both] } } })
})

describe('resolveAudience', () => {
  // The exact production failure.
  it('finds a staff member who arrived with no `from` at all', async () => {
    expect(await resolveAudience(staffOnly, null)).toBe('staff')
  })

  it('finds a tenant who arrived with no `from` at all', async () => {
    expect(await resolveAudience(tenantOnly, null)).toBe('tenant')
  })

  // The hint is a preference, not a verdict — so a WRONG one no longer locks
  // anybody out. This is what makes the post-reset redirect safe: it sends
  // everyone to a bare `/login`, and previously that alone was enough to break
  // a staff member's first sign-in.
  it('finds a staff member even when the hint says tenant', async () => {
    expect(await resolveAudience(staffOnly, 'tenant')).toBe('staff')
  })

  it('finds a tenant even when the hint says staff', async () => {
    expect(await resolveAudience(tenantOnly, 'staff')).toBe('tenant')
  })

  it('is null for an address with no account, so callers behave as they always did', async () => {
    expect(await resolveAudience(nobody, null)).toBeNull()
    expect(await resolveAudience(nobody, 'staff')).toBeNull()
  })

  describe('when one address is both a staff member and a tenant', () => {
    it('honours a hint in either direction', async () => {
      expect(await resolveAudience(both, 'tenant')).toBe('tenant')
      expect(await resolveAudience(both, 'staff')).toBe('staff')
    })

    // Documented tie-break: the portal's own links carry `from`, so a tenant
    // arriving the ordinary way still resolves to tenant. A locked-out staff
    // member is the one with no other route in.
    it('prefers staff with no hint', async () => {
      expect(await resolveAudience(both, null)).toBe('staff')
    })

    // A deactivated staff account must not swallow a usable tenant one —
    // otherwise deactivating an employee silently kills the storage unit they
    // rent from us.
    it('falls through to the tenant account when the staff one is deactivated', async () => {
      await prisma.staffUser.update({
        where: { id: disabledStaffId },
        data: { status: 'suspended' },
      })
      try {
        expect(await resolveAudience(both, null)).toBe('tenant')
      } finally {
        await prisma.staffUser.update({
          where: { id: disabledStaffId },
          data: { status: 'active' },
        })
      }
    })
  })

  it('ignores case and surrounding whitespace, as the login form supplies it', async () => {
    expect(await resolveAudience(`  ${staffOnly.toUpperCase()}  `, null)).toBe('staff')
  })

  // Guards the one thing resolution must never do: a password set for a staff
  // account must not be findable as a tenant's, or resolution would be a
  // cross-audience account-takeover rather than a lookup.
  it('does not let a staff password satisfy a tenant lookup', async () => {
    await setPassword(disabledStaffId, 'staff', 'correct horse battery staple')
    const tenant = await prisma.tenant.findUnique({ where: { email: both } })
    expect(tenant?.passwordHash).toBeNull()
  })
})
