import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import { createOwnerAccount, StaffEmailInUseError } from '../apps/web/lib/admin/bootstrap-owner'

// Exercises the one path that can create a StaffUser before B-007's admin UI
// exists at all — a bug here means nobody can bootstrap into admin.
const hasDatabase = Boolean(process.env.DATABASE_URL)

const suffix = randomUUID().slice(0, 8)
const emailA = `owner-a-${suffix}@example.com`
const emailB = `owner-b-${suffix}@example.com`
const createdStaffIds: string[] = []

afterAll(async () => {
  if (!hasDatabase) return
  await prisma.staffFacilityAssignment.deleteMany({ where: { staffUserId: { in: createdStaffIds } } })
  await prisma.staffUser.deleteMany({ where: { id: { in: createdStaffIds } } })
  await prisma.$disconnect()
})

describe.skipIf(!hasDatabase)('createOwnerAccount', () => {
  it('creates a staff user with an all-facilities owner assignment', async () => {
    const result = await createOwnerAccount({ email: emailA, firstName: 'Ada' })
    expect(result.created).toBe(true)
    if (!result.created) throw new Error('unreachable')
    createdStaffIds.push(result.staffUserId)

    const assignment = await prisma.staffFacilityAssignment.findFirst({
      where: { staffUserId: result.staffUserId },
      include: { role: true },
    })
    expect(assignment?.role.key).toBe('owner')
    expect(assignment?.facilityId).toBeNull()
    expect(result.resetUrl).toContain('/reset-password?token=')
  })

  it('normalizes the email and defaults the name', async () => {
    const email = `  Owner-Case-${suffix}@Example.com  `
    // An owner already exists from the previous test, so this needs --force
    // to actually create a second one rather than being refused.
    const result = await createOwnerAccount({ email, force: true })
    expect(result.created).toBe(true)
    if (!result.created) throw new Error('unreachable')
    createdStaffIds.push(result.staffUserId)

    const staff = await prisma.staffUser.findUniqueOrThrow({ where: { id: result.staffUserId } })
    expect(staff.email).toBe(`owner-case-${suffix}@example.com`)
    expect(staff.firstName).toBe('Owner')
    expect(staff.lastName).toBe('Account')
  })

  it('refuses a second owner without --force', async () => {
    const result = await createOwnerAccount({ email: emailB })
    expect(result).toEqual({ created: false, reason: 'owner_exists', existingEmail: emailA })

    // And definitely did not create anything.
    expect(await prisma.staffUser.findUnique({ where: { email: emailB } })).toBeNull()
  })

  it('creates another owner when forced', async () => {
    const result = await createOwnerAccount({ email: emailB, force: true })
    expect(result.created).toBe(true)
    if (!result.created) throw new Error('unreachable')
    createdStaffIds.push(result.staffUserId)

    const owners = await prisma.staffFacilityAssignment.count({
      where: { facilityId: null, role: { key: 'owner' } },
    })
    expect(owners).toBeGreaterThanOrEqual(2)
  })

  it('is idempotent for an email that is already an owner, even with --force', async () => {
    // --force bypasses the "an owner exists somewhere" refusal, but re-running
    // for the SAME already-owner email must still be a no-op, not a duplicate.
    const result = await createOwnerAccount({ email: emailB, force: true })
    expect(result).toMatchObject({ created: false, reason: 'already_owner' })
  })

  it('reports owner_exists (not a crash) when re-run for the same email with no --force', async () => {
    const result = await createOwnerAccount({ email: emailA })
    expect(result).toEqual({ created: false, reason: 'owner_exists', existingEmail: emailA })
  })

  it('refuses to reuse an email that belongs to a non-owner staff user', async () => {
    const nonOwnerEmail = `non-owner-${suffix}@example.com`
    const nonOwner = await prisma.staffUser.create({
      data: { email: nonOwnerEmail, firstName: 'Not', lastName: 'Owner' },
    })
    createdStaffIds.push(nonOwner.id)

    await expect(createOwnerAccount({ email: nonOwnerEmail, force: true })).rejects.toBeInstanceOf(
      StaffEmailInUseError,
    )
  })

  it('writes an audit entry for the created account', async () => {
    const email = `owner-audited-${suffix}@example.com`
    const result = await createOwnerAccount({ email, force: true })
    if (!result.created) throw new Error('unreachable')
    createdStaffIds.push(result.staffUserId)

    const entries = await prisma.auditLog.findMany({
      where: { entityId: result.staffUserId, action: 'user.created' },
    })
    expect(entries).toHaveLength(1)
    expect(entries[0].actorType).toBe('system')
  })
})
