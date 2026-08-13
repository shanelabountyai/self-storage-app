import { assertDevDatabase } from '../../../scripts/assert-dev-database.mts'
import { prisma } from '@storage/db'
import { findSubjectByEmail } from '../lib/auth/accounts.ts'
import { mintToken } from '../lib/auth/tokens.ts'

// Usage: npm run db:reset-link -- --email you@example.com [--tenant]
//
// Prints a password-reset link instead of emailing one. `/forgot-password`
// already does this properly, and it is what anybody with an inbox should use —
// but it needs RESEND_API_KEY, and in production `sendAuthEmail` THROWS when
// the send fails rather than dropping a sign-in link silently. So on a
// deployment with no mail provider wired there is no way at all to set a staff
// password, including the very first owner's: the bootstrap link expires after
// an hour (TOKEN_TTL_MS.password_reset) and nothing can issue another.
//
// That is the whole reason this exists. It stays useful afterwards for any
// staff member added before mail is configured. Once RESEND_API_KEY is set,
// prefer /forgot-password — it does not require database credentials.

function readArg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? undefined : process.argv[index + 1]
}

async function main() {
  assertDevDatabase('mint a password-reset link')

  const email = readArg('email')
  if (!email) {
    console.error('Usage: npm run db:reset-link -- --email you@example.com [--tenant]')
    process.exitCode = 1
    return
  }

  const audience = process.argv.includes('--tenant') ? 'tenant' : 'staff'

  const subject = await findSubjectByEmail(email, audience)
  if (!subject) {
    // Unlike the public flow, which must not reveal whether an address exists,
    // this one is run by somebody already holding the database credentials —
    // so saying "no such account" is a straight answer, not a disclosure.
    console.error(`No ${audience} account for ${email}.`)
    process.exitCode = 1
    return
  }

  // Consumes any live reset token for this subject, so the link printed here is
  // the only one that works.
  const { token, expiresAt } = await mintToken({
    purpose: 'password_reset',
    audience,
    subjectId: subject.id,
    email: subject.email,
  })

  const base = process.env.AUTH_URL ?? 'http://localhost:3000'
  console.info(`Expires in ${Math.round((expiresAt.getTime() - Date.now()) / 60_000)} minutes:`)
  console.info(`  ${base}/reset-password?token=${token}`)
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
