import { prisma } from '@storage/db'
import { recordAudit } from '@storage/core/audit'
import { mintToken } from '@/lib/auth/tokens'

// The only way to create the first staff account (D-12: no permission bypass,
// ever — unrestricted access is always an ordinary owner + all-facilities
// StaffFacilityAssignment row, not a flag). Nothing before B-007 can create a
// StaffUser at all, so without this there is no way to sign into admin.

export type CreateOwnerInput = {
  email: string
  firstName?: string
  lastName?: string
  /// Creates another all-facilities owner even though one already exists.
  /// Without this, a second run is a safe no-op/refusal rather than quietly
  /// piling up owner accounts.
  force?: boolean
}

export type CreateOwnerResult =
  | { created: true; staffUserId: string; resetUrl: string; expiresAt: Date }
  | { created: false; reason: 'owner_exists'; existingEmail: string }
  | { created: false; reason: 'already_owner'; staffUserId: string }

export class OwnerRoleMissingError extends Error {
  constructor() {
    super('The "owner" role does not exist — run `npm run db:seed` first')
    this.name = 'OwnerRoleMissingError'
  }
}

export class StaffEmailInUseError extends Error {
  // Explicit field, not a constructor-parameter-property: see the comment on
  // ForbiddenError in apps/web/lib/rbac/authorize.ts.
  readonly email: string

  constructor(email: string) {
    super(`A staff user with ${email} already exists and is not an owner`)
    this.name = 'StaffEmailInUseError'
    this.email = email
  }
}

function resetUrlFor(token: string): string {
  return `${process.env.AUTH_URL ?? 'http://localhost:3000'}/reset-password?token=${token}`
}

export async function createOwnerAccount(input: CreateOwnerInput): Promise<CreateOwnerResult> {
  const email = input.email.trim().toLowerCase()
  const firstName = input.firstName?.trim() || 'Owner'
  const lastName = input.lastName?.trim() || 'Account'

  const ownerRole = await prisma.role.findUnique({ where: { key: 'owner' } })
  if (!ownerRole) throw new OwnerRoleMissingError()

  // Only a *usable* owner blocks bootstrapping. An assignment belonging to a
  // soft-deleted or suspended staff user grants nothing — loadStaffActor()
  // refuses it — so counting one here would lock the system out: the recovery
  // path after deactivating a compromised owner is to create a new one.
  const existingOwnerAssignment = await prisma.staffFacilityAssignment.findFirst({
    where: {
      roleId: ownerRole.id,
      facilityId: null,
      staffUser: { deletedAt: null, status: 'active' },
    },
    // Oldest first: with several owners (created via --force) an unordered
    // findFirst reports an arbitrary one, so the "an owner already exists (X)"
    // message would change between identical runs. The original owner is also
    // the more useful one to name.
    orderBy: { createdAt: 'asc' },
    include: { staffUser: true },
  })
  if (existingOwnerAssignment && !input.force) {
    return {
      created: false,
      reason: 'owner_exists',
      existingEmail: existingOwnerAssignment.staffUser.email,
    }
  }

  const existingStaff = await prisma.staffUser.findUnique({ where: { email } })
  if (existingStaff) {
    const alreadyOwner = await prisma.staffFacilityAssignment.findFirst({
      where: { staffUserId: existingStaff.id, roleId: ownerRole.id, facilityId: null },
    })
    if (alreadyOwner) {
      return { created: false, reason: 'already_owner', staffUserId: existingStaff.id }
    }
    throw new StaffEmailInUseError(email)
  }

  const staffUser = await prisma.$transaction(async (tx) => {
    const created = await tx.staffUser.create({ data: { email, firstName, lastName } })
    await tx.staffFacilityAssignment.create({
      data: { staffUserId: created.id, roleId: ownerRole.id, facilityId: null },
    })
    await recordAudit(
      {
        actor: { type: 'system', label: 'bootstrap-script' },
        action: 'user.created',
        entityType: 'StaffUser',
        entityId: created.id,
        context: { email, roleKey: 'owner', facilityId: null },
      },
      tx,
    )
    return created
  })

  const { token, expiresAt } = await mintToken({
    purpose: 'password_reset',
    audience: 'staff',
    subjectId: staffUser.id,
    email,
  })

  return { created: true, staffUserId: staffUser.id, resetUrl: resetUrlFor(token), expiresAt }
}
