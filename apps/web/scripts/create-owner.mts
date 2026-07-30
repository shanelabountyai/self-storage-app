import { prisma } from '@storage/db'
import { createOwnerAccount } from '../lib/admin/bootstrap-owner.ts'

// Usage: npm run db:create-owner -- --email you@example.com [--first-name Shane] [--last-name LaBounty] [--force]

function readArg(name: string): string | undefined {
  const flag = `--${name}`
  const index = process.argv.indexOf(flag)
  return index === -1 ? undefined : process.argv[index + 1]
}

async function main() {
  const email = readArg('email')
  if (!email) {
    console.error('Usage: npm run db:create-owner -- --email you@example.com [--force]')
    process.exitCode = 1
    return
  }

  const result = await createOwnerAccount({
    email,
    firstName: readArg('first-name'),
    lastName: readArg('last-name'),
    force: process.argv.includes('--force'),
  })

  if (!result.created) {
    if (result.reason === 'owner_exists') {
      console.error(
        `An owner already exists (${result.existingEmail}). Re-run with --force to create another.`,
      )
    } else {
      console.error(`${email} is already an owner — nothing to do.`)
    }
    process.exitCode = 1
    return
  }

  console.info(`Created staff user ${result.staffUserId} with the owner role (all facilities).`)
  console.info(`Set a password within ${Math.round((result.expiresAt.getTime() - Date.now()) / 60_000)} minutes:`)
  console.info(`  ${result.resetUrl}`)
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
