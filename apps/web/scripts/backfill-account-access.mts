import { prisma } from '@storage/db'
import { accountAccessKey, sendAccountAccessLink } from '../lib/auth/flows.ts'

// Usage: npm run db:backfill:account-access [-- --apply]
//
// B-301. B-287 emails a business-account member when they are ADDED, so every
// membership that predates it was never told the portal shows them the
// account. This sends them the same mail, once.
//
// Deliberately NOT guarded by `assertDevDatabase`, for the reason the move-in
// backfill is not: the members who need this are in production. The guard is
// that it prints and sends nothing until `--apply`, and that each send is keyed
// on the membership id (`accountAccessKey`), so `sendDirectEmail` refuses a
// second mail about the same membership however many times this runs.
//
// Members added since B-287 were emailed under a random key. They are found by
// the mail itself: a sent message to that tenant, after they joined, whose body
// names the account. Only the account-access mail ever carries an account name.

export type AccessPlan = {
  memberId: string
  tenantId: string
  email: string | null
  accountName: string
  /// Why nothing will be sent, or null when it will be.
  skip: 'no_email' | 'already_told' | 'earlier_attempt_failed' | null
}

/// Who would be emailed, and why everybody else would not. Separated from
/// `main` so it can be tested: it is the half that decides who gets mail.
export async function planAccountAccessBackfill(): Promise<AccessPlan[]> {
  const members = await prisma.billingAccountMember.findMany({
    select: {
      id: true,
      tenantId: true,
      createdAt: true,
      account: { select: { name: true } },
      tenant: { select: { email: true } },
    },
    orderBy: { createdAt: 'asc' },
  })

  const plans: AccessPlan[] = []
  for (const member of members) {
    const base = {
      memberId: member.id,
      tenantId: member.tenantId,
      email: member.tenant.email,
      accountName: member.account.name,
    }
    // D-111: a tenant may have no email, and then there is nowhere to send it.
    if (!member.tenant.email) {
      plans.push({ ...base, skip: 'no_email' })
      continue
    }

    const keyed = await prisma.message.findUnique({
      where: { idempotencyKey: accountAccessKey(member.id) },
      select: { status: true },
    })
    if (keyed) {
      // A failed row still holds the key, and `sendDirectEmail` will not retry
      // it. That is a person's problem: say so rather than claim it went.
      const told = keyed.status === 'sent' || keyed.status === 'delivered'
      plans.push({ ...base, skip: told ? 'already_told' : 'earlier_attempt_failed' })
      continue
    }

    const toldByB287 = await prisma.message.findFirst({
      where: {
        recipientTenantId: member.tenantId,
        eventId: 'auth:password_reset',
        status: { in: ['sent', 'delivered'] },
        createdAt: { gte: member.createdAt },
        bodySnapshot: { contains: member.account.name },
      },
      select: { id: true },
    })
    plans.push({ ...base, skip: toldByB287 ? 'already_told' : null })
  }
  return plans
}

async function main() {
  const apply = process.argv.includes('--apply')
  // Without a provider `sendAuthEmail` prints the reset link to the console,
  // which here would be a live sign-in link for a real person in a terminal.
  if (apply && !process.env.RESEND_API_KEY) {
    console.error('REFUSING to --apply: RESEND_API_KEY is not set, so nothing would be delivered.')
    process.exitCode = 1
    return
  }

  const plans = await planAccountAccessBackfill()
  let sent = 0
  let failed = 0
  for (const plan of plans) {
    if (plan.skip) {
      console.log(`SKIP  member=${plan.memberId} tenant=${plan.tenantId} reason=${plan.skip}`)
      continue
    }
    if (!apply) {
      console.log(`WOULD member=${plan.memberId} tenant=${plan.tenantId}`)
      continue
    }
    try {
      await sendAccountAccessLink({ id: plan.tenantId, email: plan.email! }, plan.accountName, plan.memberId)
      console.log(`SENT  member=${plan.memberId} tenant=${plan.tenantId}`)
      sent++
    } catch (error) {
      console.error(`FAIL  member=${plan.memberId} tenant=${plan.tenantId}`, error)
      failed++
    }
  }

  const count = (skip: AccessPlan['skip']) => plans.filter((plan) => plan.skip === skip).length
  console.log(
    `\n${plans.length} memberships: ${apply ? `sent ${sent}, failed ${failed}` : `would send ${count(null)}`}; ` +
      `already told ${count('already_told')}, no email ${count('no_email')}, ` +
      `earlier attempt failed ${count('earlier_attempt_failed')}.`,
  )
  if (!apply) console.log('Nothing was sent. Re-run with --apply.')
  if (failed) process.exitCode = 1
  await prisma.$disconnect()
}

if (process.argv[1]?.endsWith('backfill-account-access.mts')) {
  main().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
