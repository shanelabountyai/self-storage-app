import { PrismaClient } from '../generated/client/index.js'
import { PERMISSIONS, ROLES } from '../rbac-catalog.ts'

// Reference data, not demo data: roles and permissions must exist in every
// environment for authorization to work at all. Idempotent, so it is safe to
// re-run on every deploy. Demo facilities and tenants are B-012.
const prisma = new PrismaClient()

async function main() {
  for (const permission of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { key: permission.key },
      create: permission,
      update: { name: permission.name, description: permission.description, category: permission.category },
    })
  }

  for (const role of ROLES) {
    const { permissions, ...fields } = role
    const saved = await prisma.role.upsert({
      where: { key: role.key },
      create: fields,
      update: fields,
    })

    // Replace rather than merge, so removing a permission from the catalog
    // actually revokes it instead of leaving a stale grant behind.
    await prisma.rolePermission.deleteMany({
      where: { roleId: saved.id, permissionKey: { notIn: [...permissions] } },
    })
    for (const permissionKey of permissions) {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionKey: { roleId: saved.id, permissionKey } },
        create: { roleId: saved.id, permissionKey },
        update: {},
      })
    }
  }

  const [roles, permissions, grants] = await Promise.all([
    prisma.role.count(),
    prisma.permission.count(),
    prisma.rolePermission.count(),
  ])
  console.info(`Seeded ${roles} roles, ${permissions} permissions, ${grants} grants.`)
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
