import { PrismaClient } from '../generated/client/index.js'
import { PERMISSIONS, ROLES } from '../rbac-catalog.ts'
import { COMMS_RULES, COMMS_TEMPLATES } from '../comms-catalog.ts'

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

  // PRD 05 FR-2: org-default templates and the rules that reference them.
  // facilityId: null throughout — a per-facility override is a row an admin
  // screen (CN-16) writes later, never something this script touches.
  for (const template of COMMS_TEMPLATES) {
    const channel = template.channel ?? 'email'
    // Not `upsert`: Prisma's generated compound-unique input does not accept a
    // literal `null` for a nullable column in the key, even though the schema
    // itself does (the same reason NotificationRule below uses findFirst).
    const existing = await prisma.messageTemplate.findFirst({
      where: { key: template.key, channel, facilityId: null, version: 1 },
    })
    const fields = {
      classification: template.classification,
      // Schema's own rule: "Email subject; null for SMS."
      subject: template.subject ?? null,
      bodyText: template.bodyText,
      requiredMergeFields: template.requiredMergeFields,
      active: true,
    }
    if (existing) {
      await prisma.messageTemplate.update({ where: { id: existing.id }, data: fields })
    } else {
      await prisma.messageTemplate.create({
        data: { key: template.key, channel, facilityId: null, version: 1, ...fields },
      })
    }
  }

  for (const rule of COMMS_RULES) {
    const channel = rule.channel ?? 'email'
    // Identity is (event, templateKey, facilityId) — deliberately NOT channel.
    // There is exactly one rule per templateKey by convention (B-074's own
    // "one rule per template, its channel decides the path"), and a catalog
    // edit that flips a rule's channel (email -> sms, e.g. access_suspended)
    // must UPDATE that row, not orphan it under the old channel while
    // creating a second one — two active rows for the same templateKey is
    // exactly the ambiguity `applicableRules`' dedup was built to not have.
    const existing = await prisma.notificationRule.findFirst({
      where: { event: rule.event, templateKey: rule.templateKey, facilityId: null },
    })
    const fields = {
      event: rule.event,
      templateKey: rule.templateKey,
      channel,
      channelPolicy: rule.channelPolicy ?? 'email_only',
      category: rule.category ?? null,
      facilityId: null,
      classification: rule.classification,
      skipConditions: rule.skipConditions ?? [],
      active: true,
    }
    if (existing) {
      await prisma.notificationRule.update({ where: { id: existing.id }, data: fields })
    } else {
      await prisma.notificationRule.create({ data: fields })
    }
  }

  const [templates, rules] = await Promise.all([
    prisma.messageTemplate.count({ where: { facilityId: null } }),
    prisma.notificationRule.count({ where: { facilityId: null } }),
  ])
  console.info(`Seeded ${templates} org-default templates, ${rules} org-default rules.`)
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
