import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import { createOwnerAccount, StaffEmailInUseError } from '../apps/web/lib/admin/bootstrap-owner'

// Exercises the one path that can create a StaffUser before B-007's admin UI
// exists at all — a bug here means nobody can bootstrap into admin.
//
// **This suite must never assume it owns the global owner state.** It shares a
// database with everything else and vitest runs files in parallel, so "is there
// an owner anywhere" is not a fact this file can control — and worse, an
// interrupted run leaves a live owner behind whose existence then fails the
// first test of every subsequent run, permanently, until somebody deletes the
// row by hand. That has happened twice. Every assertion below is therefore
// written to hold whether or not another live owner exists.
const hasDatabase = Boolean(process.env.DATABASE_URL)

const suffix = randomUUID().slice(0, 8)
const emailA = `owner-a-${suffix}@example.com`
const emailB = `owner-b-${suffix}@example.com`
const createdStaffIds: string[] = []

afterAll(async () => {
  if (!hasDatabase) return
  // By email shape rather than only by `createdStaffIds`, because the ids array
  // is lost when a run is interrupted — and a leaked LIVE owner is not an inert
  // leftover, it changes the behaviour of every later run. Narrow enough that a
  // real owner account can never match: this suite's own prefixes, at
  // example.com.
  const fixtures = await prisma.staffUser.findMany({
    where: {
      email: { endsWith: '@example.com' },
      OR: [
        { email: { startsWith: 'owner-a-' } },
        { email: { startsWith: 'owner-b-' } },
        { email: { startsWith: 'owner-case-' } },
        { email: { startsWith: 'owner-deactivated-' } },
        { email: { startsWith: 'owner-recovery-' } },
        { email: { startsWith: 'non-owner-' } },
      ],
    },
    select: { id: true },
  })
  const ids = [...new Set([...createdStaffIds, ...fixtures.map((row) => row.id)])]
  await prisma.staffFacilityAssignment.deleteMany({ where: { staffUserId: { in: ids } } })
  await prisma.staffUser.deleteMany({ where: { id: { in: ids } } })
  await prisma.$disconnect()
})

describe.skipIf(!hasDatabase)('createOwnerAccount', () => {
  it('creates a staff user with an all-facilities owner assignment', async () => {
    // `force` because this test is about the SHAPE of what gets created, not
    // about the refusal — which is its own test below. Without it, a live owner
    // belonging to another suite (or leaked by an interrupted run) makes this
    // fail for a reason that has nothing to do with what it checks.
    const result = await createOwnerAccount({ email: emailA, firstName: 'Ada', force: true })
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

    // The refusal and the no-op are what this test is about. Which email it
    // names as the incumbent is NOT asserted: any live owner is a valid answer,
    // and pinning it to this suite's own fixture is what made this file depend
    // on owning the database.
    expect(result).toMatchObject({ created: false, reason: 'owner_exists' })
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
    expect(result).toMatchObject({ created: false, reason: 'owner_exists' })
  })

  it('ignores an owner whose staff account has been deactivated', async () => {
    // Otherwise deactivating a compromised owner would lock the system out —
    // there would be no way to bootstrap a replacement.
    const deactivatedEmail = `owner-deactivated-${suffix}@example.com`
    const created = await createOwnerAccount({ email: deactivatedEmail, force: true })
    if (!created.created) throw new Error('unreachable')
    createdStaffIds.push(created.staffUserId)

    await prisma.staffUser.update({
      where: { id: created.staffUserId },
      data: { deletedAt: new Date(), status: 'suspended' },
    })

    // With every owner THIS SUITE created also deactivated, a fresh bootstrap
    // must not be blocked by any of them.
    await prisma.staffUser.updateMany({
      where: { id: { in: createdStaffIds } },
      data: { deletedAt: new Date(), status: 'suspended' },
    })
    const ours = new Set(
      (
        await prisma.staffUser.findMany({
          where: { id: { in: createdStaffIds } },
          select: { email: true },
        })
      ).map((staff) => staff.email),
    )

    const recovery = await createOwnerAccount({ email: `owner-recovery-${suffix}@example.com` })

    // Two outcomes are both correct, and asserting only the first is what made
    // this suite fail roughly one run in three. The database is shared and
    // vitest runs files in parallel, so a LIVE owner belonging to another suite
    // may exist at this instant — and refusing then is the right behaviour, not
    // a regression. What this test actually cares about either way is that none
    // of OUR deactivated owners was the one doing the blocking.
    if (recovery.created) {
      createdStaffIds.push(recovery.staffUserId)
    } else {
      expect(recovery.reason).toBe('owner_exists')
      expect(ours.has(recovery.existingEmail ?? '')).toBe(false)
    }
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
